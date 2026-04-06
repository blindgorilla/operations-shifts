import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendApprovalEmail, sendDenialEmail } from '@/lib/email/send'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const reviewSchema = z.object({
  action: z.enum(['approve', 'deny']),
  manager_note: z.string().optional(),
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

  const { action, manager_note } = parsed.data
  const newStatus = action === 'approve' ? 'approved' : 'denied'

  // Use admin client to bypass RLS for service operations
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch the request with employee + shift
  const { data: shiftRequest, error: fetchError } = await admin
    .from('shift_requests')
    .select('*, employee:employees(*), shift:shifts(*)')
    .eq('id', id)
    .single()

  if (fetchError || !shiftRequest) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (shiftRequest.status !== 'pending') {
    return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 })
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

  // Send email notification
  try {
    if (action === 'approve') {
      await sendApprovalEmail(shiftRequest.employee, shiftRequest.shift, manager_note)
    } else {
      await sendDenialEmail(shiftRequest.employee, shiftRequest.shift, manager_note)
    }
  } catch (emailError) {
    // Don't fail the whole request if email fails
    console.error('Email send failed:', emailError)
  }

  return NextResponse.json({ success: true, status: newStatus })
}
