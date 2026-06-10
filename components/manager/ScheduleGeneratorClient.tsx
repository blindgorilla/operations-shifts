'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, parseISO, addMonths } from 'date-fns'
import ShiftCalendarClient from '@/components/calendar/ShiftCalendarClient'
import SlotPanel from '@/components/manager/SlotPanel'
import type { Employee, Shift } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployeeFairnessCounters {
  totalShifts: number
  morningShifts: number
  eveningShifts: number
  nightShifts: number
  weekendShifts: number
  holidayShifts: number
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

interface PublishedRun {
  id: string
  generated_at: string
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

const DAY_TYPE_LABEL: Record<string, string> = {
  weekday: 'Weekday',
  friday: 'Friday',
  weekend: 'Weekend',
  holiday: 'Holiday',
}
const SHIFT_TYPE_LABEL_PLURAL: Record<string, string> = {
  morning: 'Mornings',
  evening: 'Evenings',
  night: 'Nights',
}
const SHIFT_TYPE_LABEL_SINGULAR: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  night: 'Night',
}

interface SlotGroup {
  key: string
  label: string
  dates: string[]
}

function groupUnfilledSlots(slots: UnfilledSlot[]): SlotGroup[] {
  const groups: Record<string, SlotGroup> = {}
  for (const slot of slots) {
    const key = `${slot.day_type}|${slot.shift_type}`
    if (!groups[key]) {
      const dayLabel = DAY_TYPE_LABEL[slot.day_type] ?? slot.day_type
      groups[key] = { key, label: dayLabel, dates: [] }
    }
    groups[key].dates.push(slot.date)
  }
  return Object.values(groups).sort((a, b) => b.dates.length - a.dates.length)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FairnessPanel — guard workload breakdown with imbalance highlighting
// ---------------------------------------------------------------------------

interface ColStats { min: number; max: number }

function colStats(entries: [string, EmployeeFairnessCounters][], fn: (c: EmployeeFairnessCounters) => number): ColStats {
  const vals = entries.map(([, c]) => fn(c))
  return { min: Math.min(...vals), max: Math.max(...vals) }
}

function FairnessPanel({
  fairnessSummary,
  employeeMap,
}: {
  fairnessSummary: Record<string, EmployeeFairnessCounters>
  employeeMap: Record<string, string>
}) {
  const entries = Object.entries(fairnessSummary).sort(([, a], [, b]) => b.totalShifts - a.totalShifts)

  const stats = {
    night:   colStats(entries, c => c.nightShifts ?? 0),
    weekend: colStats(entries, c => c.weekendShifts ?? 0),
    holiday: colStats(entries, c => c.holidayShifts ?? 0),
  }

  // Hide the Holiday column when every guard has 0 holiday shifts
  const showHoliday = stats.holiday.max > 0

  // Amber highlight only for Night / Weekend / Holiday max cells
  function cellClass(val: number, stat: ColStats): string {
    if (stat.max > stat.min && val === stat.max) {
      return 'bg-amber-50 text-amber-800 font-semibold rounded'
    }
    return 'text-gray-500'
  }

  // Spread caption for Night / Weekend / Holiday where there is actual spread
  const spreadParts: string[] = []
  if (stats.night.max > stats.night.min)     spreadParts.push(`Night: ${stats.night.min}–${stats.night.max}`)
  if (stats.weekend.max > stats.weekend.min) spreadParts.push(`Weekend: ${stats.weekend.min}–${stats.weekend.max}`)
  if (showHoliday && stats.holiday.max > stats.holiday.min) spreadParts.push(`Holiday: ${stats.holiday.min}–${stats.holiday.max}`)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Guard Fairness</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            {/* Group label row */}
            <tr className="text-gray-400">
              <th className="text-left px-1 pb-0 font-medium" rowSpan={2} style={{ verticalAlign: 'bottom' }}>
                Guard
              </th>
              <th className="text-center px-1 pb-0 font-medium" rowSpan={2} style={{ verticalAlign: 'bottom' }}>
                Total
              </th>
              <th
                colSpan={3}
                className="text-center px-1 pt-1 pb-0 font-medium text-gray-300 text-[10px] uppercase tracking-wider border-b border-gray-100"
              >
                Shift type
              </th>
              <th
                colSpan={showHoliday ? 2 : 1}
                className="text-center px-1 pt-1 pb-0 font-medium text-gray-300 text-[10px] uppercase tracking-wider border-b border-gray-100"
              >
                Day type
              </th>
            </tr>
            {/* Column label row */}
            <tr className="text-gray-400 border-b border-gray-100">
              <th className="text-right py-1 px-1 font-medium">M</th>
              <th className="text-right py-1 px-1 font-medium">E</th>
              <th className="text-right py-1 px-1 font-medium">N</th>
              <th className="text-right py-1 px-1 font-medium">Wknd</th>
              {showHoliday && <th className="text-right py-1 px-1 font-medium">Hol</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {entries.map(([empId, c]) => (
              <tr key={empId} className="hover:bg-gray-50">
                <td className="py-1.5 px-1 text-gray-800 font-medium truncate max-w-[80px]">
                  {employeeMap[empId] ?? empId.slice(0, 8)}
                </td>
                <td className="py-1.5 px-1 text-right text-gray-700 font-medium">{c.totalShifts}</td>
                {/* Shift type — plain, no highlight */}
                <td className="py-1.5 px-1 text-right text-gray-400">{c.morningShifts ?? 0}</td>
                <td className="py-1.5 px-1 text-right text-gray-400">{c.eveningShifts ?? 0}</td>
                <td className={`py-1.5 px-1 text-right ${cellClass(c.nightShifts ?? 0, stats.night)}`}>
                  {c.nightShifts ?? 0}
                </td>
                {/* Day type — highlighted */}
                <td className={`py-1.5 px-1 text-right ${cellClass(c.weekendShifts ?? 0, stats.weekend)}`}>
                  {c.weekendShifts ?? 0}
                </td>
                {showHoliday && (
                  <td className={`py-1.5 px-1 text-right ${cellClass(c.holidayShifts ?? 0, stats.holiday)}`}>
                    {c.holidayShifts ?? 0}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spreadParts.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-400 leading-snug">
          Spread — {spreadParts.join(' · ')}
        </p>
      )}
    </div>
  )
}

export default function ScheduleGeneratorClient({ manager, employees }: Props) {
  const [month, setMonth] = useState<string>(getDefaultMonth)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [draftState, setDraftState] = useState<DraftState | null>(null)
  const [publishedRun, setPublishedRun] = useState<PublishedRun | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [selectedDraftShift, setSelectedDraftShift] = useState<Shift | null>(null)

  const employeeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of employees) map[e.id] = e.name
    return map
  }, [employees])

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // Called when SlotPanel assigns a guard: update local state so coverage pills refresh immediately
  const handleDraftAssign = useCallback((shiftId: string, employeeId: string) => {
    setDraftState(prev => {
      if (!prev) return prev
      const newAssignments = [...prev.assignments, { id: `optimistic-${employeeId}-${shiftId}`, employee_id: employeeId, shift_id: shiftId }]
      const newShifts = prev.shifts.map((s: any) =>
        s.id === shiftId ? { ...s, assignment_count: (s.assignment_count ?? 0) + 1 } : s,
      )
      return { ...prev, assignments: newAssignments, shifts: newShifts }
    })
    // Also update the selectedDraftShift so the panel sees fresh headcount
    setSelectedDraftShift(prev => prev?.id === shiftId ? { ...prev, assignment_count: (prev as any).assignment_count + 1 } as any : prev)
  }, [])

  // Called when SlotPanel removes a guard
  const handleDraftUnassign = useCallback((shiftId: string, employeeId: string) => {
    setDraftState(prev => {
      if (!prev) return prev
      const newAssignments = prev.assignments.filter(
        a => !(a.shift_id === shiftId && a.employee_id === employeeId),
      )
      const newShifts = prev.shifts.map((s: any) =>
        s.id === shiftId ? { ...s, assignment_count: Math.max(0, (s.assignment_count ?? 0) - 1) } : s,
      )
      return { ...prev, assignments: newAssignments, shifts: newShifts }
    })
    setSelectedDraftShift(prev => prev?.id === shiftId ? { ...prev, assignment_count: Math.max(0, ((prev as any).assignment_count ?? 1) - 1) } as any : prev)
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
        setPublishedRun(data.published_run ?? null)
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

  async function handlePublish() {
    setShowPublishConfirm(false)
    setIsPublishing(true)
    try {
      const res = await fetch('/api/schedule/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('error', data.error ?? 'Publish failed')
        return
      }
      setPublishedRun({ id: data.run_id, generated_at: new Date().toISOString() })
      // Reload draft state — the run is now published, so draft endpoint returns null run
      const draftRes = await fetch(`/api/schedule/draft?month=${month}`)
      if (draftRes.ok) {
        const draftData = await draftRes.json()
        setPublishedRun(draftData.published_run ?? null)
        setDraftState(draftData.run ? {
          run: draftData.run,
          shifts: draftData.shifts,
          assignments: draftData.assignments,
          wasRegeneration: false,
        } : null)
      }
      showToast('success', `${displayMonth} schedule published`)
    } catch {
      showToast('error', 'Network error — please try again')
    } finally {
      setIsPublishing(false)
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

      {/* Publish confirmation modal */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Publish schedule</h2>
            <p className="text-sm text-gray-600 mb-5">
              This publishes the <strong>{displayMonth}</strong> schedule and replaces any previously published version.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowPublishConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
              >
                Publish
              </button>
            </div>
          </div>
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
            disabled={isGenerating || isPublishing}
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

          {draftState && (
            <button
              onClick={() => setShowPublishConfirm(true)}
              disabled={isGenerating || isPublishing}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {isPublishing ? (
                <>
                  <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Publishing…
                </>
              ) : (
                'Publish schedule'
              )}
            </button>
          )}
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

      {/* Published badge (shown even without a draft) */}
      {publishedRun && !draftState && (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 border border-green-300 text-green-800 text-xs font-semibold rounded-full uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Published
          </span>
          <span className="text-sm font-medium text-gray-700">{displayMonth}</span>
          <span className="text-xs text-gray-500">
            Published {format(parseISO(publishedRun.generated_at), 'MMM d, yyyy \'at\' HH:mm')}
          </span>
        </div>
      )}

      {/* Draft view */}
      {draftState && (
        <>
          {/* Draft header banner */}
          <div className="flex items-center gap-3 flex-wrap gap-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold rounded-full uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              Draft
            </span>
            <span className="text-sm font-medium text-gray-700">{displayMonth}</span>
            {draftState.wasRegeneration && (
              <span className="text-xs text-gray-500 italic">Previous draft replaced</span>
            )}
            {publishedRun && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-green-100 border border-green-300 text-green-800 text-xs font-semibold rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Published {format(parseISO(publishedRun.generated_at), 'MMM d')} — live
              </span>
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
                onDraftSlotClick={(shift) => setSelectedDraftShift(shift)}
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
                  <div className="space-y-1.5">
                    {groupUnfilledSlots(unfilledSlots).map((group) => {
                      const [, shiftType] = group.key.split('|')
                      const shiftChipClass =
                        shiftType === 'morning' ? 'bg-amber-100 text-amber-700'
                        : shiftType === 'evening' ? 'bg-blue-100 text-blue-700'
                        : 'bg-indigo-100 text-indigo-700'
                      const isPattern = group.dates.length > 1
                      const shiftLabel = isPattern
                        ? (SHIFT_TYPE_LABEL_PLURAL[shiftType] ?? shiftType)
                        : (SHIFT_TYPE_LABEL_SINGULAR[shiftType] ?? shiftType)
                      return (
                        <div key={group.key} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                          <span className="text-gray-700">
                            {isPattern
                              ? `${group.label} ${shiftLabel} (${group.dates.length} dates)`
                              : `${group.label} ${shiftLabel} — ${format(parseISO(group.dates[0]), 'MMM d')}`}
                          </span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${shiftChipClass}`}>
                            {shiftType}
                          </span>
                        </div>
                      )
                    })}
                    <p className="text-xs text-gray-400 pt-1">{unfilledSlots.length} slot{unfilledSlots.length !== 1 ? 's' : ''} could not be filled</p>
                  </div>
                )}
              </div>

              {/* Per-guard fairness */}
              {fairnessSummary && Object.keys(fairnessSummary).length > 0 && (
                <FairnessPanel
                  fairnessSummary={fairnessSummary}
                  employeeMap={employeeMap}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* Draft slot panel */}
      {selectedDraftShift && draftState && (
        <SlotPanel
          shift={selectedDraftShift as any}
          runId={draftState.run.id}
          employeeMap={employeeMap}
          assignedGuardIds={
            draftState.assignments
              .filter(a => a.shift_id === selectedDraftShift.id)
              .map(a => a.employee_id)
          }
          onClose={() => setSelectedDraftShift(null)}
          onAssign={(employeeId) => handleDraftAssign(selectedDraftShift.id, employeeId)}
          onUnassign={(employeeId) => handleDraftUnassign(selectedDraftShift.id, employeeId)}
        />
      )}
    </div>
  )
}
