'use client'

import { useState } from 'react'
import {
  format, parseISO,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, addMonths, subMonths, isToday,
} from 'date-fns'
import type { ShiftRequest, RuleViolation } from '@/types'
import RuleViolationBanner from '@/components/ui/RuleViolationBanner'

interface Props {
  requests: ShiftRequest[]
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
}

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-amber-50 border-amber-300 text-amber-900',
  approved: 'bg-green-50 border-green-300 text-green-900',
  denied: 'bg-red-50 border-red-200 text-red-900',
}

const FILTER_OPTIONS = ['all', 'pending', 'approved', 'denied'] as const
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ManagerRequestsClient({ requests: initial }: Props) {
  const [requests, setRequests] = useState(initial)
  const [filter, setFilter] = useState<typeof FILTER_OPTIONS[number]>('pending')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [selected, setSelected] = useState<ShiftRequest | null>(null)
  const [managerNote, setManagerNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const filtered = filter === 'all' ? requests : requests.filter((r) => r.status === filter)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleReview(action: 'approve' | 'deny') {
    if (!selected) return
    setLoading(true)

    const res = await fetch(`/api/shift-requests/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, manager_note: managerNote }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      showToast('error', data.error ?? 'Failed to review request')
      return
    }

    setRequests((prev) =>
      prev.map((r) =>
        r.id === selected.id ? { ...r, status: data.status, manager_note: managerNote } : r
      )
    )
    showToast('success', `Request ${data.status}. Email notification sent.`)
    setSelected(null)
    setManagerNote('')
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  // Group filtered requests by date (YYYY-MM-DD) for calendar view
  const requestsByDate = filtered.reduce<Record<string, ShiftRequest[]>>((acc, r) => {
    if (!r.shift?.date) return acc
    const key = r.shift.date.slice(0, 10)
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  // Calendar grid helpers (Monday-start week)
  const monthStart = startOfMonth(calendarMonth)
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(calendarMonth) })
  // getDay: 0=Sun … 6=Sat → convert to 0=Mon … 6=Sun
  const startOffset = (getDay(monthStart) + 6) % 7
  const totalCells = startOffset + days.length
  const trailingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* View toggle + filter row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Segmented control */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            List
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'calendar' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Calendar
          </button>
        </div>

        {/* Status filters */}
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {f}{f === 'pending' && pendingCount > 0 && (
                <span className="ml-1 bg-amber-100 text-amber-800 text-xs font-semibold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── LIST VIEW ─────────────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm">No {filter === 'all' ? '' : filter} requests</p>
            </div>
          )}

          <div className="space-y-3">
            {filtered.map((req) => (
              <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{req.employee?.name}</span>
                      <span className="text-gray-400 text-sm">·</span>
                      <span className="capitalize text-gray-700 text-sm">{req.shift?.shift_type} shift</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[req.status]}`}>
                        {req.status}
                      </span>
                      {req.employee?.is_new_employee && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">New Employee</span>
                      )}
                    </div>

                    {req.shift && (
                      <p className="text-sm text-gray-600">
                        {format(parseISO(req.shift.date), 'EEEE, d MMMM yyyy')} · {req.shift.start_time.slice(0, 5)}–{req.shift.end_time.slice(0, 5)}
                        {req.shift.location && ` · ${req.shift.location}`}
                      </p>
                    )}

                    {req.employee_note && (
                      <p className="text-xs text-gray-500 mt-1">Employee note: {req.employee_note}</p>
                    )}

                    {req.manager_note && (
                      <p className="text-xs text-gray-500 mt-1 italic">Your note: {req.manager_note}</p>
                    )}

                    {req.rule_violations && req.rule_violations.length > 0 && (
                      <div className="mt-2">
                        <RuleViolationBanner violations={req.rule_violations as RuleViolation[]} />
                      </div>
                    )}
                  </div>

                  {req.status === 'pending' && (
                    <button
                      onClick={() => { setSelected(req); setManagerNote('') }}
                      className="shrink-0 text-sm font-medium bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 transition-colors"
                    >
                      Review
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── CALENDAR VIEW ─────────────────────────────────────────────── */}
      {view === 'calendar' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <button
              onClick={() => setCalendarMonth((m) => subMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              aria-label="Previous month"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-gray-900">
              {format(calendarMonth, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              aria-label="Next month"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day-of-week header */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAYS_OF_WEEK.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Grid cells */}
          <div className="grid grid-cols-7">
            {/* Leading empty cells */}
            {Array.from({ length: startOffset }).map((_, i) => (
              <div key={`pre-${i}`} className="min-h-[90px] bg-gray-50/60 border-b border-r border-gray-100" />
            ))}

            {/* Day cells */}
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const dayRequests = requestsByDate[key] ?? []
              const today = isToday(day)

              return (
                <div key={key} className="min-h-[90px] border-b border-r border-gray-100 p-1.5">
                  <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    today ? 'bg-blue-600 text-white' : 'text-gray-400'
                  }`}>
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-0.5">
                    {dayRequests.map((req) => (
                      <button
                        key={req.id}
                        onClick={() => { setSelected(req); setManagerNote(req.manager_note ?? '') }}
                        title={`${req.employee?.name} · ${req.shift?.shift_type} · ${req.shift?.start_time?.slice(0, 5)}–${req.shift?.end_time?.slice(0, 5)}`}
                        className={`w-full text-left text-xs rounded border px-1.5 py-1 leading-tight hover:opacity-75 transition-opacity ${STATUS_CHIP[req.status]}`}
                      >
                        <span className="font-medium block truncate">{req.employee?.name}</span>
                        <span className="text-[10px] opacity-70 capitalize block">
                          {req.shift?.shift_type} · {req.shift?.start_time?.slice(0, 5)}–{req.shift?.end_time?.slice(0, 5)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Trailing empty cells */}
            {Array.from({ length: trailingCells }).map((_, i) => (
              <div key={`post-${i}`} className="min-h-[90px] bg-gray-50/60 border-b border-r border-gray-100" />
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
            {(['pending', 'approved', 'denied'] as const).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded border ${STATUS_CHIP[s]}`} />
                <span className="text-xs text-gray-500 capitalize">{s}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <span className="text-xs text-gray-400 ml-auto">
                No {filter === 'all' ? '' : filter} requests this month
              </span>
            )}
          </div>
        </div>
      )}

      {/* Review modal — shared between list and calendar */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold">Review Request</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-1 text-sm">
              <p><span className="font-medium">Employee:</span> {selected.employee?.name}</p>
              {selected.shift && (
                <>
                  <p><span className="font-medium">Shift:</span> {selected.shift.shift_type} — {format(parseISO(selected.shift.date), 'd MMM yyyy')}</p>
                  <p><span className="font-medium">Time:</span> {selected.shift.start_time.slice(0, 5)} – {selected.shift.end_time.slice(0, 5)}</p>
                  {selected.shift.location && <p><span className="font-medium">Location:</span> {selected.shift.location}</p>}
                </>
              )}
              {selected.employee_note && <p><span className="font-medium">Note:</span> {selected.employee_note}</p>}
            </div>

            {selected.rule_violations && selected.rule_violations.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Scheduling flags:</p>
                <RuleViolationBanner violations={selected.rule_violations as RuleViolation[]} />
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Note to employee <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
                rows={2}
                placeholder="Add a note — will be included in the email notification..."
                className="w-full text-sm rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleReview('approve')}
                disabled={loading}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 rounded-lg text-sm transition-colors"
              >
                {loading ? 'Processing...' : 'Approve'}
              </button>
              <button
                onClick={() => handleReview('deny')}
                disabled={loading}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium py-2 rounded-lg text-sm transition-colors"
              >
                {loading ? 'Processing...' : 'Deny'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
