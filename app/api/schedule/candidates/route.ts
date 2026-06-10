import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { parseISO, getDay } from 'date-fns'
import { suggestCandidates } from '@/lib/scheduler/suggester'
import type { GeneratedAssignment, DayType, TimeOff } from '@/lib/scheduler/types'
import type { Employee, SchedulingRule } from '@/types'

function computeDayType(date: string, holidays: string[]): DayType {
  if (holidays.includes(date)) return 'holiday'
  const dow = getDay(parseISO(date))
  if (dow === 0 || dow === 6) return 'weekend'
  if (dow === 5) return 'friday'
  return 'weekday'
}

export async function GET(request: Request) {
  // Auth — plain client for session only
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('employees').select('role').eq('id', user.id).single()
  if (caller?.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const run_id    = url.searchParams.get('run_id')
  const date      = url.searchParams.get('date')
  const shiftType = url.searchParams.get('shift_type')

  if (!run_id || !date || !shiftType) {
    return NextResponse.json({ error: 'run_id, date, shift_type required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be yyyy-MM-dd' }, { status: 400 })
  }
  if (!['morning', 'evening', 'night'].includes(shiftType)) {
    return NextResponse.json({ error: 'shift_type must be morning | evening | night' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Verify run exists and is draft
  const { data: run } = await admin
    .from('schedule_runs')
    .select('id, status, period_start, period_end')
    .eq('id', run_id)
    .single()

  if (!run) return NextResponse.json({ error: 'Schedule run not found' }, { status: 404 })
  if (run.status !== 'draft') return NextResponse.json({ error: 'Schedule run is not a draft' }, { status: 409 })

  // All employees (active, role=employee)
  const { data: employeesRaw } = await admin
    .from('employees')
    .select('*')
    .eq('is_active', true)
    .eq('role', 'employee')

  const employees: Employee[] = employeesRaw ?? []

  // All draft assignments for this run
  const { data: assignmentsRaw } = await admin
    .from('shift_assignments')
    .select('id, employee_id, shift_id')
    .eq('schedule_run_id', run_id)
    .eq('status', 'draft')

  // Shifts for the run period — needed to map shift_id → date + shift_type
  const { data: shiftsRaw } = await admin
    .from('shifts')
    .select('id, date, shift_type')
    .gte('date', run.period_start)
    .lte('date', run.period_end)

  const shiftById: Record<string, { date: string; shift_type: string }> = {}
  for (const s of shiftsRaw ?? []) shiftById[s.id] = { date: s.date, shift_type: s.shift_type }

  // Holidays for the period
  const { data: holidaysRaw } = await admin
    .from('public_holidays')
    .select('date')
    .gte('date', run.period_start)
    .lte('date', run.period_end)

  const holidays: string[] = (holidaysRaw ?? []).map((h: { date: string }) => h.date)

  // Approved time-off for the period
  const { data: timeOffRaw } = await admin
    .from('time_off')
    .select('employee_id, start_date, end_date, type, status')
    .eq('status', 'approved')
    .lte('start_date', run.period_end)
    .gte('end_date', run.period_start)

  const timeOff: TimeOff[] = (timeOffRaw ?? []).map((t: any) => ({
    employee_id: t.employee_id,
    start_date: t.start_date,
    end_date: t.end_date,
    type: t.type,
    status: t.status,
  }))

  // Rules
  const { data: rulesRaw } = await admin
    .from('scheduling_rules')
    .select('*')
    .eq('is_enabled', true)

  const rules: SchedulingRule[] = rulesRaw ?? []

  // Build GeneratedAssignment[] from flat shift_assignments rows
  const allAssignments: GeneratedAssignment[] = []
  for (const a of assignmentsRaw ?? []) {
    const s = shiftById[a.shift_id]
    if (!s) continue
    allAssignments.push({
      employee_id: a.employee_id,
      date: s.date,
      shift_type: s.shift_type as any,
      day_type: computeDayType(s.date, holidays),
      reason: '',
    })
  }

  const dayType = computeDayType(date, holidays)
  const slot = { date, shift_type: shiftType as any, day_type: dayType, headcount: 1 }

  const result = suggestCandidates(slot, allAssignments, employees, timeOff, rules)

  return NextResponse.json({
    eligible: result.eligible.map(c => ({
      employee_id: c.employee.id,
      name: c.employee.name,
      score: c.score,
      reason: c.reason,
      load: c.load,
    })),
    ineligible: result.ineligible.map(c => ({
      employee_id: c.employee.id,
      name: c.employee.name,
      reason: c.reason,
    })),
  })
}
