import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ShiftCalendarClient from '@/components/calendar/ShiftCalendarClient'
import InfoTooltip from '@/components/ui/InfoTooltip'
import OnboardingBanner from '@/components/ui/OnboardingBanner'

export const dynamic = 'force-dynamic'

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
  if (employee.role === 'manager') redirect('/manager/schedule')

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const year = now.getFullYear()

  const { data: holidays } = await supabase
    .from('public_holidays')
    .select('*')
    .gte('date', `${year}-01-01`)
    .lt('date', `${year + 1}-01-01`)
    .order('date')

  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .gte('date', monthStart)
    .eq('is_published', true)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const { data: myRequests } = await supabase
    .from('shift_requests')
    .select('shift_id, status')
    .eq('employee_id', user.id)
    .eq('status', 'pending')

  const { data: myAssignments } = await supabase
    .from('shift_assignments')
    .select('shift_id')
    .eq('employee_id', user.id)

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

  // Weekly assignment count
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  const weekStart = monday.toISOString().split('T')[0]
  const weekEnd = sunday.toISOString().split('T')[0]

  const { data: myWeekAssignments } = await adminClient
    .from('shift_assignments')
    .select('*, shift:shifts(date)')
    .eq('employee_id', employee.id)
    .gte('shift.date', weekStart)
    .lte('shift.date', weekEnd)

  const weeklyAssignedCount = (myWeekAssignments ?? []).filter(a => a.shift !== null).length

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <OnboardingBanner role="employee" />

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            Available Shifts
            <InfoTooltip text="Browse upcoming shifts published by your manager. You can request shifts when the request window is open." />
          </h1>
          <p className="text-sm text-gray-500 mt-1">Browse and request upcoming shifts below</p>
        </div>

        <ShiftCalendarClient
          shifts={shiftsWithCounts}
          employee={employee}
          requestedShiftIds={Array.from(requestedShiftIds)}
          assignedShiftIds={Array.from(assignedShiftIds)}
          weeklyAssignedCount={weeklyAssignedCount}
          weeklyRequired={5}
          allEmployees={[]}
          holidays={holidays ?? []}
        />
      </main>
    </div>
  )
}
