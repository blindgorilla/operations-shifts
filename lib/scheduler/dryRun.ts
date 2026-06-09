/**
 * Dry-run harness for the scheduling engine.
 *
 * Usage:
 *   npx tsx lib/scheduler/dryRun.ts              # 25 runs, seeds 1-25
 *   npx tsx lib/scheduler/dryRun.ts --seed 7     # single detailed run
 *   npx tsx lib/scheduler/dryRun.ts --runs 50    # custom run count
 *
 * Each run uses a seeded PRNG to vary:
 *   - Target month   (rotates through 6 months: Jul 2026 – Dec 2026)
 *   - Which 2 employees are flagged is_new_employee
 *   - How many public holidays (0–2) and their dates
 *   - How many time-off ranges (0–3) and which employees / date windows
 *
 * Asserts zero hard violations on every run.
 */

import { getDaysInMonth, parseISO, getDay, addDays, format } from 'date-fns'
import type { Employee, Shift, SchedulingRule } from '@/types'
import type { CoverageRequirement, TimeOff, GeneratedAssignment } from './types'
import { generateSchedule } from './generateSchedule'
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

// ─────────────────────────────────────────────────────────────────────────────
// Seeded PRNG — mulberry32
// ─────────────────────────────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [lo, hi) */
function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo))
}

/** Fisher-Yates shuffle (mutates and returns the array) */
function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed data
// ─────────────────────────────────────────────────────────────────────────────

/** Base employee roster — new-employee flags are overridden per run. */
const BASE_EMPLOYEES: Omit<Employee, 'is_new_employee'>[] = [
  { id: 'e1', name: 'Alice Morgan',  email: 'alice@example.com',  role: 'employee', employment_start_date: '2022-01-10', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e2', name: 'Ben Clarke',    email: 'ben@example.com',    role: 'employee', employment_start_date: '2021-06-15', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e3', name: 'Cara Nguyen',   email: 'cara@example.com',   role: 'employee', employment_start_date: '2020-03-20', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e4', name: 'David Osei',    email: 'david@example.com',  role: 'employee', employment_start_date: '2023-02-01', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e5', name: 'Elena Petrov',  email: 'elena@example.com',  role: 'employee', employment_start_date: '2019-09-05', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e6', name: 'Farid Hassan',  email: 'farid@example.com',  role: 'employee', employment_start_date: '2022-11-12', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e7', name: 'Grace Kim',     email: 'grace@example.com',  role: 'employee', employment_start_date: '2023-07-30', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e8', name: 'Hiro Tanaka',   email: 'hiro@example.com',   role: 'employee', employment_start_date: '2026-04-01', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e9', name: 'Isla Brennan',  email: 'isla@example.com',   role: 'employee', employment_start_date: '2026-05-15', weekly_days: 5, created_at: '', updated_at: '' },
]

/** Coverage requirements are fixed (Decisions §2 of auto-scheduler-plan.md). */
const COVERAGE: CoverageRequirement[] = [
  { shift_type: 'evening', day_type: 'weekday', required_headcount: 2 },
  { shift_type: 'night',   day_type: 'weekday', required_headcount: 2 },
  { shift_type: 'evening', day_type: 'friday',  required_headcount: 3 },
  { shift_type: 'night',   day_type: 'friday',  required_headcount: 2 },
  { shift_type: 'morning', day_type: 'weekend', required_headcount: 2 },
  { shift_type: 'evening', day_type: 'weekend', required_headcount: 2 },
  { shift_type: 'night',   day_type: 'weekend', required_headcount: 2 },
  { shift_type: 'morning', day_type: 'holiday', required_headcount: 2 },
  { shift_type: 'evening', day_type: 'holiday', required_headcount: 2 },
  { shift_type: 'night',   day_type: 'holiday', required_headcount: 2 },
]

const RULES: SchedulingRule[] = [
  { id: 'r1', name: 'min_rest',            display_name: 'Min Rest (12h)',        description: '', severity: 'error',   is_hard: true,  is_enabled: true, parameters: { min_rest_hours: 12 },                   created_at: '', updated_at: '' },
  { id: 'r2', name: 'night_followup',      display_name: 'Night Follow-up',       description: '', severity: 'error',   is_hard: true,  is_enabled: true, parameters: { rest_days_after_consecutive_nights: 2 }, created_at: '', updated_at: '' },
  { id: 'r3', name: 'consecutive_days',    display_name: 'Max Consecutive Days',  description: '', severity: 'error',   is_hard: true,  is_enabled: true, parameters: { max_consecutive_days: 5 },               created_at: '', updated_at: '' },
  { id: 'r4', name: 'new_employee_pairing',display_name: 'New Employee Pairing',  description: '', severity: 'warning', is_hard: false, is_enabled: true, parameters: {},                                       created_at: '', updated_at: '' },
  { id: 'r5', name: 'fairness_info',       display_name: 'Fairness',              description: '', severity: 'warning', is_hard: false, is_enabled: true, parameters: { weight: 3 },                            created_at: '', updated_at: '' },
]

/** Six months to rotate through so tests cover varied day-of-week starts. */
const MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']

// ─────────────────────────────────────────────────────────────────────────────
// Randomised input generation
// ─────────────────────────────────────────────────────────────────────────────

interface RunInputs {
  month: string
  employees: Employee[]
  publicHolidays: string[]
  timeOff: TimeOff[]
}

function buildRunInputs(seed: number): RunInputs {
  const rng = makePrng(seed)

  // Month: deterministically cycle, then jitter with rng so seeds don't always
  // land on the same month boundary.
  const month = MONTHS[randInt(rng, 0, MONTHS.length)]

  // Pick which 2 employees are new (shuffle indices, take first 2)
  const indices = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  const newSet = new Set([indices[0], indices[1]])
  const employees: Employee[] = BASE_EMPLOYEES.map((e, i) => ({
    ...e,
    is_new_employee: newSet.has(i),
  }))

  // Public holidays: 0–2 days picked from the middle of the month to avoid
  // clustering near month boundaries which can produce edge-case unfilled slots.
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, mon - 1, 1))
  const holidayCount = randInt(rng, 0, 3) // 0, 1, or 2
  const pickedDays = new Set<number>()
  const publicHolidays: string[] = []
  while (pickedDays.size < holidayCount) {
    const d = randInt(rng, 4, daysInMonth - 3) // avoid first/last 3 days
    if (!pickedDays.has(d)) {
      pickedDays.add(d)
      const date = format(new Date(year, mon - 1, d), 'yyyy-MM-dd')
      publicHolidays.push(date)
    }
  }

  // Time-off: 0–3 employees each get one block of 2–5 days.
  // Ensure no two blocks for the same employee overlap (we only give 1 block
  // per employee here, so that's automatic).
  const timeOffCount = randInt(rng, 0, 4) // 0, 1, 2, or 3
  const shuffledEmps = shuffle(rng, [...employees])
  const timeOff: TimeOff[] = []
  for (let i = 0; i < timeOffCount; i++) {
    const emp = shuffledEmps[i]
    const startDay = randInt(rng, 2, daysInMonth - 6) // leave room for end
    const length = randInt(rng, 2, 6)                  // 2–5 days
    const endDay = Math.min(startDay + length - 1, daysInMonth)
    const startDate = format(new Date(year, mon - 1, startDay), 'yyyy-MM-dd')
    const endDate   = format(new Date(year, mon - 1, endDay),   'yyyy-MM-dd')
    timeOff.push({
      employee_id: emp.id,
      start_date: startDate,
      end_date: endDate,
      type: rng() < 0.5 ? 'annual' : 'sick',
      status: 'approved',
    })
  }

  return { month, employees, publicHolidays, timeOff }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard-constraint verifier
// ─────────────────────────────────────────────────────────────────────────────

const SHIFT_TIMES = {
  morning: { start: '07:00', end: '15:00' },
  evening: { start: '15:00', end: '23:00' },
  night:   { start: '23:00', end: '07:00' },
} as const

function makeVerifyShift(date: string, shiftType: 'morning' | 'evening' | 'night'): Shift {
  const t = SHIFT_TIMES[shiftType]
  return { id: `${date}-${shiftType}`, date, shift_type: shiftType, start_time: t.start, end_time: t.end, headcount: 1, location: null, role_required: null, notes: null, is_published: false, created_by: null, created_at: date, updated_at: date, request_status: 'open' }
}

function toAws(a: GeneratedAssignment): AssignmentWithShift {
  const shift = makeVerifyShift(a.date, a.shift_type)
  return { id: `v-${a.employee_id}-${a.date}-${a.shift_type}`, employee_id: a.employee_id, shift_id: shift.id, assigned_by: null, created_at: a.date, shift }
}

function toAwe(a: GeneratedAssignment, emp: Employee): AssignmentWithEmployee {
  return { id: `v-${a.employee_id}-${a.date}-${a.shift_type}`, employee_id: a.employee_id, shift_id: `${a.date}-${a.shift_type}`, assigned_by: null, created_at: a.date, employee: emp }
}

export interface HardViolation {
  rule: string
  employee: string
  date: string
  shiftType: string
  message: string
}

const DEFAULT_MIN_REST_RULE: SchedulingRule = {
  id: 'def', name: 'min_rest', display_name: 'Min Rest', description: '',
  severity: 'error', is_hard: true, is_enabled: true,
  parameters: { min_rest_hours: 12 }, created_at: '', updated_at: '',
}

export function verifySchedule(
  assignments: GeneratedAssignment[],
  employees: Employee[],
  timeOff: TimeOff[],
  coverage: CoverageRequirement[],
  rules: SchedulingRule[],
): HardViolation[] {
  const violations: HardViolation[] = []
  const findRule = (name: string) => rules.find(r => r.name === name)

  const minRestRule   = findRule('min_rest') ?? DEFAULT_MIN_REST_RULE
  const nightRule     = findRule('night_followup')
  const consRule      = findRule('consecutive_days')
  const pairingRule   = findRule('new_employee_pairing')

  // employee_id → sorted assignments
  const byEmployee = new Map<string, GeneratedAssignment[]>()
  for (const a of assignments) {
    if (!byEmployee.has(a.employee_id)) byEmployee.set(a.employee_id, [])
    byEmployee.get(a.employee_id)!.push(a)
  }
  for (const list of byEmployee.values()) list.sort((a, b) => a.date.localeCompare(b.date))

  // "date|shift_type" → assignments on that slot
  const bySlot = new Map<string, GeneratedAssignment[]>()
  for (const a of assignments) {
    const key = `${a.date}|${a.shift_type}`
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key)!.push(a)
  }

  const push = (rule: string, emp: string, date: string, shiftType: string, msg: string) =>
    violations.push({ rule, employee: emp, date, shiftType, message: msg })

  for (const [empId, empList] of byEmployee.entries()) {
    const employee = employees.find(e => e.id === empId)!
    const priorAws: AssignmentWithShift[] = []

    for (const a of empList) {
      const thisShift = makeVerifyShift(a.date, a.shift_type)
      const thisStart = getShiftStartDatetime(thisShift)
      const thisEnd   = getShiftEndDatetime(thisShift)
      const thisDate  = parseISO(a.date)
      const dow       = getDay(thisDate)
      const isFriday  = dow === 5
      const isSaturday = dow === 6

      // 1. Time-off conflict
      const onLeave = timeOff
        .filter(t => t.employee_id === empId && t.status === 'approved')
        .some(t => a.date >= t.start_date && a.date <= t.end_date)
      if (onLeave) push('time_off', employee.name, a.date, a.shift_type, `Assigned on approved leave day ${a.date}`)

      // 2. Min rest (12 h)
      for (const v of checkMinRest(minRestRule, priorAws, thisStart, thisEnd)) {
        if (v.severity === 'error') push('min_rest', employee.name, a.date, a.shift_type, v.message)
      }

      // 3. Night follow-up (a): no AM/PM day after a night
      if (nightRule) {
        const vF = checkNightFollowup(nightRule, priorAws, thisShift)
        if (vF?.severity === 'error') push('night_followup_am_pm', employee.name, a.date, a.shift_type, vF.message)

        // 4. Night follow-up (b): 2 days off after 2 consecutive nights
        const vC = checkConsecutiveNightsRest(nightRule, priorAws, thisDate)
        if (vC?.severity === 'error') push('night_followup_consec', employee.name, a.date, a.shift_type, vC.message)
      }

      // 5. Max consecutive days
      if (consRule) {
        const vD = checkConsecutiveDays(consRule, employee, priorAws, thisDate)
        if (vD?.severity === 'error') push('consecutive_days', employee.name, a.date, a.shift_type, vD.message)
      }

      // 6. 5-per-week hard cap
      const weekDow   = dow === 0 ? 6 : dow - 1
      const weekStart = format(addDays(thisDate, -weekDow), 'yyyy-MM-dd')
      const weekEnd   = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
      const weekCount = empList.filter(x => x.date >= weekStart && x.date <= weekEnd).length
      if (weekCount > 5) push('five_per_week', employee.name, a.date, a.shift_type, `${weekCount} shifts in week ${weekStart}–${weekEnd} (max 5)`)

      // 7. Fri/Sat new-employee pairing
      if (pairingRule && employee.is_new_employee && (isFriday || isSaturday)) {
        const slotKey  = `${a.date}|${a.shift_type}`
        const coWorkers = (bySlot.get(slotKey) ?? []).filter(x => x.employee_id !== empId)
        const coAwe = coWorkers.flatMap(x => {
          const e = employees.find(emp => emp.id === x.employee_id)
          return e ? [toAwe(x, e)] : []
        })
        const vP = checkNewEmployeePairing(pairingRule, employee, coAwe, isFriday, isSaturday)
        if (vP?.severity === 'error') push('new_employee_pairing', employee.name, a.date, a.shift_type, vP.message)
      }

      priorAws.push(toAws(a))
    }
  }

  // 8. Headcount never exceeded
  for (const [key, slotList] of bySlot.entries()) {
    const [date, shiftType] = key.split('|')
    const dayType = slotList[0].day_type
    const req = coverage.find(c => c.shift_type === shiftType && c.day_type === dayType)
    const limit = req?.required_headcount ?? Infinity
    if (slotList.length > limit) {
      push('headcount_exceeded', '(slot)', date, shiftType,
        `${slotList.length} assigned but headcount limit is ${limit}`)
    }
  }

  return violations
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-run detail printer (used when --seed is supplied)
// ─────────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string { return s.padEnd(n) }

function printDetailedRun(seed: number): void {
  const { month, employees, publicHolidays, timeOff } = buildRunInputs(seed)

  console.log('='.repeat(80))
  console.log(`  Detailed run — seed ${seed}`)
  console.log(`  Month: ${month} | new employees: ${employees.filter(e => e.is_new_employee).map(e => e.name).join(', ')}`)
  console.log(`  Public holidays: ${publicHolidays.join(', ') || 'none'}`)
  console.log(`  Time-off: ${timeOff.map(t => `${t.employee_id} ${t.start_date}–${t.end_date}`).join(', ') || 'none'}`)
  console.log('='.repeat(80))

  const result = generateSchedule({ month, employees, coverageRequirements: COVERAGE, publicHolidays, timeOff, rules: RULES })
  const { assignments, fairnessSummary, unfilledSlots } = result

  // Schedule table
  const byDate = new Map<string, typeof assignments>()
  for (const a of assignments) {
    const key = `${a.date}|${a.shift_type}`
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(a)
  }
  console.log('\n── SCHEDULE ─────────────────────────────────────────────────────────────────')
  console.log(pad('Date', 12) + pad('Day type', 10) + pad('Shift', 9) + 'Employees')
  console.log('-'.repeat(80))
  let lastDate = ''
  for (const key of [...byDate.keys()].sort()) {
    const [date, shiftType] = key.split('|')
    const group = byDate.get(key)!
    const names = group.map(a => employees.find(e => e.id === a.employee_id)?.name ?? a.employee_id).join(', ')
    const label = date !== lastDate ? date : ''
    lastDate = date
    console.log(pad(label, 12) + pad(group[0].day_type, 10) + pad(shiftType, 9) + names)
  }

  // Fairness
  console.log('\n── FAIRNESS SUMMARY ─────────────────────────────────────────────────────────')
  console.log(pad('Employee', 22) + pad('Total', 7) + pad('Weekends', 10) + pad('Holidays', 10) + 'Nights')
  console.log('-'.repeat(60))
  const empIds = employees.map(e => e.id)
  const avg = (arr: number[]) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)
  for (const emp of employees) {
    const c = fairnessSummary[emp.id]
    const tag = emp.is_new_employee ? ' (new)' : ''
    console.log(pad(emp.name + tag, 22) + pad(String(c?.totalShifts ?? 0), 7) + pad(String(c?.weekendShifts ?? 0), 10) + pad(String(c?.holidayShifts ?? 0), 10) + String(c?.nightShifts ?? 0))
  }
  console.log('-'.repeat(60))
  console.log(pad('AVERAGE', 22) +
    pad(avg(empIds.map(id => fairnessSummary[id]?.totalShifts ?? 0)), 7) +
    pad(avg(empIds.map(id => fairnessSummary[id]?.weekendShifts ?? 0)), 10) +
    pad(avg(empIds.map(id => fairnessSummary[id]?.holidayShifts ?? 0)), 10) +
    avg(empIds.map(id => fairnessSummary[id]?.nightShifts ?? 0)))

  // Unfilled
  if (unfilledSlots.length === 0) {
    console.log('\n✓ All slots filled.')
  } else {
    console.log('\n── UNFILLED SLOTS ────────────────────────────────────────────────────────────')
    for (const s of unfilledSlots) {
      console.log(`  ${s.date}  ${s.day_type}  ${s.shift_type}  (${s.headcount} position(s) short)`)
    }
  }

  // Verification
  console.log(`\nTotal assignments: ${assignments.length}`)
  console.log('\n── HARD CONSTRAINT VERIFICATION ─────────────────────────────────────────────')
  const hardViolations = verifySchedule(assignments, employees, timeOff, COVERAGE, RULES)
  if (hardViolations.length === 0) {
    console.log('PASS — 0 hard violations found.')
  } else {
    const byRule = new Map<string, number>()
    for (const v of hardViolations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1)
    const breakdown = [...byRule.entries()].map(([r, n]) => `${r}: ${n}`).join(', ')
    console.log(`FAIL — ${hardViolations.length} violation(s). Breakdown: ${breakdown}`)
    for (const v of hardViolations) {
      console.log(`  [${v.rule}] ${v.employee} | ${v.date} ${v.shiftType}`)
      console.log(`    ${v.message}`)
    }
  }
  console.log('='.repeat(80))
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-run harness
// ─────────────────────────────────────────────────────────────────────────────

interface RunResult {
  seed: number
  month: string
  violations: HardViolation[]
  unfilledCount: number
  assignmentCount: number
}

function runOnce(seed: number): RunResult {
  const { month, employees, publicHolidays, timeOff } = buildRunInputs(seed)
  const result = generateSchedule({ month, employees, coverageRequirements: COVERAGE, publicHolidays, timeOff, rules: RULES })
  const violations = verifySchedule(result.assignments, employees, timeOff, COVERAGE, RULES)
  return {
    seed,
    month,
    violations,
    unfilledCount: result.unfilledSlots.reduce((s, sl) => s + sl.headcount, 0),
    assignmentCount: result.assignments.length,
  }
}

function runSuite(runCount: number): void {
  console.log('='.repeat(80))
  console.log(`  Scheduling engine — fuzz suite: ${runCount} seeded runs`)
  console.log(`  Months in rotation: ${MONTHS.join(', ')}`)
  console.log('='.repeat(80))
  console.log()
  console.log(pad('Seed', 7) + pad('Month', 10) + pad('Assignments', 13) + pad('Unfilled', 10) + 'Result')
  console.log('-'.repeat(55))

  const results: RunResult[] = []
  for (let seed = 1; seed <= runCount; seed++) {
    const r = runOnce(seed)
    results.push(r)
    const status = r.violations.length === 0 ? 'PASS' : `FAIL (${r.violations.length} violation(s))`
    console.log(pad(String(r.seed), 7) + pad(r.month, 10) + pad(String(r.assignmentCount), 13) + pad(String(r.unfilledCount), 10) + status)
  }

  const totalViolations  = results.reduce((s, r) => s + r.violations.length, 0)
  const worstUnfilled    = Math.max(...results.map(r => r.unfilledCount))
  const failingRuns      = results.filter(r => r.violations.length > 0)

  console.log()
  console.log('─'.repeat(55))
  console.log(`Runs:               ${runCount}`)
  console.log(`Total violations:   ${totalViolations}`)
  console.log(`Worst unfilled:     ${worstUnfilled} position(s) across a single run`)
  console.log(`Pass rate:          ${runCount - failingRuns.length}/${runCount}`)

  if (failingRuns.length > 0) {
    console.log()
    console.log('FAILING RUNS (reproduce with: npx tsx lib/scheduler/dryRun.ts --seed <N>):')
    for (const r of failingRuns) {
      const byRule = new Map<string, number>()
      for (const v of r.violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1)
      const breakdown = [...byRule.entries()].map(([rule, n]) => `${rule}: ${n}`).join(', ')
      console.log(`  seed ${r.seed}  month ${r.month}  — ${breakdown}`)
      for (const v of r.violations) {
        console.log(`    [${v.rule}] ${v.employee} | ${v.date} ${v.shiftType}: ${v.message}`)
      }
    }
    console.log()
    console.log('OVERALL: FAIL')
  } else {
    console.log()
    console.log('OVERALL: PASS — 0 hard violations across all runs.')
  }

  console.log('='.repeat(80))

  // Exit non-zero if any violations found so CI can catch regressions.
  if (failingRuns.length > 0) process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const seedArg  = args.indexOf('--seed')
const runsArg  = args.indexOf('--runs')

if (seedArg !== -1) {
  printDetailedRun(Number(args[seedArg + 1]))
} else {
  const runCount = runsArg !== -1 ? Number(args[runsArg + 1]) : 25
  runSuite(runCount)
}
