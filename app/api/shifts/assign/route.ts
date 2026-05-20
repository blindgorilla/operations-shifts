import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendAssignmentEmail } from '@/lib/email/send'
import { createNotification } from '@/lib/notifications'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const assignSchema = z.object({
  shift_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  override: z.boolean().optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: manager } = await admin
    .from('employees')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (!manager || manager.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = assignSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { shift_id, employee_id, override } = parsed.data

  const { data: shift } = await admin
    .from('shifts')
    .select('*')
    .eq('id', shift_id)
    .single()

  if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

  const { data: existing } = await admin
    .from('shift_assignments')
    .select('id')
    .eq('shift_id', shift_id)
    .eq('employee_id', employee_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Employee is already assigned to this shift' }, { status: 409 })
  }

  const { count: currentCount } = await admin
    .from('shift_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('shift_id', shift_id)

  const isFull = (currentCount ?? 0) >= shift.headcount

  if (isFull && !override) {
    return NextResponse.json({
      error: 'shift_full',
      message: 'This shift is already at headcount. Pass override: true to assign anyway.',
    }, { status: 422 })
  }

  const { data: assignment, error: insertError } = await admin
    .from('shift_assignments')
    .insert({ shift_id, employee_id, assigned_by: manager.id })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Fetch employee for notification + email
  const { data: employee } = await admin
    .from('employees')
    .select('*')
    .eq('id', employee_id)
    .single()

  if (employee) {
    try {
      await createNotification({
        employeeId: employee_id,
        type: 'direct_assignment',
        title: 'You have been assigned to a shift',
        message: `Your manager assigned you to the ${shift.shift_type} shift on ${shift.date}.`,
        link: '/dashboard',
      })
    } catch (notifError) {
      console.error('Notification create failed:', notifError)
    }

    try {
      await sendAssignmentEmail(employee, shift)
    } catch (emailError) {
      console.error('Email send failed:', emailError)
    }
  }

  return NextResponse.json({ success: true, assignment })
}
