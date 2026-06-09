/**
 * Dry-run script for the scheduling engine.
 * Run with: npx tsx lib/scheduler/dryRun.ts
 *
 * Uses 9 employees, July 2026, the confirmed coverage table, and two
 * time-off ranges. Prints the full schedule, fairness summary, and any
 * unfilled slots — no database access.
 */

import type { Employee, SchedulingRule } from '@/types'
import type { CoverageRequirement, TimeOff } from './types'
import { generateSchedule } from './generateSchedule'

// ---------------------------------------------------------------------------
// Sample employees (9 guards, 2 marked as new)
// ---------------------------------------------------------------------------

const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Alice Morgan',   email: 'alice@example.com',   role: 'employee', is_new_employee: false, employment_start_date: '2022-01-10', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e2', name: 'Ben Clarke',     email: 'ben@example.com',     role: 'employee', is_new_employee: false, employment_start_date: '2021-06-15', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e3', name: 'Cara Nguyen',    email: 'cara@example.com',    role: 'employee', is_new_employee: false, employment_start_date: '2020-03-20', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e4', name: 'David Osei',     email: 'david@example.com',   role: 'employee', is_new_employee: false, employment_start_date: '2023-02-01', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e5', name: 'Elena Petrov',   email: 'elena@example.com',   role: 'employee', is_new_employee: false, employment_start_date: '2019-09-05', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e6', name: 'Farid Hassan',   email: 'farid@example.com',   role: 'employee', is_new_employee: false, employment_start_date: '2022-11-12', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e7', name: 'Grace Kim',      email: 'grace@example.com',   role: 'employee', is_new_employee: false, employment_start_date: '2023-07-30', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e8', name: 'Hiro Tanaka',    email: 'hiro@example.com',    role: 'employee', is_new_employee: true,  employment_start_date: '2026-04-01', weekly_days: 5, created_at: '', updated_at: '' },
  { id: 'e9', name: 'Isla Brennan',   email: 'isla@example.com',    role: 'employee', is_new_employee: true,  employment_start_date: '2026-05-15', weekly_days: 5, created_at: '', updated_at: '' },
]

// ---------------------------------------------------------------------------
// Confirmed coverage requirements (from Decisions §2)
// Mon–Thu: evening=2, night=2. No morning.
// Friday:  evening=3, night=2. No morning.
// Weekend: morning=2, evening=2, night=2.
// Holiday: same as weekend.
// ---------------------------------------------------------------------------

const COVERAGE: CoverageRequirement[] = [
  // Weekday (Mon–Thu)
  { shift_type: 'evening', day_type: 'weekday', required_headcount: 2 },
  { shift_type: 'night',   day_type: 'weekday', required_headcount: 2 },
  // Friday
  { shift_type: 'evening', day_type: 'friday',  required_headcount: 3 },
  { shift_type: 'night',   day_type: 'friday',  required_headcount: 2 },
  // Weekend
  { shift_type: 'morning', day_type: 'weekend', required_headcount: 2 },
  { shift_type: 'evening', day_type: 'weekend', required_headcount: 2 },
  { shift_type: 'night',   day_type: 'weekend', required_headcount: 2 },
  // Holiday
  { shift_type: 'morning', day_type: 'holiday', required_headcount: 2 },
  { shift_type: 'evening', day_type: 'holiday', required_headcount: 2 },
  { shift_type: 'night',   day_type: 'holiday', required_headcount: 2 },
]

// ---------------------------------------------------------------------------
// Public holidays in July 2026
// ---------------------------------------------------------------------------

const PUBLIC_HOLIDAYS = [
  '2026-07-04', // Independence Day (falls on Saturday — also a weekend)
  '2026-07-14', // Bastille Day (Tuesday)
]

// ---------------------------------------------------------------------------
// Time-off ranges (approved leave)
// ---------------------------------------------------------------------------

const TIME_OFF: TimeOff[] = [
  { employee_id: 'e1', start_date: '2026-07-07', end_date: '2026-07-09', type: 'annual', status: 'approved' },
  { employee_id: 'e5', start_date: '2026-07-21', end_date: '2026-07-23', type: 'sick',   status: 'approved' },
]

// ---------------------------------------------------------------------------
// Scheduling rules — matching the names used in constraints.ts
// ---------------------------------------------------------------------------

const RULES: SchedulingRule[] = [
  {
    id: 'r1', name: 'min_rest', display_name: 'Min Rest (12h)',
    description: 'Minimum 12 hours between shifts.',
    severity: 'error', is_hard: true, is_enabled: true,
    parameters: { min_rest_hours: 12 }, created_at: '', updated_at: '',
  },
  {
    id: 'r2', name: 'night_followup', display_name: 'Night Follow-up',
    description: 'No AM/PM after a night; 2 days off after 2 consecutive nights.',
    severity: 'error', is_hard: true, is_enabled: true,
    parameters: { rest_days_after_consecutive_nights: 2 }, created_at: '', updated_at: '',
  },
  {
    id: 'r3', name: 'consecutive_days', display_name: 'Max Consecutive Days',
    description: 'Hard weekly cap enforced separately; existing predicate used as secondary check.',
    severity: 'error', is_hard: true, is_enabled: true,
    parameters: { max_consecutive_days: 5 }, created_at: '', updated_at: '',
  },
  {
    id: 'r4', name: 'new_employee_pairing', display_name: 'New Employee Pairing',
    description: 'Hard on Fri/Sat; soft mid-week.',
    severity: 'warning', is_hard: false, is_enabled: true,
    parameters: {}, created_at: '', updated_at: '',
  },
  {
    id: 'r5', name: 'fairness_info', display_name: 'Fairness',
    description: 'Soft: weekend, holiday, and total-load balance.',
    severity: 'warning', is_hard: false, is_enabled: true,
    parameters: { weight: 3 }, created_at: '', updated_at: '',
  },
]

// ---------------------------------------------------------------------------
// Run and print
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.padEnd(n)
}

function run(): void {
  console.log('='.repeat(80))
  console.log('  Scheduling engine dry run — July 2026')
  console.log('  9 employees | confirmed coverage | 2 holiday overrides | 2 leave ranges')
  console.log('='.repeat(80))

  const result = generateSchedule({
    month: '2026-07',
    employees: EMPLOYEES,
    coverageRequirements: COVERAGE,
    publicHolidays: PUBLIC_HOLIDAYS,
    timeOff: TIME_OFF,
    rules: RULES,
  })

  const { assignments, fairnessSummary, unfilledSlots } = result

  // Group assignments by date then shift_type
  const byDate = new Map<string, typeof assignments>()
  for (const a of assignments) {
    const key = `${a.date}|${a.shift_type}`
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(a)
  }

  const sortedKeys = [...byDate.keys()].sort()

  console.log('\n── SCHEDULE ─────────────────────────────────────────────────────────────────')
  console.log(pad('Date', 12) + pad('Day type', 10) + pad('Shift', 9) + 'Assigned employees')
  console.log('-'.repeat(80))

  let lastDate = ''
  for (const key of sortedKeys) {
    const [date, shiftType] = key.split('|')
    const group = byDate.get(key)!
    const dayType = group[0].day_type
    const names = group.map(a => EMPLOYEES.find(e => e.id === a.employee_id)?.name ?? a.employee_id).join(', ')
    const dateLabel = date !== lastDate ? date : ''
    lastDate = date
    console.log(pad(dateLabel, 12) + pad(dayType, 10) + pad(shiftType, 9) + names)
  }

  // Fairness summary
  console.log('\n── FAIRNESS SUMMARY ─────────────────────────────────────────────────────────')
  console.log(
    pad('Employee', 16) +
    pad('Total', 7) +
    pad('Weekends', 10) +
    pad('Holidays', 10) +
    'Nights',
  )
  console.log('-'.repeat(60))

  const empIds = EMPLOYEES.map(e => e.id)
  const totals  = empIds.map(id => fairnessSummary[id]?.totalShifts   ?? 0)
  const weekends = empIds.map(id => fairnessSummary[id]?.weekendShifts ?? 0)
  const holidays = empIds.map(id => fairnessSummary[id]?.holidayShifts ?? 0)
  const nights   = empIds.map(id => fairnessSummary[id]?.nightShifts   ?? 0)
  const avg = (arr: number[]) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)

  for (const emp of EMPLOYEES) {
    const c = fairnessSummary[emp.id]
    const tag = emp.is_new_employee ? ' (new)' : ''
    console.log(
      pad(emp.name + tag, 22) +
      pad(String(c?.totalShifts   ?? 0), 7) +
      pad(String(c?.weekendShifts ?? 0), 10) +
      pad(String(c?.holidayShifts ?? 0), 10) +
      String(c?.nightShifts ?? 0),
    )
  }
  console.log('-'.repeat(60))
  console.log(
    pad('AVERAGE', 22) +
    pad(avg(totals),   7) +
    pad(avg(weekends), 10) +
    pad(avg(holidays), 10) +
    avg(nights),
  )

  // Unfilled slots
  if (unfilledSlots.length === 0) {
    console.log('\n✓ All slots filled.\n')
  } else {
    console.log('\n── UNFILLED SLOTS ────────────────────────────────────────────────────────────')
    for (const s of unfilledSlots) {
      console.log(`  ${s.date}  ${s.day_type}  ${s.shift_type}  (${s.headcount} position(s) short)`)
    }
    console.log()
  }

  console.log(`Total assignments: ${assignments.length}`)
  console.log('='.repeat(80))
}

run()
