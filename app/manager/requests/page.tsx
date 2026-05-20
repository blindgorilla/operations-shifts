import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ManagerRequestsClient from '@/components/manager/ManagerRequestsClient'
import InfoTooltip from '@/components/ui/InfoTooltip'

export const dynamic = 'force-dynamic'

export default async function ManagerRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  // Use admin client to bypass RLS — manager role already verified above
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch requests, employees and shifts separately to avoid join issues
  const { data: rawRequests } = await admin
    .from('shift_requests')
    .select('*')
    .order('created_at', { ascending: false })

  const { data: employees } = await admin.from('employees').select('*')
  const { data: shifts } = await admin.from('shifts').select('*')

  const employeeMap = Object.fromEntries((employees ?? []).map(e => [e.id, e]))
  const shiftMap = Object.fromEntries((shifts ?? []).map(s => [s.id, s]))

  const requests = (rawRequests ?? []).map(r => ({
    ...r,
    employee: employeeMap[r.employee_id] ?? null,
    shift: shiftMap[r.shift_id] ?? null,
    id: r.id,
  }))

  const pendingCount = (rawRequests ?? []).filter(r => r.status === 'pending').length

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} pendingCount={pendingCount} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            Shift Requests
            <InfoTooltip text="Review employee shift requests. Approve or deny each one. Requests with scheduling rule violations are flagged — you can override if needed." />
          </h1>
          <p className="text-sm text-gray-500 mt-1">Review and approve employee shift requests</p>
        </div>
        <ManagerRequestsClient requests={requests ?? []} />
      </main>
    </div>
  )
}
