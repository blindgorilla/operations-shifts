import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { format, getDaysInMonth, addDays } from 'date-fns'

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be yyyy-MM'),
})

function monthBounds(month: string): { periodStart: string; periodEnd: string } {
  const [year, mon] = month.split('-').map(Number)
  const first = new Date(year, mon - 1, 1)
  return {
    periodStart: format(first, 'yyyy-MM-dd'),
    periodEnd:   format(addDays(first, getDaysInMonth(first) - 1), 'yyyy-MM-dd'),
  }
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { month } = parsed.data
  const { periodStart, periodEnd } = monthBounds(month)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // ── 1. Find the latest draft run for this month ───────────────────────────
  const { data: draftRuns } = await admin
    .from('schedule_runs')
    .select('id')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'draft')
    .order('generated_at', { ascending: false })
    .limit(1)

  const draftRun = draftRuns?.[0] ?? null
  if (!draftRun) {
    return NextResponse.json({ error: 'No draft schedule found for this month' }, { status: 404 })
  }

  const draftRunId: string = draftRun.id

  // ── 2. Flip draft assignments → published ────────────────────────────────
  const { data: updatedAssignments } = await admin
    .from('shift_assignments')
    .update({ status: 'published' })
    .eq('schedule_run_id', draftRunId)
    .eq('status', 'draft')
    .select('id')

  const assignmentCount = updatedAssignments?.length ?? 0

  // ── 3. Flip draft run → published ───────────────────────────────────────
  await admin
    .from('schedule_runs')
    .update({ status: 'published' })
    .eq('id', draftRunId)

  // ── 4. Supersede any prior published runs for the same month ─────────────
  // Scoped strictly to this month's runs — never touches other months or
  // legacy assignments with schedule_run_id IS NULL.
  const { data: priorRuns } = await admin
    .from('schedule_runs')
    .select('id')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'published')
    .neq('id', draftRunId)

  if (priorRuns && priorRuns.length > 0) {
    const priorIds: string[] = priorRuns.map((r: { id: string }) => r.id)

    await admin
      .from('shift_assignments')
      .update({ status: 'superseded' })
      .in('schedule_run_id', priorIds)
      .eq('status', 'published')

    await admin
      .from('schedule_runs')
      .update({ status: 'superseded' })
      .in('id', priorIds)
  }

  return NextResponse.json({
    run_id: draftRunId,
    month,
    assignment_count: assignmentCount ?? 0,
  })
}
