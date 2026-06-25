import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { parseISO, getDay, endOfMonth, format } from 'date-fns'

type DayType = 'weekday' | 'friday' | 'weekend' | 'holiday'

const SHIFT_TYPE_LABEL: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  night: 'Night',
}

function computeDayType(date: string, holidays: string[]): DayType {
  if (holidays.includes(date)) return 'holiday'
  const dow = getDay(parseISO(date))
  if (dow === 0 || dow === 6) return 'weekend'
  if (dow === 5) return 'friday'
  return 'weekday'
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('employees').select('role').eq('id', user.id).single()
  if (caller?.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be yyyy-MM' }, { status: 400 })
  }

  const periodStart = `${month}-01`
  const periodEnd = format(endOfMonth(parseISO(periodStart)), 'yyyy-MM-dd')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: pins, error } = await admin
    .from('pinned_assignments')
    .select('id, employee_id, date, shift_type, note')
    .gte('date', periodStart)
    .lte('date', periodEnd)
    .order('date', { ascending: true })
    .order('shift_type', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to load pinned assignments' }, { status: 500 })

  return NextResponse.json({ pins: pins ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('employees').select('role').eq('id', user.id).single()
  if (caller?.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const employee_id = body?.employee_id
  const date = body?.date
  const shift_type = body?.shift_type
  const note: string | null = body?.note ?? null

  if (!employee_id || !date || !shift_type) {
    return NextResponse.json({ error: 'employee_id, date, shift_type required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be yyyy-MM-dd' }, { status: 400 })
  }
  if (!['morning', 'evening', 'night'].includes(shift_type)) {
    return NextResponse.json({ error: 'shift_type must be morning | evening | night' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: employee } = await admin
    .from('employees')
    .select('id, name')
    .eq('id', employee_id)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const { data: created, error: insertError } = await admin
    .from('pinned_assignments')
    .insert({ employee_id, date, shift_type, note, created_by: user.id })
    .select('id, employee_id, date, shift_type, note')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'This guard is already guaranteed that shift on that date' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Failed to create pinned assignment' }, { status: 500 })
  }

  // ---- Compute warnings (advisory only — do not block the insert) ----
  const warnings: string[] = []

  const { data: holidayRows } = await admin
    .from('public_holidays')
    .select('date')
    .eq('date', date)
  const holidays: string[] = (holidayRows ?? []).map((h: { date: string }) => h.date)
  const dayType = computeDayType(date, holidays)

  const { data: coverage } = await admin
    .from('coverage_requirements')
    .select('required_headcount')
    .eq('shift_type', shift_type)
    .eq('day_type', dayType)
    .single()

  if (coverage && coverage.required_headcount === 0) {
    const shiftLabel = SHIFT_TYPE_LABEL[shift_type] ?? shift_type
    warnings.push(
      `${shiftLabel} shifts aren't scheduled on ${dayType}s — this pin won't be placed unless that date becomes a holiday/weekend.`,
    )
  }

  const { data: timeOffRows } = await admin
    .from('time_off')
    .select('id')
    .eq('employee_id', employee_id)
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date)

  if (timeOffRows && timeOffRows.length > 0) {
    warnings.push(`${employee.name} is on approved leave that day — generating will place them anyway, overriding it.`)
  }

  const { data: otherPins } = await admin
    .from('pinned_assignments')
    .select('id')
    .eq('employee_id', employee_id)
    .eq('date', date)
    .neq('id', created.id)

  if (otherPins && otherPins.length > 0) {
    warnings.push(`${employee.name} already has another guaranteed shift that day — check for rest conflicts.`)
  }

  return NextResponse.json({ pin: created, warnings })
}
