'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import type { ShiftRequest } from '@/types'

interface Props {
  initialCount: number
}

export default function NotificationDropdown({ initialCount }: Props) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [requests, setRequests] = useState<ShiftRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Sync count when prop changes (server refresh)
  useEffect(() => {
    setCount(initialCount)
  }, [initialCount])

  // Poll count every 30s
  useEffect(() => {
    async function fetchCount() {
      try {
        const res = await fetch('/api/pending-count', { credentials: 'include' })
        const data = await res.json()
        setCount(data.count ?? 0)
      } catch {}
    }
    const interval = setInterval(fetchCount, 30000)
    return () => clearInterval(interval)
  }, [])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleOpen() {
    if (!open) {
      setOpen(true)
      setLoading(true)
      try {
        const res = await fetch('/api/pending-requests', { credentials: 'include' })
        const data = await res.json()
        setRequests(data.requests ?? [])
      } catch {}
      setLoading(false)
    } else {
      setOpen(false)
    }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleAction(requestId: string, action: 'approve' | 'deny') {
    setActionLoading(requestId + action)
    const res = await fetch(`/api/shift-requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setActionLoading(null)
    if (res.ok) {
      setRequests(prev => prev.filter(r => r.id !== requestId))
      setCount(prev => Math.max(0, prev - 1))
      showToast(action === 'approve' ? 'Request approved' : 'Request denied')
    }
  }

  return (
    <div className="relative" ref={ref}>
      {toast && (
        <div className="fixed top-4 right-4 z-[100] px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white bg-green-600">
          {toast}
        </div>
      )}

      <button
        onClick={handleOpen}
        className="relative text-gray-500 hover:text-gray-900 p-1 rounded-md hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 text-xs font-bold text-white bg-red-500 rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Pending Requests</h3>
            {count > 0 && (
              <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                {count} pending
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
            )}

            {!loading && requests.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">
                No pending requests
              </div>
            )}

            {!loading && requests.map((req) => (
              <div key={req.id} className="px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{req.employee?.name}</p>
                    {req.shift && (
                      <p className="text-xs text-gray-500 mt-0.5 capitalize">
                        {req.shift.shift_type} shift · {format(parseISO(req.shift.date), 'EEE d MMM')} · {req.shift.start_time.slice(0, 5)}–{req.shift.end_time.slice(0, 5)}
                        {req.shift.location && ` · ${req.shift.location}`}
                      </p>
                    )}
                    {req.employee_note && (
                      <p className="text-xs text-gray-400 mt-0.5 italic truncate">"{req.employee_note}"</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => handleAction(req.id, 'approve')}
                      disabled={actionLoading !== null}
                      className="text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md transition-colors"
                    >
                      {actionLoading === req.id + 'approve' ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleAction(req.id, 'deny')}
                      disabled={actionLoading !== null}
                      className="text-xs font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md transition-colors"
                    >
                      {actionLoading === req.id + 'deny' ? '...' : 'Deny'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
            <Link
              href="/manager/requests"
              onClick={() => setOpen(false)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View all requests →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
