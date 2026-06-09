import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import LeaveClient from '@/components/manager/LeaveClient'

export const dynamic = 'force-dynamic'

export default async function ManagerLeavePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: employees }, { data: leaveEntries }] = await Promise.all([
    admin
      .from('employees')
      .select('id, name')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    admin
      .from('time_off')
      .select('id, employee_id, start_date, end_date, type, note, created_at')
      .order('start_date', { ascending: false }),
  ])

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Leave</h1>
          <p className="text-sm text-gray-500 mt-1">Record and manage guard leave. Approved leave blocks scheduling on those dates.</p>
        </div>
        <LeaveClient
          employees={employees ?? []}
          initialLeave={leaveEntries ?? []}
        />
      </main>
    </div>
  )
}
