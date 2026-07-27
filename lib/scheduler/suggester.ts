import { parseISO, getDay, addDays, format } from 'date-fns'
import type { Employee, SchedulingRule } from '@/types'
import type { Slot, GeneratedAssignment, FairnessSummary, TimeOff, DayType } from './types'
import { emptyCounters } from './counters'
import { isEligible } from './eligibility'
import { scoreCandidate, updateCounters } from './scoring'
import {
  getShiftStartDatetime,
  getShiftEndDatetime,
  checkMinRest,
  checkConsecutiveNightsRest,
  checkConsecutiveDays,
  checkNewEmployeePairing,
  type AssignmentWithShift,
  type AssignmentWithEmployee,
} from '../rules/constraints'
import type { Shift } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EligibleCandidate {
  employee: Employee
  score: number
  reason: string
  load: { totalShifts: number; nightShifts: number }
}

export interface IneligibleCandidate {
  employee: Employee
  reason: string
}

export interface CandidateResult {
  eligible: EligibleCandidate[]
  ineligible: IneligibleCandidate[]
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from eligibility.ts to keep suggester self-contained)
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

function isOnLeave(employeeId: string, date: string, timeOff: TimeOff[]): boolean {
  return timeOff
    .filter(t => t.employee_id === employeeId && t.status === 'approved')
    .some(t => date >= t.start_date && date <= t.end_date)
}

function shiftsInCalendarWeek(assignments: GeneratedAssignment[], date: string): number {
  const d = parseISO(date)
  const dow = getDay(d)
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
// getIneligibilityReason — returns the first failing hard rule as human text
// ---------------------------------------------------------------------------

function getIneligibilityReason(
  slot: Slot,
  employee: Employee,
  employeeAssignments: GeneratedAssignment[],
  slotAssignmentsSoFar: GeneratedAssignment[],
  timeOff: TimeOff[],
  rules: SchedulingRule[],
  allEmployees: Employee[],
): string {
  if (isOnLeave(employee.id, slot.date, timeOff)) return 'On approved leave'

  if (slotAssignmentsSoFar.some(a => a.employee_id === employee.id)) return 'Already assigned to this shift'

  if (shiftsInCalendarWeek(employeeAssignments, slot.date) >= 5) return '5-shift weekly cap reached'

  const slotShift = makeShift(slot.date, slot.shift_type)
  const requestedStart = getShiftStartDatetime(slotShift)
  const requestedEnd = getShiftEndDatetime(slotShift)
  const requestedDate = parseISO(slot.date)
  const existingAws: AssignmentWithShift[] = employeeAssignments.map(toAssignmentWithShift)
  const findRule = (name: string) => rules.find(r => r.name === name)

  const minRestRule = findRule('min_rest') ?? DEFAULT_MIN_REST_RULE
  const restViolations = checkMinRest(minRestRule, existingAws, requestedStart, requestedEnd)
  if (restViolations.some(v => v.severity === 'error')) {
    const minHours = minRestRule.parameters?.min_rest_hours ?? 12
    return `Insufficient rest — needs ${minHours}h gap between shifts`
  }

  const consNightsRule = findRule('consecutive_nights_rest')
  if (consNightsRule) {
    if (checkConsecutiveNightsRest(consNightsRule, existingAws, requestedDate)?.severity === 'error') {
      return 'In rest window after two consecutive nights (needs 2 days off)'
    }
    if (slot.shift_type === 'night') {
      const nextDayStr = format(addDays(requestedDate, 1), 'yyyy-MM-dd')
      const prevDayStr = format(addDays(requestedDate, -1), 'yyyy-MM-dd')
      if (employeeAssignments.some(a => a.date === nextDayStr && a.shift_type === 'night')) {
        const r1 = format(addDays(requestedDate, 2), 'yyyy-MM-dd')
        const r2 = format(addDays(requestedDate, 3), 'yyyy-MM-dd')
        if (employeeAssignments.some(a => a.date === r1 || a.date === r2)) {
          return 'Assigning would create a consecutive-nights pair whose rest window conflicts with existing shifts'
        }
      }
      if (employeeAssignments.some(a => a.date === prevDayStr && a.shift_type === 'night')) {
        const r1 = format(addDays(requestedDate, 1), 'yyyy-MM-dd')
        const r2 = format(addDays(requestedDate, 2), 'yyyy-MM-dd')
        if (employeeAssignments.some(a => a.date === r1 || a.date === r2)) {
          return 'Assigning would create a consecutive-nights pair whose rest window conflicts with existing shifts'
        }
      }
    }
  }

  const consRule = findRule('consecutive_days')
  if (consRule) {
    if (checkConsecutiveDays(consRule, employee, existingAws, requestedDate)?.severity === 'error') {
      const max = consRule.parameters?.max_consecutive_days ?? employee.weekly_days
      return `Would exceed ${max} consecutive days`
    }
  }

  const pairingRule = findRule('new_employee_pairing')
  if (pairingRule && employee.is_new_employee && slot.shift_type === 'night') {
    const slotAwe: AssignmentWithEmployee[] = slotAssignmentsSoFar.flatMap(a => {
      const emp = allEmployees.find(e => e.id === a.employee_id)
      return emp ? [toAssignmentWithEmployee(a, emp)] : []
    })
    if (checkNewEmployeePairing(pairingRule, employee, slotAwe, slot.shift_type)?.severity === 'error') {
      return 'New employee on a night shift needs an experienced guard (and no second new employee)'
    }
  }

  return 'Ineligible (unknown reason)'
}

// ---------------------------------------------------------------------------
// buildFairnessCounters — reconstruct counters from existing assignments
// ---------------------------------------------------------------------------

export function buildFairnessCounters(
  assignments: GeneratedAssignment[],
  employees: Employee[],
): FairnessSummary {
  const counters: FairnessSummary = {}
  for (const emp of employees) {
    counters[emp.id] = emptyCounters()
  }
  for (const a of assignments) {
    updateCounters(counters, a.employee_id, {
      date: a.date,
      shift_type: a.shift_type,
      day_type: a.day_type,
      headcount: 1,
    })
  }
  return counters
}

// ---------------------------------------------------------------------------
// rankingReason — human-readable explanation for why a candidate ranks well
// ---------------------------------------------------------------------------

function rankingReason(
  employee: Employee,
  slot: Slot,
  counters: FairnessSummary,
  allEmployees: Employee[],
): string {
  const my = counters[employee.id] ?? emptyCounters()
  const parts: string[] = []

  const allTotals = allEmployees.map(e => counters[e.id]?.totalShifts ?? 0)
  const avgTotal = allTotals.reduce((s, v) => s + v, 0) / (allTotals.length || 1)
  if (my.totalShifts < avgTotal - 0.5) parts.push('Under on total shifts')
  else if (my.totalShifts > avgTotal + 0.5) parts.push('Over on total shifts')

  if (slot.day_type === 'weekend') {
    const allWknd = allEmployees.map(e => counters[e.id]?.weekendShifts ?? 0)
    const avgWknd = allWknd.reduce((s, v) => s + v, 0) / (allWknd.length || 1)
    if (my.weekendShifts < avgWknd - 0.5) parts.push('Under on weekends')
    else if (my.weekendShifts > avgWknd + 0.5) parts.push('Over on weekends')
  }

  if (slot.shift_type === 'night') {
    const allNights = allEmployees.map(e => counters[e.id]?.nightShifts ?? 0)
    const avgNights = allNights.reduce((s, v) => s + v, 0) / (allNights.length || 1)
    if (my.nightShifts < avgNights - 0.5) parts.push('Under on nights')
    else if (my.nightShifts > avgNights + 0.5) parts.push('Over on nights')
  }

  if (parts.length === 0) parts.push('On par with team average')
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// suggestCandidates — main export
// ---------------------------------------------------------------------------

export function suggestCandidates(
  slot: Slot,
  allAssignments: GeneratedAssignment[],
  employees: Employee[],
  timeOff: TimeOff[],
  rules: SchedulingRule[],
): CandidateResult {
  const slotAssignments = allAssignments.filter(
    a => a.date === slot.date && a.shift_type === slot.shift_type,
  )

  const counters = buildFairnessCounters(allAssignments, employees)

  const eligible: EligibleCandidate[] = []
  const ineligible: IneligibleCandidate[] = []

  for (const employee of employees) {
    const employeeAssignments = allAssignments.filter(a => a.employee_id === employee.id)

    if (isEligible(slot, employee, employeeAssignments, slotAssignments, timeOff, rules, employees)) {
      const score = scoreCandidate(employee, slot, counters, slotAssignments, rules, employees)
      const reason = rankingReason(employee, slot, counters, employees)
      const load = {
        totalShifts: counters[employee.id]?.totalShifts ?? 0,
        nightShifts: counters[employee.id]?.nightShifts ?? 0,
      }
      eligible.push({ employee, score, reason, load })
    } else {
      const reason = getIneligibilityReason(
        slot, employee, employeeAssignments, slotAssignments, timeOff, rules, employees,
      )
      ineligible.push({ employee, reason })
    }
  }

  eligible.sort((a, b) => a.score - b.score)

  return { eligible, ineligible }
}
