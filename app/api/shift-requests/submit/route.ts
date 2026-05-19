import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { validateShiftRequest } from '@/lib/rules/validateShiftRequest'
import { sendNewRequestEmail } from '@/lib/email/send'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const submitSchema = z.object({
  shift_id: z.string().uuid(),
  employee_note: z.string().optional(),
  confirm_violations: z.boolean().optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { shift_id, employee_note } = parsed.data

  // Fetch employee
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  // Fetch requested shift
  const { data: shift } = await supabase
    .from('shifts')
    .select('*')
    .eq('id', shift_id)
    .single()

  if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
  if (!shift.is_published) return NextResponse.json({ error: 'Shift not available' }, { status: 400 })
  if (shift.request_status !== 'open') return NextResponse.json({ error: 'Requests are not open for this shift' }, { status: 403 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch employee's existing assignments (with shift details)
  const { data: existingAssignments } = await admin
    .from('shift_assignments')
    .select('*')
    .eq('employee_id', user.id)

  const assignmentShiftIds = (existingAssignments ?? []).map((a: any) => a.shift_id)
  const { data: assignmentShifts } = assignmentShiftIds.length > 0
    ? await admin.from('shifts').select('*').in('id', assignmentShiftIds)
    : { data: [] }

  const shiftMap: Record<string, any> = {}
  for (const s of assignmentShifts ?? []) shiftMap[s.id] = s

  const enrichedExistingAssignments = (existingAssignments ?? []).map((a: any) => ({
    ...a,
    shift: shiftMap[a.shift_id] ?? null,
  }))

  // Fetch all assignments on the requested shift (to check headcount + new employee rule)
  const { data: shiftAssignments } = await admin
    .from('shift_assignments')
    .select('*')
    .eq('shift_id', shift_id)

  // Fetch employee details separately for new_employee_pairing rule
  const assignmentEmployeeIds = (shiftAssignments ?? []).map((a: any) => a.employee_id)
  const { data: assignmentEmployees } = assignmentEmployeeIds.length > 0
    ? await admin.from('employees').select('*').in('id', assignmentEmployeeIds)
    : { data: [] }

  const enrichedShiftAssignments = (shiftAssignments ?? []).map((a: any) => ({
    ...a,
    employee: (assignmentEmployees ?? []).find((e: any) => e.id === a.employee_id) ?? null,
  }))

  // Fetch public holidays
  const { data: holidays } = await supabase
    .from('public_holidays')
    .select('date')

  const publicHolidays = (holidays ?? []).map((h: { date: string }) => h.date)

  // Run rules engine
  const violations = await validateShiftRequest({
    employee,
    requestedShift: shift,
    existingAssignments: enrichedExistingAssignments as any,
    allAssignmentsOnShift: (enrichedShiftAssignments ?? []) as any,
    publicHolidays,
    employeeWeeklyStats: [],
  })

  const headcountViolations = violations.filter(v => v.rule === 'headcount')
  const otherViolations = violations.filter(v => v.rule !== 'headcount')

  if (headcountViolations.length > 0) {
    return NextResponse.json({
      error: 'shift_full',
      message: 'All spots for this shift have been filled.',
      violations: headcountViolations,
    }, { status: 422 })
  }

  const hasErrors = otherViolations.some((v) => v.severity === 'error')
  if (hasErrors && !parsed.data.confirm_violations) {
    return NextResponse.json({ needs_confirmation: true, violations: otherViolations }, { status: 200 })
  }

  // Remove any existing denied request so the unique constraint doesn't block re-requests
  await admin
    .from('shift_requests')
    .delete()
    .eq('employee_id', user.id)
    .eq('shift_id', shift_id)
    .eq('status', 'denied')

  // Insert request
  const { data: newRequest, error: insertError } = await supabase
    .from('shift_requests')
    .insert({
      employee_id: user.id,
      shift_id,
      employee_note: employee_note ?? null,
      rule_violations: otherViolations,
    })
    .select()
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ error: 'You have already requested this shift' }, { status: 409 })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Notify all managers by email
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: managers } = await admin
      .from('employees')
      .select('*')
      .eq('role', 'manager')

    if (managers && managers.length > 0) {
      await sendNewRequestEmail(managers, employee, shift)
    }
  } catch (emailError) {
    console.error('Manager notification email failed:', emailError)
  }

  return NextResponse.json({ success: true, request: newRequest, violations: otherViolations })
}
