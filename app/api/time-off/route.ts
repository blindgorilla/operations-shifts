import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: emp } = await supabase.from('employees').select('role').eq('id', user.id).single()
  if (!emp || emp.role !== 'manager') return null
  return user
}

export async function GET() {
  const user = await requireManager()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await admin
    .from('time_off')
    .select('id, employee_id, start_date, end_date, type, note, status, created_at')
    .order('start_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const user = await requireManager()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { employee_id, type, start_date, end_date, note } = body

  if (!employee_id || !type || !start_date || !end_date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!['annual', 'sick'].includes(type)) {
    return NextResponse.json({ error: 'Invalid leave type' }, { status: 400 })
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('time_off')
    .insert({
      employee_id,
      type,
      start_date,
      end_date,
      note: note || null,
      status: 'approved',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
