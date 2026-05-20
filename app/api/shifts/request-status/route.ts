import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const patchSchema = z.object({
  status: z.enum(['open', 'closed', 'reviewing']),
  shift_ids: z.array(z.string()).optional(),
})

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabase
    .from('employees')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!employee || employee.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { status, shift_ids } = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = admin.from('shifts').update({ request_status: status })

  if (shift_ids && shift_ids.length > 0) {
    query = query.in('id', shift_ids)
  } else {
    query = query.eq('is_published', true)
  }

  const { error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (status === 'open') {
    try {
      const { data: allEmployees } = await admin.from('employees').select('id').eq('role', 'employee')
      for (const emp of allEmployees ?? []) {
        await createNotification({
          employeeId: emp.id,
          type: 'window_opened',
          title: 'Request window is now open',
          message: 'New shifts are available for request. Go to your dashboard to browse and request shifts.',
          link: '/dashboard',
        })
      }
    } catch (notifError) {
      console.error('Notification create failed:', notifError)
    }
  }

  return NextResponse.json({ success: true })
}
