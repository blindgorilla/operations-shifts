import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase
    .from('employees')
    .select('role')
    .eq('id', user.id)
    .single()

  if (employee?.role === 'manager') redirect('/manager/schedule')
  redirect('/dashboard')
}
