import { parseISO, getDay, addDays, format } from 'date-fns'
import type { Employee, Shift, ShiftAssignment, SchedulingRule } from '@/types'
import type { Slot, GeneratedAssignment, TimeOff } from './types'
import {
  getShiftStartDatetime,
  getShiftEndDatetime,
  checkMinRest,
  checkNightFollowup,
  checkConsecutiveNightsRest,
  checkNewEmployeePairing,
  checkConsecutiveDays,
  type AssignmentWithShift,
  type AssignmentWithEmployee,
} from '../rules/constraints'

// ---------------------------------------------------------------------------
// Canonical shift times — used to build synthetic Shift objects for constraint
// predicates that expect full Shift records.
// ---------------------------------------------------------------------------

const SHIFT_TIMES = {
  morning: { start: '07:00', end: '15:00' },
  evening: { start: '15:00', end: '23:00' },
  night:   { start: '23:00', end: '07:00' },
} as const

function makeShift(date: string, shiftType: 'morning' | 'evening' | 'night'): Shift {
  const t = SHIFT_TIMES[shiftType]
  return {
    id: `${date}-${shiftType}`,
    date,
    shift_type: shiftType,
    start_time: t.start,
    end_time: t.end,
    headcount: 1,
    location: null,
    role_required: null,
    notes: null,
    is_published: false,
    created_by: null,
    created_at: date,
    updated_at: date,
    request_status: 'open',
  }
}

function toAssignmentWithShift(a: GeneratedAssignment): AssignmentWithShift {
  const shift = makeShift(a.date, a.shift_type)
  return {
    id: `gen-${a.employee_id}-${a.date}-${a.shift_type}`,
    employee_id: a.employee_id,
    shift_id: shift.id,
    assigned_by: null,
    created_at: a.date,
    shift,
  }
}

function toAssignmentWithEmployee(a: GeneratedAssignment, emp: Employee): AssignmentWithEmployee {
  return {
    id: `gen-${a.employee_id}-${a.date}-${a.shift_type}`,
    employee_id: a.employee_id,
    shift_id: `${a.date}-${a.shift_type}`,
    assigned_by: null,
    created_at: a.date,
    employee: emp,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOnLeave(employeeId: string, date: string, timeOff: TimeOff[]): boolean {
  return timeOff
    .filter(t => t.employee_id === employeeId && t.status === 'approved')
    .some(t => date >= t.start_date && date <= t.end_date)
}

/** Count assignments within the ISO calendar week (Mon–Sun) that contains date. */
function shiftsInCalendarWeek(assignments: GeneratedAssignment[], date: string): number {
  const d = parseISO(date)
  const dow = getDay(d) // 0=Sun
  const daysFromMon = dow === 0 ? 6 : dow - 1
  const weekStart = format(addDays(d, -daysFromMon), 'yyyy-MM-dd')
  const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
  return assignments.filter(a => a.date >= weekStart && a.date <= weekEnd).length
}

const DEFAULT_MIN_REST_RULE: SchedulingRule = {
  id: 'default-min-rest',
  name: 'min_rest',
  display_name: 'Min Rest',
  description: '',
  severity: 'error',
  is_hard: true,
  is_enabled: true,
  parameters: { min_rest_hours: 12 },
  created_at: '',
  updated_at: '',
}

// ---------------------------------------------------------------------------
// Main eligibility predicate
// ---------------------------------------------------------------------------

/**
 * Returns true if employee can take the slot given current assignments.
 *
 * employeeAssignments: all assignments made for this employee so far this run.
 * slotAssignmentsSoFar: assignments already made to THIS slot (to check pairing).
 */
export function isEligible(
  slot: Slot,
  employee: Employee,
  employeeAssignments: GeneratedAssignment[],
  slotAssignmentsSoFar: GeneratedAssignment[],
  timeOff: TimeOff[],
  rules: SchedulingRule[],
  allEmployees: Employee[],
): boolean {
  // 1. On leave
  if (isOnLeave(employee.id, slot.date, timeOff)) return false

  // 2. Already assigned to this exact slot
  if (slotAssignmentsSoFar.some(a => a.employee_id === employee.id)) return false

  // 3. Hard 5-per-week cap (5-on / 2-off)
  if (shiftsInCalendarWeek(employeeAssignments, slot.date) >= 5) return false

  const slotShift = makeShift(slot.date, slot.shift_type)
  const requestedStart = getShiftStartDatetime(slotShift)
  const requestedEnd = getShiftEndDatetime(slotShift)
  const requestedDate = parseISO(slot.date)
  const existingAws: AssignmentWithShift[] = employeeAssignments.map(toAssignmentWithShift)
  const findRule = (name: string) => rules.find(r => r.name === name)

  // 4. Min rest (12 h by default)
  const minRestRule = findRule('min_rest') ?? DEFAULT_MIN_REST_RULE
  const restViolations = checkMinRest(minRestRule, existingAws, requestedStart, requestedEnd)
  if (restViolations.some(v => v.severity === 'error')) return false

  // 5. Night follow-up: (a) no AM/PM the day after a night; (b) 2 days off after 2 consecutive nights
  const nightRule = findRule('night_followup')
  if (nightRule) {
    if (checkNightFollowup(nightRule, existingAws, slotShift)?.severity === 'error') return false
    if (checkConsecutiveNightsRest(nightRule, existingAws, requestedDate)?.severity === 'error') return false
  }

  // 5b. Prospective consecutive-night pair checks.
  //
  // checkConsecutiveNightsRest only looks backward: "does requestedDate fall in the
  // rest window of an already-established consecutive pair?" It does NOT detect cases
  // where assigning a night on D would FORM a new pair with an existing night on D±1
  // and that pair's rest window (D+2/D+3 for forward; D+1/D+2 for backward) conflicts
  // with assignments already in the schedule.
  //
  // This matters when slots are filled in priority order rather than date order:
  //   - Weekend nights (priority 10) are filled before friday nights (20) and weekday
  //     nights (30), so a rest-window conflict can be created without a same-pass check.
  //   - The repair pass can introduce the same issue through sequential swaps.
  //
  // Forward: assigning night on D, existing night on D+1 → pair ends on D+1 → rest
  //          days D+2 and D+3 must be clear.
  // Backward: assigning night on D, existing night on D-1 → pair ends on D → rest
  //           days D+1 and D+2 must be clear.
  if (slot.shift_type === 'night') {
    const nextDayStr = format(addDays(requestedDate, 1), 'yyyy-MM-dd')
    const prevDayStr = format(addDays(requestedDate, -1), 'yyyy-MM-dd')

    if (employeeAssignments.some(a => a.date === nextDayStr && a.shift_type === 'night')) {
      const r1 = format(addDays(requestedDate, 2), 'yyyy-MM-dd')
      const r2 = format(addDays(requestedDate, 3), 'yyyy-MM-dd')
      if (employeeAssignments.some(a => a.date === r1 || a.date === r2)) return false
    }

    if (employeeAssignments.some(a => a.date === prevDayStr && a.shift_type === 'night')) {
      const r1 = format(addDays(requestedDate, 1), 'yyyy-MM-dd')
      const r2 = format(addDays(requestedDate, 2), 'yyyy-MM-dd')
      if (employeeAssignments.some(a => a.date === r1 || a.date === r2)) return false
    }
  }

  // 6. Max consecutive days
  const consRule = findRule('consecutive_days')
  if (consRule) {
    if (checkConsecutiveDays(consRule, employee, existingAws, requestedDate)?.severity === 'error') return false
  }

  // 7. New-employee pairing is HARD on Friday and Saturday
  const pairingRule = findRule('new_employee_pairing')
  if (pairingRule && employee.is_new_employee) {
    const dow = getDay(requestedDate)
    const isFriday = dow === 5
    const isSaturday = dow === 6
    if (isFriday || isSaturday) {
      const slotAwe: AssignmentWithEmployee[] = slotAssignmentsSoFar.flatMap(a => {
        const emp = allEmployees.find(e => e.id === a.employee_id)
        return emp ? [toAssignmentWithEmployee(a, emp)] : []
      })
      if (checkNewEmployeePairing(pairingRule, employee, slotAwe, isFriday, isSaturday)?.severity === 'error') return false
    }
  }

  return true
}
