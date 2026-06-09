import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ManagerEmployeesClient from '@/components/manager/ManagerEmployeesClient'

export const dynamic = 'force-dynamic'

export default async function ManagerEmployeesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch all employees — active and inactive — manager decides visibility
  const { data: employees } = await admin
    .from('employees')
    .select('*')
    .order('name', { ascending: true })

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-500 mt-1">Manage employee roles, new employee flags, weekly day allocation, and active status</p>
        </div>
        <ManagerEmployeesClient employees={employees ?? []} currentManagerId={user.id} />
      </main>
    </div>
  )
}
