import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: manager } = await supabase
    .from('employees')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!manager || manager.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, email, is_new_employee } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check for duplicate email
  const { data: existing } = await admin
    .from('employees')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (existing) {
    return NextResponse.json({ error: 'An employee with this email already exists' }, { status: 409 })
  }

  const { data: newEmployee, error } = await admin
    .from('employees')
    .insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: 'employee',
      weekly_days: 5,
      is_active: true,
      is_new_employee: !!is_new_employee,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employee: newEmployee }, { status: 201 })
}
