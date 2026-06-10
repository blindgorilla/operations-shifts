import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { format, getDaysInMonth, addDays, parseISO } from 'date-fns'
import { renderToBuffer } from '@react-pdf/renderer'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { SchedulePDF } from '@/lib/pdf/schedulePdf'

// ---------------------------------------------------------------------------
// Logo — read once at module level; fall back silently if file not present
// ---------------------------------------------------------------------------
let LOGO_SRC: string | null = null
try {
  const logoPath = path.join(process.cwd(), 'public', 'ms-logo-white.png')
  const buf = fs.readFileSync(logoPath)
  LOGO_SRC = `data:image/png;base64,${buf.toString('base64')}`
} catch {
  // file not yet committed — PDF renders with text fallback
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function monthBounds(month: string) {
  const [year, mon] = month.split('-').map(Number)
  const first = new Date(year, mon - 1, 1)
  return {
    year,
    mon,
    periodStart: format(first, 'yyyy-MM-dd'),
    periodEnd:   format(addDays(first, getDaysInMonth(first) - 1), 'yyyy-MM-dd'),
    daysInMonth: getDaysInMonth(first),
  }
}

// ---------------------------------------------------------------------------
// GET /api/schedule/pdf?month=yyyy-MM
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  // Auth — manager only
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

  const { year, mon, periodStart, periodEnd, daysInMonth } = monthBounds(month)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // ── 1. Latest published run for this month ───────────────────────────────
  const { data: runs } = await admin
    .from('schedule_runs')
    .select('id, generated_at, last_edited_at, parameters_snapshot')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'published')
    .order('generated_at', { ascending: false })
    .limit(1)

  const run = runs?.[0] ?? null
  if (!run) {
    return NextResponse.json({ error: 'No published schedule found for this month' }, { status: 404 })
  }

  // ── 2. Shifts for the period ─────────────────────────────────────────────
  const { data: rawShifts } = await admin
    .from('shifts')
    .select('id, date, shift_type')
    .gte('date', periodStart)
    .lte('date', periodEnd)

  const shifts = (rawShifts ?? []) as { id: string; date: string; shift_type: string }[]

  // ── 3. Published assignments for this run ────────────────────────────────
  const { data: rawAssignments } = await admin
    .from('shift_assignments')
    .select('employee_id, shift_id, override_reason')
    .eq('schedule_run_id', run.id)
    .eq('status', 'published')

  const assignments = (rawAssignments ?? []) as { employee_id: string; shift_id: string; override_reason?: string | null }[]

  // ── 4. Employees (names) ─────────────────────────────────────────────────
  const employeeIds = [...new Set(assignments.map(a => a.employee_id))]
  const { data: rawEmployees } = await admin
    .from('employees')
    .select('id, name')
    .in('id', employeeIds.length > 0 ? employeeIds : ['00000000-0000-0000-0000-000000000000'])

  const employees = (rawEmployees ?? []) as { id: string; name: string }[]

  // ── 5. Unfilled slots from snapshot ──────────────────────────────────────
  const unfilledSlots: { date: string; shift_type: string; day_type: string }[] =
    (run.parameters_snapshot as any)?.unfilled_slots ?? []

  // ── 6. Render PDF ────────────────────────────────────────────────────────
  const monthLabel   = format(parseISO(`${month}-01`), 'MMMM yyyy')
  const publishedAt  = format(parseISO(run.generated_at), 'MMM d, yyyy')
  const lastEditedAt = run.last_edited_at
    ? format(parseISO(run.last_edited_at), "MMM d, yyyy 'at' HH:mm")
    : null
  const generatedAt  = format(new Date(), "MMM d, yyyy 'at' HH:mm")

  const pdfBuffer = await renderToBuffer(
    <SchedulePDF
      monthLabel={monthLabel}
      publishedAt={publishedAt}
      lastEditedAt={lastEditedAt}
      generatedAt={generatedAt}
      employees={employees}
      shifts={shifts}
      assignments={assignments}
      unfilledSlots={unfilledSlots}
      logoSrc={LOGO_SRC}
      daysInMonth={daysInMonth}
      year={year}
      month={mon}
    />
  )

  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="schedule-${month}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
