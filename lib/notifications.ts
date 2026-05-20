import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function createNotification({
  employeeId,
  type,
  title,
  message,
  link,
}: {
  employeeId: string
  type: string
  title: string
  message: string
  link?: string
}) {
  await admin.from('notifications').insert({
    employee_id: employeeId,
    type,
    title,
    message,
    link: link ?? '/dashboard',
  })
}
