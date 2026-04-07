import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ requests: [] })

  const { data: employee } = await supabase
    .from('employees')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!employee || employee.role !== 'manager') {
    return NextResponse.json({ requests: [] })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: rawRequests } = await admin
    .from('shift_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: employees } = await admin.from('employees').select('id, name, email')
  const { data: shifts } = await admin.from('shifts').select('id, date, shift_type, start_time, end_time, location')

  const employeeMap = Object.fromEntries((employees ?? []).map(e => [e.id, e]))
  const shiftMap = Object.fromEntries((shifts ?? []).map(s => [s.id, s]))

  const requests = (rawRequests ?? []).map(r => ({
    ...r,
    employee: employeeMap[r.employee_id] ?? null,
    shift: shiftMap[r.shift_id] ?? null,
  }))

  return NextResponse.json({ requests })
}
