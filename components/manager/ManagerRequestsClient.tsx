'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
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

const FILTER_OPTIONS = ['all', 'pending', 'approved', 'denied'] as const

export default function ManagerRequestsClient({ requests: initial }: Props) {
  const [requests, setRequests] = useState(initial)
  const [filter, setFilter] = useState<typeof FILTER_OPTIONS[number]>('pending')
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

    console.log('[DEBUG] selected:', JSON.stringify({ id: selected.id, shift_id: selected.shift_id, employee_id: selected.employee_id, shift_nested_id: selected.shift?.id }))
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

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {f} {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1 bg-amber-100 text-amber-800 text-xs font-semibold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

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

      {/* Review modal */}
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
