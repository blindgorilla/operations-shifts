import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ShiftCalendarClient from '@/components/calendar/ShiftCalendarClient'
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

  // Fetch upcoming shifts — managers see all, employees see only published
  const today = new Date().toISOString().split('T')[0]
  let shiftsQuery = supabase
    .from('shifts')
    .select('*')
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (employee.role !== 'manager') {
    shiftsQuery = shiftsQuery.eq('is_published', true)
  }

  const { data: shifts } = await shiftsQuery

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

  let shiftsWithCounts = (shifts ?? []).map((s) => ({
    ...s,
    assignment_count: countMap[s.id] ?? 0,
  }))

  if (employee.role === 'manager') {
    const { data: allAssignments } = await adminClient
      .from('shift_assignments')
      .select('shift_id, employee:employees(name)')

    const assignmentsByShift: Record<string, string[]> = {}
    for (const a of allAssignments ?? []) {
      if (!assignmentsByShift[a.shift_id]) assignmentsByShift[a.shift_id] = []
      if ((a.employee as any)?.name) assignmentsByShift[a.shift_id].push((a.employee as any).name)
    }

    shiftsWithCounts = shiftsWithCounts.map(s => ({
      ...s,
      assigned_employees: assignmentsByShift[s.id] ?? [],
    }))
  }

  const requestedShiftIds = new Set((myRequests ?? []).map((r) => r.shift_id))
  const assignedShiftIds = new Set((myAssignments ?? []).map((a) => a.shift_id))

  // Get current week boundaries (Mon-Sun)
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 6=Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  const weekStart = monday.toISOString().split('T')[0]
  const weekEnd = sunday.toISOString().split('T')[0]

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Pending count for manager badge
  let pendingCount = 0
  let employeeCoverage: { id: string; name: string; assigned: number; required: number }[] | undefined
  if (employee.role === 'manager') {
    const { count } = await adminClient
      .from('shift_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
    pendingCount = count ?? 0

    const { data: allEmployees } = await adminClient
      .from('employees')
      .select('id, name, role')
      .eq('role', 'employee')
      .order('name')

    const { data: allWeekAssignments } = await adminClient
      .from('shift_assignments')
      .select('employee_id, shift:shifts(date)')
      .gte('shift.date', weekStart)
      .lte('shift.date', weekEnd)

    const validAllAssignments = (allWeekAssignments ?? []).filter(a => a.shift !== null)

    employeeCoverage = (allEmployees ?? []).map(emp => ({
      id: emp.id,
      name: emp.name,
      assigned: validAllAssignments.filter(a => a.employee_id === emp.id).length,
      required: 5,
    }))
  }

  // Employee weekly assignment count
  let weeklyAssignedCount: number | undefined
  if (employee.role === 'employee') {
    const { data: myWeekAssignments } = await adminClient
      .from('shift_assignments')
      .select('*, shift:shifts(date)')
      .eq('employee_id', employee.id)
      .gte('shift.date', weekStart)
      .lte('shift.date', weekEnd)

    const validAssignments = (myWeekAssignments ?? []).filter(a => a.shift !== null)
    weeklyAssignedCount = validAssignments.length
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} pendingCount={pendingCount} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <OnboardingBanner role={employee.role as 'employee' | 'manager'} />

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {employee.role === 'manager' ? 'All Shifts' : 'Available Shifts'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {employee.role === 'manager'
              ? 'Overview of all shifts. Go to Shifts in the menu to create and manage them.'
              : 'Browse and request upcoming shifts below'}
          </p>
        </div>

        <ShiftCalendarClient
          shifts={shiftsWithCounts}
          employee={employee}
          requestedShiftIds={Array.from(requestedShiftIds)}
          assignedShiftIds={Array.from(assignedShiftIds)}
          weeklyAssignedCount={weeklyAssignedCount}
          weeklyRequired={5}
          employeeCoverage={employeeCoverage}
        />
      </main>
    </div>
  )
}
