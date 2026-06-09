import { parseISO, addDays, format } from 'date-fns'
import type { Employee, SchedulingRule } from '@/types'
import type { Slot, GeneratedAssignment, FairnessSummary, EmployeeFairnessCounters } from './types'
import { emptyCounters } from './counters'

// ---------------------------------------------------------------------------
// Weights — can be overridden by rule.parameters.weight in the rules data.
// ---------------------------------------------------------------------------

const W = {
  weekendFairness: 3,
  holidayFairness: 3,
  totalShiftFairness: 1,
  fiveOnTwoOff: 5,       // penalty per day over 4 within a rolling 7-day window
  newEmpPairing: 2,      // soft penalty for pairing new employees on non-Fri/Sat
}

function ruleWeight(rules: SchedulingRule[], name: string, fallback: number): number {
  const r = rules.find(rule => rule.name === name)
  return r?.parameters?.weight ?? fallback
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** Count how many assignments fall in the 7-day window ending the day before slotDate. */
function recentWorkDays(recentDates: string[], slotDate: string): number {
  const end = parseISO(slotDate)
  const windowStart = format(addDays(end, -6), 'yyyy-MM-dd')
  return recentDates.filter(d => d >= windowStart && d < slotDate).length
}


// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

/**
 * Lower score = better candidate for the slot.
 *
 * Score is a weighted sum of soft-objective penalties:
 *   - Excess weekend shifts above team average (if weekend slot)
 *   - Excess holiday shifts above team average (if holiday slot)
 *   - Excess total shifts above team average
 *   - Consecutive-day pressure (rolling 7-day window toward 5-on/2-off)
 *   - Soft new-employee pairing penalty on non-Fri/Sat days
 */
export function scoreCandidate(
  employee: Employee,
  slot: Slot,
  counters: FairnessSummary,
  slotAssignmentsSoFar: GeneratedAssignment[],
  rules: SchedulingRule[],
  allEmployees: Employee[],
): number {
  const my = counters[employee.id] ?? emptyCounters()

  const wWeekend = ruleWeight(rules, 'fairness_info', W.weekendFairness)
  const wHoliday = ruleWeight(rules, 'fairness_info', W.holidayFairness)
  const wTotal   = ruleWeight(rules, 'fairness_info', W.totalShiftFairness)
  const wFiveTwo = W.fiveOnTwoOff
  const wPairing = W.newEmpPairing

  let score = 0

  if (slot.day_type === 'weekend') {
    const avg = mean(allEmployees.map(e => counters[e.id]?.weekendShifts ?? 0))
    score += wWeekend * (my.weekendShifts - avg)
  }

  if (slot.day_type === 'holiday') {
    const avg = mean(allEmployees.map(e => counters[e.id]?.holidayShifts ?? 0))
    score += wHoliday * (my.holidayShifts - avg)
  }

  const avgTotal = mean(allEmployees.map(e => counters[e.id]?.totalShifts ?? 0))
  score += wTotal * (my.totalShifts - avgTotal)

  // Consecutive-day pressure: penalise approaching / exceeding 5 days in 7
  const recentDays = recentWorkDays(my.recentDates, slot.date)
  if (recentDays >= 4) {
    score += wFiveTwo * (recentDays - 3)
  }

  // Soft new-employee mid-week pairing
  if (employee.is_new_employee && (slot.day_type === 'weekday' || slot.day_type === 'friday')) {
    const otherNewAssigned = slotAssignmentsSoFar.some(a => {
      const e = allEmployees.find(emp => emp.id === a.employee_id)
      return e?.is_new_employee
    })
    if (otherNewAssigned) score += wPairing
  }

  return score
}

// ---------------------------------------------------------------------------
// Counter mutation helpers (exported for use by the orchestrator)
// ---------------------------------------------------------------------------

export function updateCounters(
  counters: FairnessSummary,
  employeeId: string,
  slot: Slot,
): void {
  if (!counters[employeeId]) counters[employeeId] = emptyCounters()
  const c = counters[employeeId]
  c.totalShifts++
  if (slot.shift_type === 'morning') c.morningShifts++
  if (slot.shift_type === 'evening') c.eveningShifts++
  if (slot.shift_type === 'night') c.nightShifts++
  if (slot.day_type === 'weekend') c.weekendShifts++
  if (slot.day_type === 'holiday') c.holidayShifts++
  // Keep recentDates sorted; cap at last 14 days to bound memory
  if (!c.recentDates.includes(slot.date)) {
    c.recentDates.push(slot.date)
    c.recentDates.sort()
    if (c.recentDates.length > 14) c.recentDates = c.recentDates.slice(-14)
  }
}

export function revertCounters(
  counters: FairnessSummary,
  employeeId: string,
  slot: Slot,
): void {
  if (!counters[employeeId]) return
  const c = counters[employeeId]
  c.totalShifts--
  if (slot.shift_type === 'morning') c.morningShifts--
  if (slot.shift_type === 'evening') c.eveningShifts--
  if (slot.shift_type === 'night') c.nightShifts--
  if (slot.day_type === 'weekend') c.weekendShifts--
  if (slot.day_type === 'holiday') c.holidayShifts--
  // Only remove the date if the employee has no other assignment on the same date
}

/**
 * Global fairness penalty — sum of squared deviations from team mean for
 * weekend, holiday, and total-shift counts. Used by the repair pass.
 */
export function globalPenalty(counters: FairnessSummary, employeeIds: string[]): number {
  const ws = employeeIds.map(id => counters[id]?.weekendShifts ?? 0)
  const hs = employeeIds.map(id => counters[id]?.holidayShifts ?? 0)
  const ts = employeeIds.map(id => counters[id]?.totalShifts ?? 0)
  const avgW = mean(ws), avgH = mean(hs), avgT = mean(ts)
  let p = 0
  for (const id of employeeIds) {
    const c = counters[id] ?? emptyCounters()
    p += W.weekendFairness * (c.weekendShifts - avgW) ** 2
    p += W.holidayFairness * (c.holidayShifts - avgH) ** 2
    p += W.totalShiftFairness * (c.totalShifts - avgT) ** 2
  }
  return p
}
