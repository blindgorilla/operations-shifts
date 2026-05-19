'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import type { Shift } from '@/types'
import { useRouter } from 'next/navigation'

interface Props { shifts: Shift[] }

const SHIFT_BADGE: Record<string, string> = {
  morning: 'bg-amber-100 text-amber-800',
  evening: 'bg-blue-100 text-blue-800',
  night: 'bg-indigo-100 text-indigo-800',
}

function deriveWindowStatus(shifts: Shift[]): 'open' | 'reviewing' | 'closed' | 'mixed' {
  const published = shifts.filter((s) => s.is_published)
  if (published.length === 0) return 'closed'
  const statuses = new Set(published.map((s) => s.request_status))
  if (statuses.size === 1) return [...statuses][0] as 'open' | 'reviewing' | 'closed'
  return 'mixed'
}

export default function ManagerShiftsClient({ shifts: initial }: Props) {
  const [shifts, setShifts] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const router = useRouter()

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  async function setRequestStatus(status: 'open' | 'reviewing') {
    const confirmMsg =
      status === 'open'
        ? 'This will open all published shifts for employee requests. Continue?'
        : 'This will close the request window. Employees will no longer be able to request shifts. Continue?'
    if (!confirm(confirmMsg)) return

    setActionLoading(true)
    try {
      const res = await fetch('/api/shifts/request-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        showToast('error', error ?? 'Failed to update request status')
      } else {
        setShifts((prev) =>
          prev.map((s) => (s.is_published ? { ...s, request_status: status } : s))
        )
        showToast('success', status === 'open' ? 'Request window opened' : 'Request window closed')
      }
    } catch {
      showToast('error', 'Network error')
    }
    setActionLoading(false)
  }

  async function togglePublish(shift: Shift) {
    setLoading(shift.id)
    const supabase = createClient()
    const { error } = await supabase
      .from('shifts')
      .update({ is_published: !shift.is_published })
      .eq('id', shift.id)

    if (error) {
      showToast('error', error.message)
    } else {
      setShifts((prev) => prev.map((s) => s.id === shift.id ? { ...s, is_published: !s.is_published } : s))
      showToast('success', `Shift ${!shift.is_published ? 'published' : 'unpublished'}`)
    }
    setLoading(null)
  }

  async function deleteShift(shiftId: string) {
    if (!confirm('Delete this shift? All requests for it will also be removed.')) return
    setLoading(shiftId)
    const supabase = createClient()
    const { error } = await supabase.from('shifts').delete().eq('id', shiftId)

    if (error) {
      showToast('error', error.message)
    } else {
      setShifts((prev) => prev.filter((s) => s.id !== shiftId))
      showToast('success', 'Shift deleted')
    }
    setLoading(null)
  }

  if (shifts.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-sm">No shifts yet. Create your first shift.</p>
      </div>
    )
  }

  const windowStatus = deriveWindowStatus(shifts)
  const hasPublished = shifts.some((s) => s.is_published)
  const hasOpen = shifts.some((s) => s.request_status === 'open')
  const hasNonOpen = shifts.some((s) => s.is_published && s.request_status !== 'open')

  const statusLabel =
    windowStatus === 'open'
      ? 'Request window: Open ✅'
      : windowStatus === 'reviewing'
      ? 'Request window: Under review 🟡'
      : windowStatus === 'closed'
      ? 'Request window: Closed 🔴'
      : 'Request window: Mixed 🟡'

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {hasPublished && (
        <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4">
          <span className="text-sm font-medium text-gray-700">{statusLabel}</span>
          <div className="flex gap-2">
            {hasNonOpen && (
              <button
                onClick={() => setRequestStatus('open')}
                disabled={actionLoading}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
              >
                Open Requests
              </button>
            )}
            {hasOpen && (
              <button
                onClick={() => setRequestStatus('reviewing')}
                disabled={actionLoading}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
              >
                Close Requests
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Spots</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shifts.map((shift) => (
              <tr key={shift.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">
                  {format(parseISO(shift.date), 'EEE, d MMM yyyy')}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${SHIFT_BADGE[shift.shift_type]}`}>
                    {shift.shift_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                </td>
                <td className="px-4 py-3 text-gray-600">{shift.location ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">
                  {shift.assignment_count ?? 0}/{shift.headcount}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${shift.is_published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {shift.is_published ? 'Published' : 'Draft'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => togglePublish(shift)}
                      disabled={loading === shift.id}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                    >
                      {shift.is_published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      onClick={() => deleteShift(shift.id)}
                      disabled={loading === shift.id}
                      className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
