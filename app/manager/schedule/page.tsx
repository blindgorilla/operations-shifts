import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ScheduleGeneratorClient from '@/components/manager/ScheduleGeneratorClient'

export const dynamic = 'force-dynamic'

export default async function ManagerSchedulePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: allEmployees } = await admin
    .from('employees')
    .select('id, name')
    .eq('role', 'employee')
    .eq('is_active', true)
    .order('name', { ascending: true })

  const { count: pendingCount } = await admin
    .from('shift_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} pendingCount={pendingCount ?? 0} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Generate Schedule</h1>
          <p className="text-sm text-gray-500 mt-1">
            Auto-generate a monthly shift schedule and review the draft before publishing
          </p>
        </div>
        <ScheduleGeneratorClient
          manager={employee}
          employees={allEmployees ?? []}
        />
      </main>
    </div>
  )
}
