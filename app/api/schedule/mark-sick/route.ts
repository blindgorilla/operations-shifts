import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const bodySchema = z.object({
  employee_id: z.string().uuid(),
  from_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  through_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(d => d.through_date >= d.from_date, {
  message: 'through_date must be on or after from_date',
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

  const { employee_id, from_date, through_date } = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Verify employee exists
  const { data: emp } = await admin.from('employees').select('id, name').eq('id', employee_id).single()
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const { data: record, error: insertErr } = await admin
    .from('time_off')
    .insert({
      employee_id,
      start_date: from_date,
      end_date: through_date,
      type: 'sick',
      status: 'approved',
    })
    .select('id, employee_id, start_date, end_date, type, status')
    .single()

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ record })
}
