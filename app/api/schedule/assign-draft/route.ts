import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseISO, getDay } from 'date-fns'
import { suggestCandidates } from '@/lib/scheduler/suggester'
import type { GeneratedAssignment, DayType, TimeOff } from '@/lib/scheduler/types'
import type { Employee, SchedulingRule } from '@/types'

const bodySchema = z.object({
  run_id:      z.string().uuid(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_type:  z.enum(['morning', 'evening', 'night']),
  employee_id: z.string().uuid(),
  override:    z.boolean().optional().default(false),
})

function computeDayType(date: string, holidays: string[]): DayType {
  if (holidays.includes(date)) return 'holiday'
  const dow = getDay(parseISO(date))
  if (dow === 0 || dow === 6) return 'weekend'
  if (dow === 5) return 'friday'
  return 'weekday'
}

export async function POST(request: Request) {
  // Auth — plain client for session only
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('employees').select('role').eq('id', user.id).single()
  if (caller?.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })

  const { run_id, date, shift_type, employee_id, override } = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Verify run is draft
  const { data: run } = await admin
    .from('schedule_runs')
    .select('id, status, period_start, period_end')
    .eq('id', run_id)
    .single()

  if (!run) return NextResponse.json({ error: 'Schedule run not found' }, { status: 404 })
  if (run.status !== 'draft') return NextResponse.json({ error: 'Can only assign on draft schedules' }, { status: 409 })

  // Find the shift row by date + shift_type
  const { data: shifts } = await admin
    .from('shifts')
    .select('id, headcount')
    .eq('date', date)
    .eq('shift_type', shift_type)
    .gte('date', run.period_start)
    .lte('date', run.period_end)
    .limit(1)

  const shift = shifts?.[0] ?? null
  if (!shift) {
    return NextResponse.json(
      { error: `No shift row found for ${date} ${shift_type} — the schedule may need to be regenerated` },
      { status: 404 },
    )
  }

  // Check employee exists and is active
  const { data: emp } = await admin.from('employees').select('id, is_active').eq('id', employee_id).single()
  if (!emp || !emp.is_active) return NextResponse.json({ error: 'Employee not found or inactive' }, { status: 404 })

  // Check for duplicate assignment (already assigned to this slot in this run)
  const { data: existingForSlot } = await admin
    .from('shift_assignments')
    .select('id, employee_id')
    .eq('schedule_run_id', run_id)
    .eq('shift_id', shift.id)
    .eq('status', 'draft')

  if ((existingForSlot ?? []).some(a => a.employee_id === employee_id)) {
    return NextResponse.json({ error: 'Guard is already assigned to this slot' }, { status: 409 })
  }

  // Eligibility check — always run to capture rule reason.
  // When override=false it also gates the assign.
  let rule_reason: string | null = null
  {
    const { data: allAssignmentsRaw } = await admin
      .from('shift_assignments')
      .select('id, employee_id, shift_id')
      .eq('schedule_run_id', run_id)
      .eq('status', 'draft')

    const { data: shiftsForPeriod } = await admin
      .from('shifts')
      .select('id, date, shift_type')
      .gte('date', run.period_start)
      .lte('date', run.period_end)

    const shiftById: Record<string, { date: string; shift_type: string }> = {}
    for (const s of shiftsForPeriod ?? []) shiftById[s.id] = { date: s.date, shift_type: s.shift_type }

    const { data: holidaysRaw } = await admin
      .from('public_holidays')
      .select('date')
      .gte('date', run.period_start)
      .lte('date', run.period_end)

    const holidays: string[] = (holidaysRaw ?? []).map((h: { date: string }) => h.date)

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

    const { data: rulesRaw } = await admin.from('scheduling_rules').select('*').eq('is_enabled', true)
    const rules: SchedulingRule[] = rulesRaw ?? []

    const { data: employeesRaw } = await admin.from('employees').select('*').eq('is_active', true).eq('role', 'employee')
    const employees: Employee[] = employeesRaw ?? []

    const allAssignments: GeneratedAssignment[] = []
    for (const a of allAssignmentsRaw ?? []) {
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
    const slot = { date, shift_type, day_type: dayType, headcount: shift.headcount }
    const result = suggestCandidates(slot, allAssignments, employees, timeOff, rules)

    const isElig = result.eligible.some(c => c.employee.id === employee_id)
    if (!isElig) {
      const ineligEntry = result.ineligible.find(c => c.employee.id === employee_id)
      const reason = ineligEntry?.reason ?? 'Ineligible for this slot'
      if (!override) {
        return NextResponse.json({ error: reason, ineligible: true }, { status: 422 })
      }
      rule_reason = reason
    }
  }

  // Insert the assignment
  const { data: inserted, error: insertErr } = await admin
    .from('shift_assignments')
    .insert({
      employee_id,
      shift_id: shift.id,
      assigned_by: user.id,
      schedule_run_id: run_id,
      status: 'draft',
      ...(rule_reason ? { override_reason: rule_reason } : {}),
    })
    .select('id, employee_id, shift_id, override_reason')
    .single()

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ assignment: inserted, rule_reason })
}
