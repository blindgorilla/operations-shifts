'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, parseISO, addMonths, isWithinInterval } from 'date-fns'
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

interface ScheduleAssignment {
  id: string
  employee_id: string
  shift_id: string
}

interface LeaveRecord {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  type: string
}

interface ScheduleRun {
  id: string
  period_start: string
  period_end: string
  status: string
  generated_at: string
  last_edited_at?: string | null
  fairness_summary: Record<string, EmployeeFairnessCounters> | null
  parameters_snapshot: { unfilled_slots?: UnfilledSlot[]; month?: string } | null
}

interface ScheduleState {
  run: ScheduleRun
  shifts: any[]
  assignments: ScheduleAssignment[]
  leaveRecords?: LeaveRecord[]
  wasRegeneration?: boolean
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

/** Returns the set of employee IDs on approved leave for a specific date */
function getLeaveGuardsForDate(leaveRecords: LeaveRecord[], date: string): Set<string> {
  const d = parseISO(date)
  const ids = new Set<string>()
  for (const r of leaveRecords) {
    if (isWithinInterval(d, { start: parseISO(r.start_date), end: parseISO(r.end_date) })) {
      ids.add(r.employee_id)
    }
  }
  return ids
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
// FairnessPanel
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

  const showHoliday = stats.holiday.max > 0

  function cellClass(val: number, stat: ColStats): string {
    if (stat.max > stat.min && val === stat.max) return 'bg-amber-50 text-amber-800 font-semibold rounded'
    return 'text-gray-500'
  }

  const spreadParts: string[] = []
  if (stats.night.max > stats.night.min)     spreadParts.push(`Night: ${stats.night.min}-${stats.night.max}`)
  if (stats.weekend.max > stats.weekend.min) spreadParts.push(`Weekend: ${stats.weekend.min}-${stats.weekend.max}`)
  if (showHoliday && stats.holiday.max > stats.holiday.min) spreadParts.push(`Holiday: ${stats.holiday.min}-${stats.holiday.max}`)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Guard Fairness</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left px-1 pb-0 font-medium" rowSpan={2} style={{ verticalAlign: 'bottom' }}>Guard</th>
              <th className="text-center px-1 pb-0 font-medium" rowSpan={2} style={{ verticalAlign: 'bottom' }}>Total</th>
              <th colSpan={3} className="text-center px-1 pt-1 pb-0 font-medium text-gray-300 text-[10px] uppercase tracking-wider border-b border-gray-100">Shift type</th>
              <th colSpan={showHoliday ? 2 : 1} className="text-center px-1 pt-1 pb-0 font-medium text-gray-300 text-[10px] uppercase tracking-wider border-b border-gray-100">Day type</th>
            </tr>
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
                <td className="py-1.5 px-1 text-gray-800 font-medium truncate max-w-[80px]">{employeeMap[empId] ?? empId.slice(0, 8)}</td>
                <td className="py-1.5 px-1 text-right text-gray-700 font-medium">{c.totalShifts}</td>
                <td className="py-1.5 px-1 text-right text-gray-400">{c.morningShifts ?? 0}</td>
                <td className="py-1.5 px-1 text-right text-gray-400">{c.eveningShifts ?? 0}</td>
                <td className={`py-1.5 px-1 text-right ${cellClass(c.nightShifts ?? 0, stats.night)}`}>{c.nightShifts ?? 0}</td>
                <td className={`py-1.5 px-1 text-right ${cellClass(c.weekendShifts ?? 0, stats.weekend)}`}>{c.weekendShifts ?? 0}</td>
                {showHoliday && (
                  <td className={`py-1.5 px-1 text-right ${cellClass(c.holidayShifts ?? 0, stats.holiday)}`}>{c.holidayShifts ?? 0}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spreadParts.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-400 leading-snug">Spread -- {spreadParts.join(' - ')}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryPanel
// ---------------------------------------------------------------------------

function SummaryPanel({
  assignmentCount,
  unfilledSlots,
  fairnessSummary,
  employeeMap,
  labelSuffix,
}: {
  assignmentCount: number
  unfilledSlots: UnfilledSlot[]
  fairnessSummary: Record<string, EmployeeFairnessCounters> | null
  employeeMap: Record<string, string>
  labelSuffix: string
}) {
  return (
    <div className="w-full lg:w-80 shrink-0 space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Total Assignments</p>
        <p className="text-3xl font-bold text-[#1B3A5C]">{assignmentCount}</p>
        <p className="text-xs text-gray-400 mt-0.5">shifts assigned {labelSuffix}</p>
      </div>

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
                      : `${group.label} ${shiftLabel} -- ${format(parseISO(group.dates[0]), 'MMM d')}`}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${shiftChipClass}`}>{shiftType}</span>
                </div>
              )
            })}
            <p className="text-xs text-gray-400 pt-1">{unfilledSlots.length} slot{unfilledSlots.length !== 1 ? 's' : ''} could not be filled</p>
          </div>
        )}
      </div>

      {fairnessSummary && Object.keys(fairnessSummary).length > 0 && (
        <FairnessPanel fairnessSummary={fairnessSummary} employeeMap={employeeMap} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MarkSickModal
// ---------------------------------------------------------------------------

interface MarkSickModalProps {
  employeeName: string
  defaultDate: string
  onConfirm: (fromDate: string, throughDate: string) => Promise<void>
  onCancel: () => void
}

function MarkSickModal({ employeeName, defaultDate, onConfirm, onCancel }: MarkSickModalProps) {
  const [fromDate, setFromDate] = useState(defaultDate)
  const [throughDate, setThroughDate] = useState(defaultDate)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit() {
    if (throughDate < fromDate) { setErr('Through date must be on or after from date'); return }
    setBusy(true)
    setErr(null)
    try {
      await onConfirm(fromDate, throughDate)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to mark sick')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Mark sick</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Record sick leave for <strong>{employeeName}</strong>. This will flag their shifts as needing cover.
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Through</label>
            <input
              type="date"
              value={throughDate}
              onChange={e => setThroughDate(e.target.value)}
              min={fromDate}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
            />
          </div>
        </div>

        {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors"
          >
            {busy ? 'Saving…' : 'Mark sick'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ScheduleGeneratorClient({ manager, employees }: Props) {
  const [month, setMonth] = useState<string>(getDefaultMonth)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isDownloadingPDF, setIsDownloadingPDF] = useState(false)
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [draftState, setDraftState] = useState<ScheduleState | null>(null)
  const [publishedState, setPublishedState] = useState<ScheduleState | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [selectedDraftShift, setSelectedDraftShift] = useState<Shift | null>(null)
  const [selectedPublishedShift, setSelectedPublishedShift] = useState<Shift | null>(null)
  // Mark sick modal state
  const [markSickTarget, setMarkSickTarget] = useState<{ employeeId: string; employeeName: string; shiftDate: string } | null>(null)

  const employeeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of employees) map[e.id] = e.name
    return map
  }, [employees])

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // ---------------------------------------------------------------------------
  // Draft optimistic updates
  // ---------------------------------------------------------------------------

  const handleDraftAssign = useCallback((shiftId: string, employeeId: string) => {
    setDraftState(prev => {
      if (!prev) return prev
      const newAssignments = [
        ...prev.assignments,
        { id: `optimistic-${employeeId}-${shiftId}`, employee_id: employeeId, shift_id: shiftId },
      ]
      const newShifts = prev.shifts.map((s: any) =>
        s.id === shiftId ? { ...s, assignment_count: (s.assignment_count ?? 0) + 1 } : s,
      )
      return { ...prev, assignments: newAssignments, shifts: newShifts }
    })
    setSelectedDraftShift(prev =>
      prev?.id === shiftId
        ? { ...prev, assignment_count: ((prev as any).assignment_count ?? 0) + 1 } as any
        : prev,
    )
  }, [])

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
    setSelectedDraftShift(prev =>
      prev?.id === shiftId
        ? { ...prev, assignment_count: Math.max(0, ((prev as any).assignment_count ?? 1) - 1) } as any
        : prev,
    )
  }, [])

  // ---------------------------------------------------------------------------
  // Published optimistic updates
  // ---------------------------------------------------------------------------

  const handlePublishedAssign = useCallback((shiftId: string, employeeId: string, lastEditedAt?: string) => {
    setPublishedState(prev => {
      if (!prev) return prev
      const newAssignments = [
        ...prev.assignments,
        { id: `optimistic-pub-${employeeId}-${shiftId}`, employee_id: employeeId, shift_id: shiftId },
      ]
      const newShifts = prev.shifts.map((s: any) =>
        s.id === shiftId ? { ...s, assignment_count: (s.assignment_count ?? 0) + 1 } : s,
      )
      return {
        ...prev,
        assignments: newAssignments,
        shifts: newShifts,
        run: lastEditedAt ? { ...prev.run, last_edited_at: lastEditedAt } : prev.run,
      }
    })
    setSelectedPublishedShift(prev =>
      prev?.id === shiftId
        ? { ...prev, assignment_count: ((prev as any).assignment_count ?? 0) + 1 } as any
        : prev,
    )
  }, [])

  const handlePublishedUnassign = useCallback((shiftId: string, employeeId: string, lastEditedAt?: string) => {
    setPublishedState(prev => {
      if (!prev) return prev
      const newAssignments = prev.assignments.filter(
        a => !(a.shift_id === shiftId && a.employee_id === employeeId),
      )
      const newShifts = prev.shifts.map((s: any) =>
        s.id === shiftId ? { ...s, assignment_count: Math.max(0, (s.assignment_count ?? 0) - 1) } : s,
      )
      return {
        ...prev,
        assignments: newAssignments,
        shifts: newShifts,
        run: lastEditedAt ? { ...prev.run, last_edited_at: lastEditedAt } : prev.run,
      }
    })
    setSelectedPublishedShift(prev =>
      prev?.id === shiftId
        ? { ...prev, assignment_count: Math.max(0, ((prev as any).assignment_count ?? 1) - 1) } as any
        : prev,
    )
  }, [])

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false

    async function fetchBoth() {
      try {
        const res = await fetch(`/api/schedule/draft?month=${month}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        setDraftState(data.run ? { run: data.run, shifts: data.shifts, assignments: data.assignments } : null)
      } catch { /* silent */ }

      if (cancelled) return

      try {
        const res = await fetch(`/api/schedule/published?month=${month}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        setPublishedState(data.run
          ? { run: data.run, shifts: data.shifts, assignments: data.assignments, leaveRecords: data.leaveRecords ?? [] }
          : null)
      } catch { /* silent */ }
    }

    fetchBoth()
    return () => { cancelled = true }
  }, [month])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

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
      if (!res.ok) { showToast('error', data.error ?? 'Generation failed'); return }

      const draftRes = await fetch(`/api/schedule/draft?month=${month}`)
      if (!draftRes.ok) { showToast('error', 'Generated but failed to load draft'); return }
      const draftData = await draftRes.json()
      setDraftState({
        run: draftData.run,
        shifts: draftData.shifts,
        assignments: draftData.assignments,
        wasRegeneration: hadExistingDraft,
      })
      showToast('success', hadExistingDraft ? 'Draft replaced successfully' : 'Draft generated successfully')
    } catch {
      showToast('error', 'Network error -- please try again')
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
      if (!res.ok) { showToast('error', data.error ?? 'Publish failed'); return }

      const [draftRes, pubRes] = await Promise.all([
        fetch(`/api/schedule/draft?month=${month}`),
        fetch(`/api/schedule/published?month=${month}`),
      ])
      if (draftRes.ok) {
        const d = await draftRes.json()
        setDraftState(d.run ? { run: d.run, shifts: d.shifts, assignments: d.assignments } : null)
      }
      if (pubRes.ok) {
        const p = await pubRes.json()
        setPublishedState(p.run
          ? { run: p.run, shifts: p.shifts, assignments: p.assignments, leaveRecords: p.leaveRecords ?? [] }
          : null)
      }
      showToast('success', `${displayMonth} schedule published`)
    } catch {
      showToast('error', 'Network error -- please try again')
    } finally {
      setIsPublishing(false)
    }
  }

  async function handleDownloadPDF() {
    setIsDownloadingPDF(true)
    try {
      const res = await fetch(`/api/schedule/pdf?month=${month}`)
      if (!res.ok) { showToast('error', 'PDF generation failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `schedule-${month}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('error', 'Failed to download PDF')
    } finally {
      setIsDownloadingPDF(false)
    }
  }

  async function handleMarkSickConfirm(fromDate: string, throughDate: string) {
    if (!markSickTarget) return
    const res = await fetch('/api/schedule/mark-sick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: markSickTarget.employeeId,
        from_date: fromDate,
        through_date: throughDate,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to mark sick')

    // Refresh published state to pick up new leave record
    const pubRes = await fetch(`/api/schedule/published?month=${month}`)
    if (pubRes.ok) {
      const p = await pubRes.json()
      setPublishedState(p.run
        ? { run: p.run, shifts: p.shifts, assignments: p.assignments, leaveRecords: p.leaveRecords ?? [] }
        : null)
    }
    setMarkSickTarget(null)
    showToast('success', `Sick leave recorded for ${markSickTarget.employeeName}`)
  }

  // ---------------------------------------------------------------------------
  // Calendar data builders
  // ---------------------------------------------------------------------------

  function buildCalShifts(state: ScheduleState) {
    const byShift: Record<string, ScheduleAssignment[]> = {}
    for (const a of state.assignments) {
      if (!byShift[a.shift_id]) byShift[a.shift_id] = []
      byShift[a.shift_id].push(a)
    }
    return state.shifts.map((s: any) => ({
      ...s,
      assigned_employees: (byShift[s.id] ?? []).map(a => employeeMap[a.employee_id] ?? 'Unknown'),
      assigned_employee_ids: (byShift[s.id] ?? []).map(a => a.employee_id),
    }))
  }

  const draftCalShifts     = useMemo(() => draftState     ? buildCalShifts(draftState)     : [], [draftState, employeeMap])
  // publishedCalShifts: same as draft but also annotates effective_assignment_count
  // (raw count minus on-leave guards) so the calendar pill agrees with SlotPanel.
  const publishedCalShifts = useMemo(() => {
    if (!publishedState) return []
    const leaveRecords = publishedState.leaveRecords ?? []
    const base = buildCalShifts(publishedState)
    return base.map((s: any) => {
      const leaveGuards = getLeaveGuardsForDate(leaveRecords, s.date)
      const onLeaveCount = (s.assigned_employee_ids as string[]).filter(id => leaveGuards.has(id)).length
      return { ...s, effective_assignment_count: s.assignment_count - onLeaveCount }
    })
  }, [publishedState, employeeMap])

  // Shift IDs with at least one guard on approved leave — same overlap check as above
  const needsCoverShiftIds = useMemo(() => {
    if (!publishedState) return new Set<string>()
    const leaveRecords = publishedState.leaveRecords ?? []
    const ids = new Set<string>()
    for (const s of publishedState.shifts) {
      const guardIds = publishedState.assignments.filter(a => a.shift_id === s.id).map(a => a.employee_id)
      const leaveGuards = getLeaveGuardsForDate(leaveRecords, s.date)
      if (guardIds.some(id => leaveGuards.has(id))) ids.add(s.id)
    }
    return ids
  }, [publishedState])

  // Calendar defaultDate derived from selected month
  const calendarDefaultDate = useMemo(() => {
    try { return parseISO(`${month}-01`) } catch { return new Date() }
  }, [month])

  const displayMonth = formatMonthDisplay(month)

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Publish schedule</h2>
            <p className="text-sm text-gray-600 mb-5">
              This publishes the <strong>{displayMonth}</strong> schedule and replaces any previously published version.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowPublishConfirm(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handlePublish} className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors">
                Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark sick modal */}
      {markSickTarget && (
        <MarkSickModal
          employeeName={markSickTarget.employeeName}
          defaultDate={markSickTarget.shiftDate}
          onConfirm={handleMarkSickConfirm}
          onCancel={() => setMarkSickTarget(null)}
        />
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Month</label>
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
                Generating...
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
                  Publishing...
                </>
              ) : 'Publish schedule'}
            </button>
          )}
        </div>

        {draftState && !isGenerating && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>
              A draft for <strong>{displayMonth}</strong> already exists
              {draftState.run.generated_at && (
                <> (generated {format(parseISO(draftState.run.generated_at), "MMM d, yyyy 'at' HH:mm")})</>
              )}. Clicking Regenerate will replace it.
            </span>
          </div>
        )}
      </div>

      {/* Published schedule view */}
      {publishedState && (
        <>
          <div className="flex items-center gap-3 flex-wrap gap-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 border border-green-300 text-green-800 text-xs font-semibold rounded-full uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Published
            </span>
            <span className="text-sm font-medium text-gray-700">{displayMonth}</span>
            <span className="text-xs text-gray-500">
              Published {format(parseISO(publishedState.run.generated_at), "MMM d, yyyy 'at' HH:mm")}
            </span>
            {publishedState.run.last_edited_at && (
              <span className="text-xs text-blue-600 font-medium">
                · Last updated {format(parseISO(publishedState.run.last_edited_at), "MMM d 'at' HH:mm")}
              </span>
            )}
            {!draftState && (
              <span className="text-xs text-gray-400 italic">This is the live schedule</span>
            )}
            {needsCoverShiftIds.size > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 border border-red-300 text-red-800 text-xs font-semibold rounded-full">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {needsCoverShiftIds.size} shift{needsCoverShiftIds.size !== 1 ? 's' : ''} need cover
              </span>
            )}
            <span className="text-xs text-gray-400 italic ml-1">Click a shift to edit</span>
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloadingPDF}
              className="ml-auto flex items-center gap-2 bg-white border border-gray-300 hover:border-[#1B3A5C] hover:text-[#1B3A5C] disabled:opacity-60 disabled:cursor-not-allowed text-gray-700 text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {isDownloadingPDF ? (
                <>
                  <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Generating PDF...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  Download PDF
                </>
              )}
            </button>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 min-w-0">
              <ShiftCalendarClient
                shifts={publishedCalShifts}
                employee={manager}
                requestedShiftIds={[]}
                assignedShiftIds={[]}
                draftMode={true}
                defaultDate={calendarDefaultDate}
                needsCoverShiftIds={needsCoverShiftIds}
                onDraftSlotClick={(shift) => setSelectedPublishedShift(shift)}
              />
            </div>
            <SummaryPanel
              assignmentCount={publishedState.assignments.length}
              unfilledSlots={publishedState.run.parameters_snapshot?.unfilled_slots ?? []}
              fairnessSummary={publishedState.run.fairness_summary}
              employeeMap={employeeMap}
              labelSuffix="in published schedule"
            />
          </div>
        </>
      )}

      {/* Draft view */}
      {draftState && (
        <>
          <div className="flex items-center gap-3 flex-wrap gap-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold rounded-full uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              Draft
            </span>
            <span className="text-sm font-medium text-gray-700">{displayMonth}</span>
            {draftState.wasRegeneration && (
              <span className="text-xs text-gray-500 italic">Previous draft replaced</span>
            )}
            {publishedState && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-green-100 border border-green-300 text-green-800 text-xs font-semibold rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Published version live -- publish draft to supersede
              </span>
            )}
            <span className="ml-auto text-xs text-gray-400">Click a shift to fill slots</span>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 min-w-0">
              <ShiftCalendarClient
                shifts={draftCalShifts}
                employee={manager}
                requestedShiftIds={[]}
                assignedShiftIds={[]}
                draftMode={true}
                defaultDate={calendarDefaultDate}
                onDraftSlotClick={(shift) => setSelectedDraftShift(shift)}
              />
            </div>
            <SummaryPanel
              assignmentCount={draftState.assignments.length}
              unfilledSlots={draftState.run.parameters_snapshot?.unfilled_slots ?? []}
              fairnessSummary={draftState.run.fairness_summary}
              employeeMap={employeeMap}
              labelSuffix="shifts assigned this draft"
            />
          </div>
        </>
      )}

      {/* Draft slot-fill panel */}
      {selectedDraftShift && draftState && (
        <SlotPanel
          shift={selectedDraftShift as any}
          runId={draftState.run.id}
          employeeMap={employeeMap}
          mode="draft"
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

      {/* Published slot-fill panel */}
      {selectedPublishedShift && publishedState && (
        <SlotPanel
          shift={selectedPublishedShift as any}
          runId={publishedState.run.id}
          employeeMap={employeeMap}
          mode="published"
          assignedGuardIds={
            publishedState.assignments
              .filter(a => a.shift_id === selectedPublishedShift.id)
              .map(a => a.employee_id)
          }
          sickGuardIds={getLeaveGuardsForDate(
            publishedState.leaveRecords ?? [],
            selectedPublishedShift.date,
          )}
          onClose={() => setSelectedPublishedShift(null)}
          onAssign={(employeeId, _name, lastEditedAt) => handlePublishedAssign(selectedPublishedShift.id, employeeId, lastEditedAt)}
          onUnassign={(employeeId, lastEditedAt) => handlePublishedUnassign(selectedPublishedShift.id, employeeId, lastEditedAt)}
          onMarkSick={(employeeId, employeeName) =>
            setMarkSickTarget({ employeeId, employeeName, shiftDate: selectedPublishedShift.date })
          }
        />
      )}
    </div>
  )
}
