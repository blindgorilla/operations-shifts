import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import Link from 'next/link'
import ManagerShiftsClient from '@/components/manager/ManagerShiftsClient'

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

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Shifts</h1>
            <p className="text-sm text-gray-500 mt-1">Create and publish shifts for employees to request</p>
          </div>
          <Link
            href="/manager/shifts/new"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Shift
          </Link>
        </div>
        <ManagerShiftsClient shifts={shiftsWithCounts} />
      </main>
    </div>
  )
}
