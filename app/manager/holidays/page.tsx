import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import ManagerHolidaysClient from '@/components/manager/ManagerHolidaysClient'

export default async function ManagerHolidaysPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const { data: holidays } = await supabase
    .from('public_holidays')
    .select('*')
    .order('date', { ascending: true })

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Public Holidays</h1>
          <p className="text-sm text-gray-500 mt-1">Define public holidays for fair shift rotation tracking</p>
        </div>
        <ManagerHolidaysClient holidays={holidays ?? []} />
      </main>
    </div>
  )
}
