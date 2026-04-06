import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ManagerRequestsClient from '@/components/manager/ManagerRequestsClient'

export default async function ManagerRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const { data: requests } = await supabase
    .from('shift_requests')
    .select('*, employee:employees(*), shift:shifts(*)')
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Shift Requests</h1>
          <p className="text-sm text-gray-500 mt-1">Review and approve employee shift requests</p>
        </div>
        <ManagerRequestsClient requests={requests ?? []} />
      </main>
    </div>
  )
}
