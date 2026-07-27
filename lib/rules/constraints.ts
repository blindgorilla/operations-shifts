/**
 * Pure predicate functions for each scheduling rule.
 * Used by both validateShiftRequest (manual assign) and the future generator.
 * No I/O — all inputs are passed in.
 */

import { differenceInHours, parseISO, format, addDays } from 'date-fns'
import type { Employee, Shift, ShiftAssignment, RuleViolation, SchedulingRule, ShiftType } from '@/types'

export type AssignmentWithShift = ShiftAssignment & { shift: Shift }
export type AssignmentWithEmployee = ShiftAssignment & { employee: Employee }

// ---------------------------------------------------------------------------
// Datetime helpers (exported so the generator can reuse them)
// ---------------------------------------------------------------------------

export function getShiftStartDatetime(shift: Shift): Date {
  const [h, m] = shift.start_time.split(':').map(Number)
  const d = parseISO(shift.date)
  d.setHours(h, m, 0, 0)
  return d
}

export function getShiftEndDatetime(shift: Shift): Date {
  const [h, m] = shift.end_time.split(':').map(Number)
  const d = parseISO(shift.date)
  d.setHours(h, m, 0, 0)
  const [startH] = shift.start_time.split(':').map(Number)
  if (h < startH) d.setDate(d.getDate() + 1) // crosses midnight
  return d
}

// ---------------------------------------------------------------------------
// Severity helper — prefers the new is_hard column; falls back to severity
// ---------------------------------------------------------------------------

export function effectiveSeverity(rule: SchedulingRule): 'error' | 'warning' {
  if (rule.is_hard !== undefined) return rule.is_hard ? 'error' : 'warning'
  return rule.severity
}

// ---------------------------------------------------------------------------
// Rule: headcount
// Returns a violation if the shift is already fully booked.
// ---------------------------------------------------------------------------

export function checkHeadcount(
  rule: SchedulingRule,
  currentCount: number,
  headcount: number,
): RuleViolation | null {
  if (currentCount >= headcount) {
    return {
      rule: rule.name,
      severity: effectiveSeverity(rule),
      message: `This shift is fully booked (${currentCount}/${headcount} spots filled).`,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Rule: min_rest
// Returns violations for each existing assignment that leaves too little rest.
// ---------------------------------------------------------------------------

export function checkMinRest(
  rule: SchedulingRule,
  existingAssignments: AssignmentWithShift[],
  requestedStart: Date,
  requestedEnd: Date,
): RuleViolation[] {
  const violations: RuleViolation[] = []
  const minRestHours: number = rule.parameters?.min_rest_hours ?? 12

  for (const a of existingAssignments) {
    const assignedEnd = getShiftEndDatetime(a.shift)
    const assignedStart = getShiftStartDatetime(a.shift)
    const restAfter = differenceInHours(requestedStart, assignedEnd)
    const restBefore = differenceInHours(assignedStart, requestedEnd)

    if (restAfter >= 0 && restAfter < minRestHours) {
      violations.push({
        rule: rule.name,
        severity: effectiveSeverity(rule),
        message: `You are already working a ${a.shift.shift_type} shift on ${format(parseISO(a.shift.date), 'dd MMM')}. There is not enough rest time between that shift and this one.`,
      })
    }
    if (restBefore >= 0 && restBefore < minRestHours) {
      violations.push({
        rule: rule.name,
        severity: effectiveSeverity(rule),
        message: `You are already working a ${a.shift.shift_type} shift on ${format(parseISO(a.shift.date), 'dd MMM')}. There is not enough rest time between this shift and that one.`,
      })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule: night_followup
//
// Intentionally a no-op. With shift times 09:00–17:00 / 17:00–01:00 /
// 01:00–09:00, every same-day or cross-day pairing of night with morning or
// evening produces a rest gap of 0h or 8h, both of which are already blocked
// by the 12h min_rest rule. This function always returns null so the rule can
// be toggled independently without affecting the consecutive-nights rule.
// ---------------------------------------------------------------------------

export function checkNightFollowup(
  _rule: SchedulingRule,
  _existingAssignments: AssignmentWithShift[],
  _requestedShift: Shift,
): RuleViolation | null {
  return null
}

// ---------------------------------------------------------------------------
// Rule: consecutive_nights_rest (independently toggleable from night_followup)
//
// After 2 consecutive night shifts, 2 full days off are required before the
// employee can work again. This is stricter than the 12h min_rest rule: the
// rest days block shifts with 24h+ gaps that min_rest would allow.
// ---------------------------------------------------------------------------

export function checkConsecutiveNightsRest(
  rule: SchedulingRule,
  existingAssignments: AssignmentWithShift[],
  requestedDate: Date,
): RuleViolation | null {
  const nightDates = existingAssignments
    .filter((a) => a.shift.shift_type === 'night')
    .map((a) => a.shift.date)
    .sort()

  const requestedDateStr = format(requestedDate, 'yyyy-MM-dd')

  for (let i = 0; i < nightDates.length - 1; i++) {
    const firstDate = nightDates[i]
    const expectedSecond = format(addDays(parseISO(firstDate), 1), 'yyyy-MM-dd')
    if (nightDates[i + 1] !== expectedSecond) continue

    // Found 2 consecutive nights — enforce 2 full rest days after the block.
    const restDay1 = format(addDays(parseISO(firstDate), 2), 'yyyy-MM-dd')
    const restDay2 = format(addDays(parseISO(firstDate), 3), 'yyyy-MM-dd')
    if (requestedDateStr === restDay1 || requestedDateStr === restDay2) {
      return {
        rule: rule.name,
        severity: effectiveSeverity(rule),
        message: `After 2 consecutive night shifts (${format(parseISO(firstDate), 'dd MMM')}–${format(parseISO(expectedSecond), 'dd MMM')}), 2 full days off are required before returning to work.`,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Rule: new_employee_pairing
// Night-shift rule (hard, every day of the week): a new employee must never be
// alone on a night shift, must never be paired with another new employee, and
// must always be paired with an experienced (non-new) guard. Non-night shifts
// are unaffected.
// ---------------------------------------------------------------------------

export function checkNewEmployeePairing(
  rule: SchedulingRule,
  employee: Employee,
  allAssignmentsOnShift: AssignmentWithEmployee[],
  shiftType: ShiftType,
): RuleViolation | null {
  if (!employee.is_new_employee) return null
  if (shiftType !== 'night') return null

  const others = allAssignmentsOnShift.filter((a) => a.employee_id !== employee.id)
  const otherNew = others.filter((a) => a.employee.is_new_employee)
  const hasExperienced = others.some((a) => !a.employee.is_new_employee)

  if (otherNew.length > 0) {
    const names = otherNew.map((a) => a.employee.name).join(', ')
    return {
      rule: rule.name,
      severity: 'error',
      message: `Two new employees cannot share a night shift (already on this shift: ${names}).`,
    }
  }

  if (!hasExperienced) {
    return {
      rule: rule.name,
      severity: 'error',
      message: 'A new employee on a night shift must be paired with an experienced guard.',
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Rule: consecutive_days
// ---------------------------------------------------------------------------

export function checkConsecutiveDays(
  rule: SchedulingRule,
  employee: Employee,
  existingAssignments: AssignmentWithShift[],
  requestedDate: Date,
): RuleViolation | null {
  const DAYS_BEFORE = 4
  const consecutiveBefore: string[] = []
  for (let i = 1; i <= DAYS_BEFORE; i++) {
    const checkDate = format(addDays(requestedDate, -i), 'yyyy-MM-dd')
    if (existingAssignments.some((a) => a.shift.date === checkDate)) {
      consecutiveBefore.push(checkDate)
    } else {
      break
    }
  }
  if (consecutiveBefore.length >= employee.weekly_days) {
    return {
      rule: rule.name,
      severity: effectiveSeverity(rule),
      message: `You have worked ${consecutiveBefore.length} consecutive days leading up to this shift. Check weekly rest allocation.`,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Rule: night_rest_preference (soft)
// Flags any shift within rest_days_after_night days of a previous night.
// ---------------------------------------------------------------------------

export function checkNightRestPreference(
  rule: SchedulingRule,
  existingAssignments: AssignmentWithShift[],
  requestedDate: Date,
): RuleViolation | null {
  const restDays: number = rule.parameters?.rest_days_after_night ?? 2
  const prevNight = existingAssignments.find((a) => {
    if (a.shift.shift_type !== 'night') return false
    const nightDate = parseISO(a.shift.date)
    const restEnd = addDays(nightDate, restDays)
    return requestedDate <= restEnd && requestedDate > nightDate
  })
  if (!prevNight) return null
  return {
    rule: rule.name,
    severity: effectiveSeverity(rule),
    message: `It is recommended to have ${restDays} consecutive days off after a night shift (night on ${format(parseISO(prevNight.shift.date), 'dd MMM')}). Manager may adjust if needed.`,
  }
}

// ---------------------------------------------------------------------------
// Rule: fairness_info (soft)
// ---------------------------------------------------------------------------

export function checkFairnessInfo(
  rule: SchedulingRule,
  isWeekend: boolean,
  isHoliday: boolean,
): RuleViolation | null {
  if (!isWeekend && !isHoliday) return null
  return {
    rule: rule.name,
    severity: effectiveSeverity(rule),
    message: `This is a ${isHoliday ? 'public holiday' : 'weekend'} shift. Weekend and holiday shifts are rotated fairly — manager will review allocation.`,
  }
}
