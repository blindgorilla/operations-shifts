import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const bodySchema = z.object({
  run_id:      z.string().uuid(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_type:  z.enum(['morning', 'evening', 'night']),
  employee_id: z.string().uuid(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('employees').select('role').eq('id', user.id).single()
  if (caller?.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })

  const { run_id, date, shift_type, employee_id } = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Verify run is published
  const { data: run } = await admin
    .from('schedule_runs')
    .select('id, status, period_start, period_end')
    .eq('id', run_id)
    .single()

  if (!run) return NextResponse.json({ error: 'Schedule run not found' }, { status: 404 })
  if (run.status !== 'published') return NextResponse.json({ error: 'Can only use this route on published schedules' }, { status: 409 })

  // Find the shift row
  const { data: shifts } = await admin
    .from('shifts')
    .select('id')
    .eq('date', date)
    .eq('shift_type', shift_type)
    .gte('date', run.period_start)
    .lte('date', run.period_end)
    .limit(1)

  const shift = shifts?.[0] ?? null
  if (!shift) {
    return NextResponse.json({ error: `No shift row found for ${date} ${shift_type}` }, { status: 404 })
  }

  // Delete the published assignment
  const { error: deleteErr } = await admin
    .from('shift_assignments')
    .delete()
    .eq('schedule_run_id', run_id)
    .eq('shift_id', shift.id)
    .eq('employee_id', employee_id)
    .eq('status', 'published')

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  // Stamp last_edited_at
  await admin
    .from('schedule_runs')
    .update({ last_edited_at: new Date().toISOString() })
    .eq('id', run_id)

  return NextResponse.json({ ok: true })
}
