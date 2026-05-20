import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import Link from 'next/link'
import ManagerShiftsClient from '@/components/manager/ManagerShiftsClient'
import InfoTooltip from '@/components/ui/InfoTooltip'

export const dynamic = 'force-dynamic'

export default async function ManagerShiftsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const { data: assignmentCounts } = await supabase
    .from('shift_assignments')
    .select('shift_id')

  const countMap: Record<string, number> = {}
  for (const a of assignmentCounts ?? []) {
    countMap[a.shift_id] = (countMap[a.shift_id] ?? 0) + 1
  }

  const shiftsWithCounts = (shifts ?? []).map((s) => ({
    ...s,
    assignment_count: countMap[s.id] ?? 0,
  }))

  // Fetch pending count for badge
  const admin2 = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { count: pendingCount } = await admin2
    .from('shift_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} pendingCount={pendingCount ?? 0} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">

        {/* Quick how-to if no shifts yet */}
        {shiftsWithCounts.length === 0 && (
          <div className="bg-[#1B3A5C]/5 border border-[#1B3A5C]/20 rounded-xl p-5 mb-6">
            <h2 className="font-semibold text-[#1B3A5C] mb-1">Create your first shift</h2>
            <p className="text-sm text-[#1B3A5C] mb-3">
              Shifts you create will appear here. Employees can only see and request shifts you <strong>publish</strong>.
            </p>
            <div className="flex gap-6 text-sm text-[#1B3A5C]">
              <span>1. Click <strong>+ New Shift</strong></span>
              <span>2. Fill in the details</span>
              <span>3. Tick <strong>Publish immediately</strong> or publish later</span>
              <span>4. Employees can then request it</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              Manage Shifts
              <InfoTooltip text="Create, publish, and manage shifts. Use the request window to control when employees can request shifts." />
            </h1>
            <p className="text-sm text-gray-500 mt-1">Create and publish shifts for employees to request</p>
          </div>
          <Link
            href="/manager/shifts/new"
            className="bg-[#1B3A5C] hover:bg-[#2a4a6b] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Shift
          </Link>
        </div>
        <ManagerShiftsClient shifts={shiftsWithCounts} />
      </main>
    </div>
  )
}
