'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, parseISO, addMonths } from 'date-fns'
import ShiftCalendarClient from '@/components/calendar/ShiftCalendarClient'
import type { Employee } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployeeFairnessCounters {
  totalShifts: number
  weekendShifts: number
  holidayShifts: number
  nightShifts: number
  recentDates: string[]
}

interface UnfilledSlot {
  date: string
  shift_type: string
  day_type: string
  headcount: number
}

interface DraftAssignment {
  id: string
  employee_id: string
  shift_id: string
}

interface DraftRun {
  id: string
  period_start: string
  period_end: string
  status: string
  generated_at: string
  fairness_summary: Record<string, EmployeeFairnessCounters> | null
  parameters_snapshot: { unfilled_slots?: UnfilledSlot[]; month?: string } | null
}

interface DraftState {
  run: DraftRun
  shifts: any[]
  assignments: DraftAssignment[]
  wasRegeneration: boolean
}

interface Props {
  manager: Employee
  employees: { id: string; name: string }[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultMonth(): string {
  return format(addMonths(new Date(), 1), 'yyyy-MM')
}

function formatMonthDisplay(month: string): string {
  try {
    return format(parseISO(`${month}-01`), 'MMMM yyyy')
  } catch {
    return month
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScheduleGeneratorClient({ manager, employees }: Props) {
  const [month, setMonth] = useState<string>(getDefaultMonth)
  const [isGenerating, setIsGenerating] = useState(false)
  const [draftState, setDraftState] = useState<DraftState | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const employeeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of employees) map[e.id] = e.name
    return map
  }, [employees])

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // Fetch any existing draft when month changes
  useEffect(() => {
    let cancelled = false
    async function fetchExisting() {
      try {
        const res = await fetch(`/api/schedule/draft?month=${month}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (data.run) {
          setDraftState({
            run: data.run,
            shifts: data.shifts,
            assignments: data.assignments,
            wasRegeneration: false,
          })
        } else {
          setDraftState(null)
        }
      } catch {
        // silently ignore — user hasn't generated yet
      }
    }
    fetchExisting()
    return () => { cancelled = true }
  }, [month])

  async function handleGenerate() {
    const hadExistingDraft = draftState !== null
    setIsGenerating(true)
    try {
      const res = await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('error', data.error ?? 'Generation failed')
        return
      }

      // Fetch the freshly created draft
      const draftRes = await fetch(`/api/schedule/draft?month=${month}`)
      if (!draftRes.ok) {
        showToast('error', 'Generated but failed to load draft')
        return
      }
      const draftData = await draftRes.json()
      setDraftState({
        run: draftData.run,
        shifts: draftData.shifts,
        assignments: draftData.assignments,
        wasRegeneration: hadExistingDraft,
      })
      showToast('success', hadExistingDraft ? 'Draft replaced successfully' : 'Draft generated successfully')
    } catch {
      showToast('error', 'Network error — please try again')
    } finally {
      setIsGenerating(false)
    }
  }

  // Stitch assigned_employees + assigned_employee_ids onto each shift for the calendar
  const calShifts = useMemo(() => {
    if (!draftState) return []
    const byShift: Record<string, DraftAssignment[]> = {}
    for (const a of draftState.assignments) {
      if (!byShift[a.shift_id]) byShift[a.shift_id] = []
      byShift[a.shift_id].push(a)
    }
    return draftState.shifts.map((s: any) => ({
      ...s,
      assigned_employees: (byShift[s.id] ?? []).map(a => employeeMap[a.employee_id] ?? 'Unknown'),
      assigned_employee_ids: (byShift[s.id] ?? []).map(a => a.employee_id),
    }))
  }, [draftState, employeeMap])

  const fairnessSummary = draftState?.run?.fairness_summary ?? null
  const unfilledSlots: UnfilledSlot[] = draftState?.run?.parameters_snapshot?.unfilled_slots ?? []
  const assignmentCount = draftState?.assignments.length ?? 0
  const displayMonth = formatMonthDisplay(month)

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Month
            </label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 bg-[#1B3A5C] hover:bg-[#2a4a6b] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Generating…
              </>
            ) : (
              draftState ? `Regenerate ${displayMonth}` : `Generate ${displayMonth}`
            )}
          </button>
        </div>

        {/* Existing draft warning */}
        {draftState && !isGenerating && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>
              A draft for <strong>{displayMonth}</strong> already exists
              {draftState.run.generated_at && (
                <> (generated {format(parseISO(draftState.run.generated_at), 'MMM d, yyyy \'at\' HH:mm')})</>
              )}
              . Clicking Regenerate will replace it.
            </span>
          </div>
        )}
      </div>

      {/* Draft view */}
      {draftState && (
        <>
          {/* Draft header banner */}
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold rounded-full uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              Draft
            </span>
            <span className="text-sm font-medium text-gray-700">{displayMonth}</span>
            {draftState.wasRegeneration && (
              <span className="text-xs text-gray-500 italic">Previous draft replaced</span>
            )}
            <span className="ml-auto text-xs text-gray-400">Read-only preview — no changes published</span>
          </div>

          {/* Main layout: calendar + summary */}
          <div className="flex flex-col lg:flex-row gap-6 items-start">

            {/* Calendar */}
            <div className="flex-1 min-w-0">
              <ShiftCalendarClient
                shifts={calShifts}
                employee={manager}
                requestedShiftIds={[]}
                assignedShiftIds={[]}
                draftMode={true}
              />
            </div>

            {/* Summary panel */}
            <div className="w-full lg:w-80 shrink-0 space-y-4">

              {/* Total assignments */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Total Assignments</p>
                <p className="text-3xl font-bold text-[#1B3A5C]">{assignmentCount}</p>
                <p className="text-xs text-gray-400 mt-0.5">shifts assigned this draft</p>
              </div>

              {/* Unfilled slots */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Unfilled Slots</p>
                {unfilledSlots.length === 0 ? (
                  <div className="flex items-center gap-1.5 text-green-700 text-sm font-medium">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    All slots filled
                  </div>
                ) : (
                  <div className="space-y-1">
                    {unfilledSlots.map((slot, i) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                        <span className="text-gray-700">
                          {format(parseISO(slot.date), 'MMM d')}
                        </span>
                        <span className={`capitalize text-xs font-medium px-2 py-0.5 rounded-full ${
                          slot.shift_type === 'morning' ? 'bg-amber-100 text-amber-700'
                          : slot.shift_type === 'evening' ? 'bg-blue-100 text-blue-700'
                          : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {slot.shift_type}
                        </span>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 pt-1">{unfilledSlots.length} slot{unfilledSlots.length !== 1 ? 's' : ''} could not be filled</p>
                  </div>
                )}
              </div>

              {/* Per-guard fairness */}
              {fairnessSummary && Object.keys(fairnessSummary).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Guard Fairness</p>
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-100">
                          <th className="text-left py-1.5 px-1 font-medium">Guard</th>
                          <th className="text-right py-1.5 px-1 font-medium">Total</th>
                          <th className="text-right py-1.5 px-1 font-medium">Wknd</th>
                          <th className="text-right py-1.5 px-1 font-medium">Hol</th>
                          <th className="text-right py-1.5 px-1 font-medium">Night</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {Object.entries(fairnessSummary)
                          .sort(([, a], [, b]) => b.totalShifts - a.totalShifts)
                          .map(([empId, counters]) => (
                            <tr key={empId} className="hover:bg-gray-50">
                              <td className="py-1.5 px-1 text-gray-800 font-medium truncate max-w-[90px]">
                                {employeeMap[empId] ?? empId.slice(0, 8)}
                              </td>
                              <td className="py-1.5 px-1 text-right text-gray-700">{counters.totalShifts}</td>
                              <td className="py-1.5 px-1 text-right text-gray-500">{counters.weekendShifts}</td>
                              <td className="py-1.5 px-1 text-right text-gray-500">{counters.holidayShifts}</td>
                              <td className="py-1.5 px-1 text-right text-gray-500">{counters.nightShifts}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
