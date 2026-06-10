import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { format, getDaysInMonth, addDays } from 'date-fns'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('employees')
    .select('role')
    .eq('id', user.id)
    .single()

  if (caller?.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden — managers only' }, { status: 403 })
  }

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (yyyy-MM)' }, { status: 400 })
  }

  const [year, mon] = month.split('-').map(Number)
  const first = new Date(year, mon - 1, 1)
  const periodStart = format(first, 'yyyy-MM-dd')
  const periodEnd = format(addDays(first, getDaysInMonth(first) - 1), 'yyyy-MM-dd')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: runs } = await admin
    .from('schedule_runs')
    .select('id, period_start, period_end, status, generated_at, last_edited_at, fairness_summary, parameters_snapshot')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'published')
    .order('generated_at', { ascending: false })
    .limit(1)

  const run = runs?.[0] ?? null

  if (!run) {
    return NextResponse.json({ run: null, shifts: [], assignments: [] })
  }

  const { data: shifts } = await admin
    .from('shifts')
    .select('*')
    .gte('date', periodStart)
    .lte('date', periodEnd)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const { data: assignments } = await admin
    .from('shift_assignments')
    .select('id, employee_id, shift_id, override_reason')
    .eq('schedule_run_id', run.id)
    .eq('status', 'published')

  const countMap: Record<string, number> = {}
  for (const a of assignments ?? []) {
    countMap[a.shift_id] = (countMap[a.shift_id] ?? 0) + 1
  }

  const shiftsWithCounts = (shifts ?? []).map((s: any) => ({
    ...s,
    assignment_count: countMap[s.id] ?? 0,
  }))

  // Approved leave overlapping this period (for sick/absent flagging on the published view)
  const { data: leaveRaw } = await admin
    .from('time_off')
    .select('id, employee_id, start_date, end_date, type')
    .eq('status', 'approved')
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart)

  return NextResponse.json({
    run,
    shifts: shiftsWithCounts,
    assignments: assignments ?? [],
    leaveRecords: leaveRaw ?? [],
  })
}
