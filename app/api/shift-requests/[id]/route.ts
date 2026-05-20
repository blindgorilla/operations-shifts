import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendApprovalEmail, sendDenialEmail } from '@/lib/email/send'
import { validateShiftRequest } from '@/lib/rules/validateShiftRequest'
import { createNotification } from '@/lib/notifications'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const reviewSchema = z.object({
  action: z.enum(['approve', 'deny']),
  manager_note: z.string().optional(),
  override: z.boolean().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // Auth check
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
  const parsed = reviewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { action, manager_note, override } = parsed.data
  const newStatus = action === 'approve' ? 'approved' : 'denied'

  // Use admin client to bypass RLS for service operations
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch the request with employee + shift
  const { data: shiftRequest, error: fetchError } = await admin
    .from('shift_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !shiftRequest) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  const { data: employee } = await admin.from('employees').select('*').eq('id', shiftRequest.employee_id).single()
  const { data: shift } = await admin.from('shifts').select('*').eq('id', shiftRequest.shift_id).single()
  const enrichedRequest = { ...shiftRequest, employee, shift }

  if (shiftRequest.status !== 'pending') {
    return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 })
  }

  if (action === 'approve') {
    const { data: rawExistingAssignments } = await admin
      .from('shift_assignments')
      .select('*')
      .eq('employee_id', shiftRequest.employee_id)

    const existingShiftIds = (rawExistingAssignments ?? []).map((a: any) => a.shift_id)
    const { data: existingShifts } = existingShiftIds.length > 0
      ? await admin.from('shifts').select('*').in('id', existingShiftIds)
      : { data: [] }

    const existingShiftMap: Record<string, any> = {}
    for (const s of existingShifts ?? []) existingShiftMap[s.id] = s

    const existingAssignments = (rawExistingAssignments ?? []).map((a: any) => ({
      ...a,
      shift: existingShiftMap[a.shift_id] ?? null,
    }))

    const { data: rawAllAssignmentsOnShift } = await admin
      .from('shift_assignments')
      .select('*')
      .eq('shift_id', shiftRequest.shift_id)

    const onShiftEmployeeIds = (rawAllAssignmentsOnShift ?? []).map((a: any) => a.employee_id)
    const { data: onShiftEmployees } = onShiftEmployeeIds.length > 0
      ? await admin.from('employees').select('*').in('id', onShiftEmployeeIds)
      : { data: [] }

    const onShiftEmployeeMap: Record<string, any> = {}
    for (const e of onShiftEmployees ?? []) onShiftEmployeeMap[e.id] = e

    const allAssignmentsOnShift = (rawAllAssignmentsOnShift ?? []).map((a: any) => ({
      ...a,
      employee: onShiftEmployeeMap[a.employee_id] ?? null,
    }))

    const { data: holidays } = await admin
      .from('public_holidays')
      .select('date')

    const publicHolidays = (holidays ?? []).map((h: { date: string }) => h.date)

    const violations = await validateShiftRequest({
      employee: enrichedRequest.employee,
      requestedShift: enrichedRequest.shift,
      existingAssignments: (existingAssignments ?? []) as any,
      allAssignmentsOnShift: (allAssignmentsOnShift ?? []) as any,
      publicHolidays,
      employeeWeeklyStats: [],
    })

    const hasErrorViolations = violations.some(v => v.severity === 'error')
    if (hasErrorViolations && !override) {
      return NextResponse.json(
        { error: 'Cannot approve: scheduling rule violation exists. Check the override box to proceed.', violations },
        { status: 422 }
      )
    }
  }

  // Update status
  const { error: updateError } = await admin
    .from('shift_requests')
    .update({
      status: newStatus,
      manager_note: manager_note ?? null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // If approved: create shift assignment
  if (action === 'approve') {
    await admin.from('shift_assignments').upsert({
      employee_id: shiftRequest.employee_id,
      shift_id: shiftRequest.shift_id,
      assigned_by: user.id,
    })
  }

  // Send in-app notification
  try {
    await createNotification({
      employeeId: shiftRequest.employee_id,
      type: action === 'approve' ? 'request_approved' : 'request_denied',
      title: action === 'approve' ? 'Shift Request Approved' : 'Shift Request Denied',
      message: action === 'approve'
        ? `Your request for the ${enrichedRequest.shift?.shift_type} shift on ${enrichedRequest.shift?.date} has been approved.`
        : `Your request for the ${enrichedRequest.shift?.shift_type} shift on ${enrichedRequest.shift?.date} has been denied.${manager_note ? ' Note: ' + manager_note : ''}`,
      link: '/my-requests',
    })
  } catch (notifError) {
    console.error('Notification create failed:', notifError)
  }

  // Send email notification
  try {
    if (action === 'approve') {
      await sendApprovalEmail(enrichedRequest.employee, enrichedRequest.shift, manager_note)
    } else {
      await sendDenialEmail(enrichedRequest.employee, enrichedRequest.shift, manager_note)
    }
  } catch (emailError) {
    console.error('Email send failed:', emailError)
  }

  return NextResponse.json({ success: true, status: newStatus })
}
