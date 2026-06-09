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
  morning: { start: '09:00', end: '17:00' },
  evening: { start: '17:00', end: '01:00' },
  night:   { start: '01:00', end: '09:00' },
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

  // 5. Single-night follow-up — independently toggleable, currently a no-op.
  // The 12h min_rest rule (step 4) already blocks every invalid post-night
  // morning/evening with these shift times (gaps are 0h or 8h). Kept as a
  // separate rule entry so it can be toggled without affecting step 5b.
  const nightFollowupRule = findRule('night_followup')
  if (nightFollowupRule) {
    if (checkNightFollowup(nightFollowupRule, existingAws, slotShift)?.severity === 'error') return false
  }

  // 5b. Consecutive-nights rest — independently toggleable hard rule.
  // Two parts: backward check (is this date in a prior pair's rest window?) and
  // forward/backward prospective checks (would assigning a night on D create a
  // new pair whose rest window conflicts with already-assigned days?).
  const consNightsRule = findRule('consecutive_nights_rest')
  if (consNightsRule) {
    if (checkConsecutiveNightsRest(consNightsRule, existingAws, requestedDate)?.severity === 'error') return false

    // Prospective pair checks: checkConsecutiveNightsRest only looks backward.
    // If assigning a night on D would FORM a new pair with an existing night on
    // D+1 or D-1, pre-emptively block the assignment when the resulting rest
    // window (D+2/D+3 or D+1/D+2) conflicts with already-assigned days.
    //
    // Needed because slots fill in priority order (weekend nights before weekday
    // nights), so a rest-window conflict can emerge without a same-pass check.
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
