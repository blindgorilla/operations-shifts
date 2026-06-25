import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { format, getDaysInMonth, addDays, parseISO, getDay } from 'date-fns'
import { generateSchedule } from '@/lib/scheduler/generateSchedule'
import { emptyCounters } from '@/lib/scheduler/counters'
import type { CoverageRequirement, TimeOff, FairnessSummary, EmployeeFairnessCounters } from '@/lib/scheduler/types'
import type { Employee, SchedulingRule } from '@/types'

// ---------------------------------------------------------------------------
// Canonical shift times — kept in sync with lib/scheduler/eligibility.ts
// ---------------------------------------------------------------------------

const SHIFT_START: Record<string, string> = {
  morning: '09:00',
  evening: '17:00',
  night:   '01:00',
}

const SHIFT_END: Record<string, string> = {
  morning: '17:00',
  evening: '01:00',
  night:   '09:00',
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  /** yyyy-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be yyyy-MM'),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthBounds(month: string): { periodStart: string; periodEnd: string } {
  const [year, mon] = month.split('-').map(Number)
  const first = new Date(year, mon - 1, 1)
  const days = getDaysInMonth(first)
  return {
    periodStart: format(first, 'yyyy-MM-dd'),
    periodEnd:   format(addDays(first, days - 1), 'yyyy-MM-dd'),
  }
}


// ---------------------------------------------------------------------------
// POST /api/schedule/generate
// ---------------------------------------------------------------------------

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

  // Parse body
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

  // ── 1. Handle existing draft for this month ────────────────────────────────
  // Delete the existing draft and its assignments rather than returning an error,
  // since the manager clicking Generate twice means "redo it".
  const { data: existingRuns } = await admin
    .from('schedule_runs')
    .select('id')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'draft')

  if (existingRuns && existingRuns.length > 0) {
    const existingRunIds = existingRuns.map((r: { id: string }) => r.id)

    await admin
      .from('shift_assignments')
      .delete()
      .in('schedule_run_id', existingRunIds)

    await admin
      .from('schedule_runs')
      .delete()
      .in('id', existingRunIds)
  }

  // ── 2. Gather inputs (separate sequential queries — no FK joins) ───────────

  // 2a. Active non-manager employees (managers must never be scheduled as guards)
  const { data: rawEmployees, error: empError } = await admin
    .from('employees')
    .select('id, name, email, role, employment_start_date, weekly_days, is_new_employee, is_active, created_at, updated_at')
    .eq('is_active', true)
    .eq('role', 'employee')

  if (empError || !rawEmployees || rawEmployees.length === 0) {
    return NextResponse.json({ error: 'No active employees found' }, { status: 422 })
  }

  const employees: Employee[] = rawEmployees

  // 2b. Approved time-off overlapping the target month
  const { data: rawTimeOff } = await admin
    .from('time_off')
    .select('employee_id, start_date, end_date, type, status')
    .eq('status', 'approved')
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart)

  const timeOff: TimeOff[] = (rawTimeOff ?? []).map((t: any) => ({
    employee_id: t.employee_id,
    start_date:  t.start_date,
    end_date:    t.end_date,
    type:        t.type,
    status:      t.status,
  }))

  // 2c. Coverage requirements
  const { data: rawCoverage, error: covError } = await admin
    .from('coverage_requirements')
    .select('shift_type, day_type, required_headcount')

  if (covError || !rawCoverage || rawCoverage.length === 0) {
    return NextResponse.json({ error: 'No coverage requirements configured' }, { status: 422 })
  }

  const coverageRequirements: CoverageRequirement[] = rawCoverage

  // 2d. Public holidays in the month
  const { data: rawHolidays } = await admin
    .from('public_holidays')
    .select('date')
    .gte('date', periodStart)
    .lte('date', periodEnd)

  const publicHolidays: string[] = (rawHolidays ?? []).map((h: { date: string }) => h.date)

  // 2e. Enabled scheduling rules (with is_hard, weight, parameters)
  const { data: rawRules } = await admin
    .from('scheduling_rules')
    .select('id, name, display_name, description, severity, is_hard, weight, is_enabled, parameters, created_at, updated_at')
    .eq('is_enabled', true)

  const rules: SchedulingRule[] = (rawRules ?? [])

  // 2f. Carry-forward fairness counters from the previous month's published run
  const [prevYear, prevMon] = (() => {
    const [y, m] = month.split('-').map(Number)
    return m === 1 ? [y - 1, 12] : [y, m - 1]
  })()
  const prevMonthStr = `${String(prevYear).padStart(4, '0')}-${String(prevMon).padStart(2, '0')}`
  const prevPeriodStart = format(new Date(prevYear, prevMon - 1, 1), 'yyyy-MM-dd')
  const prevPeriodEnd   = format(addDays(new Date(prevYear, prevMon - 1, 1), getDaysInMonth(new Date(prevYear, prevMon - 1, 1)) - 1), 'yyyy-MM-dd')

  const { data: prevRuns } = await admin
    .from('schedule_runs')
    .select('id, fairness_summary')
    .eq('period_start', prevPeriodStart)
    .eq('period_end', prevPeriodEnd)
    .eq('status', 'published')
    .order('generated_at', { ascending: false })
    .limit(1)

  let carryForwardCounters: FairnessSummary | undefined

  if (prevRuns && prevRuns.length > 0 && prevRuns[0].fairness_summary) {
    // Use stored fairness_summary from the published run as carry-forward
    carryForwardCounters = prevRuns[0].fairness_summary as FairnessSummary
  } else {
    // Derive from published assignments in the previous month (first run ever)
    const { data: prevAssignments } = await admin
      .from('shift_assignments')
      .select('employee_id, shift_id, status')
      .eq('status', 'published')

    if (prevAssignments && prevAssignments.length > 0) {
      // Fetch shift details for those assignments
      const shiftIds: string[] = [...new Set(prevAssignments.map((a: any) => a.shift_id))]
      const { data: prevShifts } = await admin
        .from('shifts')
        .select('id, date, shift_type, day_type')
        .in('id', shiftIds)
        .gte('date', prevPeriodStart)
        .lte('date', prevPeriodEnd)

      const shiftMap = new Map<string, any>()
      for (const s of prevShifts ?? []) shiftMap.set(s.id, s)

      const counters: FairnessSummary = {}
      for (const a of prevAssignments) {
        const s = shiftMap.get(a.shift_id)
        if (!s) continue
        if (!counters[a.employee_id]) counters[a.employee_id] = emptyCounters()
        const c = counters[a.employee_id]
        c.totalShifts++
        if (s.day_type === 'weekend') c.weekendShifts++
        if (s.day_type === 'holiday') c.holidayShifts++
        if (s.shift_type === 'night') c.nightShifts++
      }
      carryForwardCounters = counters
    }
  }

  // ── 3. Auto-create shift rows for the month ────────────────────────────────
  // One row per (date, shift_type) that has headcount > 0.
  // Upsert on (date, shift_type) so re-generating doesn't create duplicates.

  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, mon - 1, 1))
  const holidaySet = new Set(publicHolidays)

  type DayType = 'weekday' | 'friday' | 'weekend' | 'holiday'

  function classifyDay(dateStr: string): DayType {
    if (holidaySet.has(dateStr)) return 'holiday'
    const dow = getDay(parseISO(dateStr))
    if (dow === 0 || dow === 6) return 'weekend'
    if (dow === 5) return 'friday'
    return 'weekday'
  }

  const shiftRowsToUpsert: any[] = []
  for (let d = 0; d < daysInMonth; d++) {
    const dateStr = format(addDays(new Date(year, mon - 1, 1), d), 'yyyy-MM-dd')
    const dayType = classifyDay(dateStr)
    for (const req of coverageRequirements) {
      if (req.day_type !== dayType) continue
      if (req.required_headcount <= 0) continue
      shiftRowsToUpsert.push({
        date:           dateStr,
        shift_type:     req.shift_type,
        start_time:     SHIFT_START[req.shift_type],
        end_time:       SHIFT_END[req.shift_type],
        headcount:      req.required_headcount,
        is_published:   false,
        request_status: 'open',
        created_by:     user.id,
      })
    }
  }

  // Insert only shift rows that don't already exist for this (date, shift_type).
  // The shifts table has no unique constraint on (date, shift_type), so we fetch
  // existing rows first and skip any that are already present.
  const { data: existingShifts } = await admin
    .from('shifts')
    .select('id, date, shift_type, is_published')
    .gte('date', periodStart)
    .lte('date', periodEnd)

  const existingKeys = new Set(
    (existingShifts ?? []).map((s: any) => `${s.date}|${s.shift_type}`)
  )

  const newShiftRows = shiftRowsToUpsert.filter(
    (r) => !existingKeys.has(`${r.date}|${r.shift_type}`)
  )

  const BATCH = 100
  for (let i = 0; i < newShiftRows.length; i += BATCH) {
    const { error: insertErr } = await admin
      .from('shifts')
      .insert(newShiftRows.slice(i, i + BATCH))
    if (insertErr) {
      return NextResponse.json({ error: 'Failed to insert shifts', details: insertErr.message }, { status: 500 })
    }
  }

  // Prune stale shift rows: shifts that exist for this period but are no longer
  // required for that date's current day-type (e.g. a holiday was removed).
  // Only unpublished, unassigned rows are eligible — assignments cascade-delete
  // with their shift, so a row with any assignment must never be removed here.
  const desiredKeys = new Set(
    shiftRowsToUpsert.map((r) => `${r.date}|${r.shift_type}`)
  )

  const staleShifts = (existingShifts ?? []).filter(
    (s: any) => !desiredKeys.has(`${s.date}|${s.shift_type}`) && s.is_published === false
  )

  if (staleShifts.length > 0) {
    const staleShiftIds = staleShifts.map((s: any) => s.id)

    const { data: staleAssignments } = await admin
      .from('shift_assignments')
      .select('shift_id')
      .in('shift_id', staleShiftIds)

    const assignedShiftIds = new Set(
      (staleAssignments ?? []).map((a: any) => a.shift_id)
    )

    const deletableShiftIds = staleShiftIds.filter((id: string) => !assignedShiftIds.has(id))

    for (let i = 0; i < deletableShiftIds.length; i += BATCH) {
      const { error: deleteErr } = await admin
        .from('shifts')
        .delete()
        .in('id', deletableShiftIds.slice(i, i + BATCH))
        .eq('is_published', false)
      if (deleteErr) {
        return NextResponse.json({ error: 'Failed to prune stale shifts', details: deleteErr.message }, { status: 500 })
      }
    }
  }

  // Fetch the shift rows we just upserted (we need their IDs for assignments)
  const { data: monthShifts, error: shiftFetchErr } = await admin
    .from('shifts')
    .select('id, date, shift_type')
    .gte('date', periodStart)
    .lte('date', periodEnd)

  if (shiftFetchErr || !monthShifts) {
    return NextResponse.json({ error: 'Failed to fetch month shifts' }, { status: 500 })
  }

  const shiftIdByKey = new Map<string, string>()
  for (const s of monthShifts) {
    shiftIdByKey.set(`${s.date}|${s.shift_type}`, s.id)
  }

  // ── 4. Run the scheduler ───────────────────────────────────────────────────

  const result = generateSchedule({
    month,
    employees,
    coverageRequirements,
    publicHolidays,
    timeOff,
    rules,
    carryForwardCounters,
  })

  const { assignments, fairnessSummary, unfilledSlots } = result

  // ── 5. Write outputs ───────────────────────────────────────────────────────

  // 5a. Insert schedule_runs row
  const { data: runRow, error: runInsertErr } = await admin
    .from('schedule_runs')
    .insert({
      period_start:        periodStart,
      period_end:          periodEnd,
      status:              'draft',
      generated_by:        user.id,
      fairness_summary:    fairnessSummary,
      parameters_snapshot: { unfilled_slots: unfilledSlots, month },
    })
    .select('id')
    .single()

  if (runInsertErr || !runRow) {
    return NextResponse.json({ error: 'Failed to create schedule run', details: runInsertErr?.message }, { status: 500 })
  }

  const runId: string = runRow.id

  // 5b. Insert shift_assignments as draft
  const assignmentRows = assignments.flatMap((a) => {
    const shiftId = shiftIdByKey.get(`${a.date}|${a.shift_type}`)
    if (!shiftId) return []
    return [{
      employee_id:      a.employee_id,
      shift_id:         shiftId,
      schedule_run_id:  runId,
      status:           'draft',
      locked:           false,
      assigned_by:      user.id,
    }]
  })

  for (let i = 0; i < assignmentRows.length; i += BATCH) {
    const { error: assignErr } = await admin
      .from('shift_assignments')
      .insert(assignmentRows.slice(i, i + BATCH))
    if (assignErr) {
      // Clean up the run row so we don't leave orphaned runs
      await admin.from('schedule_runs').delete().eq('id', runId)
      return NextResponse.json({ error: 'Failed to insert assignments', details: assignErr.message }, { status: 500 })
    }
  }

  // ── 6. Respond ─────────────────────────────────────────────────────────────

  return NextResponse.json({
    run_id:           runId,
    month,
    assignment_count: assignmentRows.length,
    unfilled_slots:   unfilledSlots,
    fairness_summary: fairnessSummary,
  })
}
