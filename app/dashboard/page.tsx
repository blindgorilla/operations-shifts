import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ShiftCalendarClient from '@/components/calendar/ShiftCalendarClient'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!employee) redirect('/auth/login')

  // Fetch upcoming published shifts
  const today = new Date().toISOString().split('T')[0]
  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('is_published', true)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  // Fetch employee's own requests
  const { data: myRequests } = await supabase
    .from('shift_requests')
    .select('shift_id, status')
    .eq('employee_id', user.id)

  // Fetch employee's assignments
  const { data: myAssignments } = await supabase
    .from('shift_assignments')
    .select('shift_id')
    .eq('employee_id', user.id)

  // Fetch assignment counts per shift
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

  const requestedShiftIds = new Set((myRequests ?? []).map((r) => r.shift_id))
  const assignedShiftIds = new Set((myAssignments ?? []).map((a) => a.shift_id))

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Available Shifts</h1>
          <p className="text-sm text-gray-500 mt-1">Browse and request upcoming shifts</p>
        </div>

        <ShiftCalendarClient
          shifts={shiftsWithCounts}
          employee={employee}
          requestedShiftIds={Array.from(requestedShiftIds)}
          assignedShiftIds={Array.from(assignedShiftIds)}
        />
      </main>
    </div>
  )
}
