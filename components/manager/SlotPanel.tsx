'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import type { Shift } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EligibleCandidate {
  employee_id: string
  name: string
  score: number
  reason: string
  load: { totalShifts: number; nightShifts: number }
}

interface IneligibleCandidate {
  employee_id: string
  name: string
  reason: string
}

interface CandidatesData {
  eligible: EligibleCandidate[]
  ineligible: IneligibleCandidate[]
}

interface Props {
  shift: Shift & { assignment_count?: number; assigned_employee_ids?: string[] }
  runId: string
  employeeMap: Record<string, string>
  assignedGuardIds: string[]
  /** Guards on approved leave for this shift's date (published mode only) */
  sickGuardIds?: Set<string>
  /** 'draft' uses assign/unassign-draft; 'published' uses assign/unassign-published */
  mode?: 'draft' | 'published'
  onClose: () => void
  onAssign: (employeeId: string, employeeName: string) => void
  onUnassign: (employeeId: string) => void
  onMarkSick?: (employeeId: string, employeeName: string) => void
}

const SHIFT_TIMES: Record<string, { start: string; end: string }> = {
  morning: { start: '09:00', end: '17:00' },
  evening: { start: '17:00', end: '01:00' },
  night:   { start: '01:00', end: '09:00' },
}

// ---------------------------------------------------------------------------
// SlotPanel
// ---------------------------------------------------------------------------

export default function SlotPanel({
  shift,
  runId,
  employeeMap,
  assignedGuardIds,
  sickGuardIds,
  mode = 'draft',
  onClose,
  onAssign,
  onUnassign,
  onMarkSick,
}: Props) {
  const [candidates, setCandidates] = useState<CandidatesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [overrideTarget, setOverrideTarget] = useState<IneligibleCandidate | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Published: which sick guard will be replaced by the next assign action
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null)

  // Compute effective filled count: exclude on-leave guards from the coverage pill
  const sickInSlot = assignedGuardIds.filter(id => sickGuardIds?.has(id))
  const effectiveFilled = assignedGuardIds.length - sickInSlot.length
  const headcount = shift.headcount ?? 1
  const needsCover = mode === 'published' && sickInSlot.length > 0

  // Auto-set replaceTarget when there is exactly one sick guard in the slot
  // (manager can clear it to add cover without replacing)
  useEffect(() => {
    if (mode === 'published' && sickInSlot.length === 1) {
      setReplaceTarget(sickInSlot[0])
    } else {
      setReplaceTarget(null)
    }
  }, [mode, assignedGuardIds.join(','), sickGuardIds])

  const fetchCandidates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const modeParam = mode === 'published' ? '&mode=published' : ''
      const res = await fetch(
        `/api/schedule/candidates?run_id=${runId}&date=${shift.date}&shift_type=${shift.shift_type}${modeParam}`,
      )
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to load candidates'); return }
      setCandidates(data)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [runId, shift.date, shift.shift_type, mode])

  useEffect(() => { fetchCandidates() }, [fetchCandidates])

  async function handleAssign(employeeId: string, employeeName: string, override = false) {
    setBusy(employeeId)
    setActionError(null)
    try {
      const endpoint = mode === 'published'
        ? '/api/schedule/assign-published'
        : '/api/schedule/assign-draft'

      const body: Record<string, unknown> = {
        run_id: runId,
        date: shift.date,
        shift_type: shift.shift_type,
        employee_id: employeeId,
        override,
      }
      if (mode === 'published' && replaceTarget) {
        body.replace_employee_id = replaceTarget
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error ?? 'Failed to assign')
        return
      }
      // If a replace happened, unassign the replaced guard from optimistic state
      if (mode === 'published' && replaceTarget) {
        onUnassign(replaceTarget)
      }
      onAssign(employeeId, employeeName)
      await fetchCandidates()
    } catch {
      setActionError('Network error')
    } finally {
      setBusy(null)
    }
  }

  async function handleUnassign(employeeId: string) {
    setBusy(employeeId)
    setActionError(null)
    try {
      const endpoint = mode === 'published'
        ? '/api/schedule/unassign-published'
        : '/api/schedule/unassign-draft'

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, date: shift.date, shift_type: shift.shift_type, employee_id: employeeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error ?? 'Failed to remove')
        return
      }
      onUnassign(employeeId)
      await fetchCandidates()
    } catch {
      setActionError('Network error')
    } finally {
      setBusy(null)
    }
  }

  const times = SHIFT_TIMES[shift.shift_type] ?? { start: shift.start_time, end: shift.end_time }
  const isFull = effectiveFilled >= headcount

  const SHIFT_COLOR: Record<string, string> = {
    morning: 'text-amber-700 bg-amber-50 border-amber-200',
    evening: 'text-blue-700 bg-blue-50 border-blue-200',
    night: 'text-indigo-700 bg-indigo-50 border-indigo-200',
  }
  const chipClass = SHIFT_COLOR[shift.shift_type] ?? 'text-gray-700 bg-gray-50 border-gray-200'

  // Coverage pill: in published mode, show effective fill (excluding on-leave guards)
  const coverageLabel = mode === 'published'
    ? `${effectiveFilled}/${headcount} covering`
    : `${assignedGuardIds.length}/${headcount} filled`
  const coverageClass = needsCover
    ? 'bg-red-50 border-red-300 text-red-700'
    : isFull
    ? 'bg-green-50 border-green-200 text-green-700'
    : assignedGuardIds.length === 0
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-amber-50 border-amber-200 text-amber-700'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white z-50 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded border capitalize ${chipClass}`}>
                {shift.shift_type}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${coverageClass}`}>
                {coverageLabel}
              </span>
              {needsCover && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded border bg-red-100 border-red-400 text-red-800 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  Needs cover
                </span>
              )}
              {mode === 'published' && (
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-50 border border-green-300 text-green-700">
                  Live edit
                </span>
              )}
            </div>
            <p className="text-base font-semibold text-gray-900">
              {format(parseISO(shift.date), 'EEEE, MMM d')}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {times.start} – {times.end}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {actionError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {actionError}
            </div>
          )}

          {/* Replace notice: shown when a replace_employee_id is set */}
          {mode === 'published' && replaceTarget && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-800 flex items-start gap-2">
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span>
                Assigning a guard will <strong>replace {employeeMap[replaceTarget] ?? 'the on-leave guard'}</strong> in this slot.{' '}
                <button
                  className="underline text-amber-700 hover:text-amber-900"
                  onClick={() => setReplaceTarget(null)}
                >
                  Add cover instead
                </button>
              </span>
            </div>
          )}

          {/* Assigned guards */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Assigned ({assignedGuardIds.length})
            </p>
            {assignedGuardIds.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No one assigned yet</p>
            ) : (
              <ul className="space-y-1.5">
                {assignedGuardIds.map(id => {
                  const isOnLeave = sickGuardIds?.has(id) ?? false
                  return (
                    <li key={id} className={`flex items-center justify-between rounded-lg px-3 py-2 ${isOnLeave ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {employeeMap[id] ?? id.slice(0, 8)}
                        </span>
                        {isOnLeave && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 border border-red-300 text-red-700 uppercase tracking-wide">
                            On leave
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {mode === 'published' && !isOnLeave && onMarkSick && (
                          <button
                            onClick={() => onMarkSick(id, employeeMap[id] ?? id)}
                            disabled={busy === id}
                            className="text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50 transition-colors"
                          >
                            Mark sick
                          </button>
                        )}
                        <button
                          onClick={() => handleUnassign(id)}
                          disabled={busy === id}
                          className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50 transition-colors"
                        >
                          {busy === id ? '…' : 'Remove'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Candidates */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading candidates…
            </div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : candidates && (
            <>
              {/* Eligible */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Eligible ({candidates.eligible.filter(c => !assignedGuardIds.includes(c.employee_id)).length})
                </p>
                {candidates.eligible.filter(c => !assignedGuardIds.includes(c.employee_id)).length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No eligible guards available</p>
                ) : (
                  <ul className="space-y-2">
                    {candidates.eligible
                      .filter(c => !assignedGuardIds.includes(c.employee_id))
                      .map((c, idx) => (
                        <li key={c.employee_id} className="border border-gray-100 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-gray-400 font-medium w-4 shrink-0">#{idx + 1}</span>
                                <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5 ml-5">{c.reason}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5 ml-5">
                                {c.load.totalShifts} total · {c.load.nightShifts} nights this month
                              </p>
                            </div>
                            <button
                              onClick={() => handleAssign(c.employee_id, c.name)}
                              disabled={busy === c.employee_id}
                              className="shrink-0 px-3 py-1.5 bg-[#1B3A5C] hover:bg-[#16304e] text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                            >
                              {busy === c.employee_id ? '…' : replaceTarget ? 'Replace' : 'Assign'}
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {/* Ineligible */}
              {candidates.ineligible.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Not eligible ({candidates.ineligible.length})
                  </p>
                  <ul className="space-y-2">
                    {candidates.ineligible.map(c => (
                      <li key={c.employee_id} className="border border-gray-100 rounded-lg p-3 bg-gray-50 opacity-75">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-gray-600 truncate block">{c.name}</span>
                            <p className="text-xs text-gray-400 mt-0.5">{c.reason}</p>
                          </div>
                          <button
                            onClick={() => { setOverrideTarget(c); setActionError(null) }}
                            disabled={busy === c.employee_id}
                            className="shrink-0 px-2.5 py-1.5 border border-gray-300 text-gray-600 hover:border-amber-400 hover:text-amber-700 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                          >
                            Override
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Override confirmation modal */}
      {overrideTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" onClick={() => setOverrideTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Override scheduling rule?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Assigning <strong>{overrideTarget.name}</strong> breaks a rule:
                </p>
                <p className="mt-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {overrideTarget.reason}
                </p>
                {mode === 'published' && replaceTarget && (
                  <p className="mt-2 text-xs text-gray-500">
                    This will also replace <strong>{employeeMap[replaceTarget] ?? 'the on-leave guard'}</strong>.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setOverrideTarget(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const target = overrideTarget
                  setOverrideTarget(null)
                  await handleAssign(target.employee_id, target.name, true)
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2 rounded-lg text-sm transition-colors"
              >
                {replaceTarget ? 'Replace anyway' : 'Assign anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
