import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import InfoTooltip from '@/components/ui/InfoTooltip'
import { format, parseISO } from 'date-fns'
import type { ShiftRequest } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
}

export default async function MyRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', user.id).single()
  if (!employee) redirect('/auth/login')

  const { data: rawRequests } = await supabase
    .from('shift_requests')
    .select('*')
    .eq('employee_id', employee.id)
    .order('created_at', { ascending: false })

  const requestShiftIds = (rawRequests ?? []).map((r: any) => r.shift_id)
  const { data: requestShifts } = requestShiftIds.length > 0
    ? await supabase.from('shifts').select('*').in('id', requestShiftIds)
    : { data: [] }

  const shiftMap: Record<string, any> = {}
  for (const s of requestShifts ?? []) shiftMap[s.id] = s

  const requests = (rawRequests ?? []).map((r: any) => ({
    ...r,
    shift: shiftMap[r.shift_id] ?? null,
  }))

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar employee={employee} />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            My Requests
            <InfoTooltip text="Track all your shift requests here. You'll see whether each request is pending, approved, or denied." />
          </h1>
          <p className="text-sm text-gray-500 mt-1">Track the status of your shift requests</p>
        </div>

        {(!requests || requests.length === 0) && (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">No shift requests yet</p>
          </div>
        )}

        <div className="space-y-3">
          {(requests as ShiftRequest[]).map((req) => (
            <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold capitalize">{req.shift?.shift_type} Shift</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[req.status]}`}>
                      {req.status}
                    </span>
                  </div>
                  {req.shift && (
                    <p className="text-sm text-gray-600">
                      {format(parseISO(req.shift.date), 'EEEE, d MMMM yyyy')} · {req.shift.start_time.slice(0, 5)}–{req.shift.end_time.slice(0, 5)}
                      {req.shift.location && ` · ${req.shift.location}`}
                    </p>
                  )}
                  {req.employee_note && (
                    <p className="text-xs text-gray-500 mt-1">Your note: {req.employee_note}</p>
                  )}
                  {req.manager_note && (
                    <p className="text-xs text-gray-500 mt-1 italic">Manager: {req.manager_note}</p>
                  )}
                  {req.rule_violations && req.rule_violations.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-amber-600 cursor-pointer">
                        {req.rule_violations.length} scheduling note{req.rule_violations.length > 1 ? 's' : ''}
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {req.rule_violations.map((v, i) => (
                          <li key={i} className={`text-xs ${v.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                            · {v.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <p className="text-xs text-gray-400 shrink-0">
                  {format(parseISO(req.created_at), 'd MMM yyyy')}
                </p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
