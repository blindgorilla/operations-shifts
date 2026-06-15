import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import HolidayReportClient from '@/components/manager/HolidayReportClient'
import type { HolidayWorkRow } from '@/types'

export default async function HolidayReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee || employee.role !== 'manager') redirect('/dashboard')

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: rows } = await admin.rpc('holiday_work_report', {
    p_year: year,
    p_month: month,
  })

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Holiday Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Holiday shifts worked per employee from the published schedule — for payroll.
          </p>
        </div>
        <HolidayReportClient
          initialYear={year}
          initialMonth={month}
          initialRows={(rows as HolidayWorkRow[]) ?? []}
        />
      </main>
    </div>
  )
}
