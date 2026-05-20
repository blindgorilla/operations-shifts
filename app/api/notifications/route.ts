import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: notifications, error } = await admin
    .from('notifications')
    .select('*')
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notifications: notifications ?? [] })
}

const patchSchema = z.union([
  z.object({ id: z.string() }),
  z.object({ mark_all_read: z.literal(true) }),
])

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  if ('mark_all_read' in parsed.data) {
    await admin
      .from('notifications')
      .update({ read: true })
      .eq('employee_id', user.id)
      .eq('read', false)
  } else {
    await admin
      .from('notifications')
      .update({ read: true })
      .eq('id', (parsed.data as { id: string }).id)
      .eq('employee_id', user.id)
  }

  return NextResponse.json({ success: true })
}
