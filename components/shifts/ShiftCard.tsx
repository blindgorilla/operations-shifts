'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { Shift, RuleViolation } from '@/types'
import RuleViolationBanner from '@/components/ui/RuleViolationBanner'

interface ShiftCardProps {
  shift: Shift
  violations?: RuleViolation[]
  hasRequested?: boolean
  isAssigned?: boolean
  isFull?: boolean
  onRequest: (shiftId: string, note: string) => Promise<void>
}

const SHIFT_COLORS: Record<string, string> = {
  morning: 'bg-amber-50 border-amber-200 text-amber-800',
  evening: 'bg-blue-50 border-blue-200 text-blue-800',
  night: 'bg-indigo-50 border-indigo-200 text-indigo-800',
}

const SHIFT_ICONS: Record<string, string> = {
  morning: '🌅',
  evening: '🌆',
  night: '🌙',
}

export default function ShiftCard({ shift, violations = [], hasRequested, isAssigned, isFull, onRequest }: ShiftCardProps) {
  const [note, setNote] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

  const hasErrors = violations.some((v) => v.severity === 'error')
  const colorClass = SHIFT_COLORS[shift.shift_type] ?? 'bg-gray-50 border-gray-200'

  async function handleRequest() {
    setLoading(true)
    await onRequest(shift.id, note)
    setLoading(false)
    setExpanded(false)
    setNote('')
  }

  const showFullBadge = isFull && !isAssigned

  return (
    <div className={`border rounded-xl p-4 ${colorClass}${showFullBadge ? ' opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">{SHIFT_ICONS[shift.shift_type]}</span>
            <span className="font-semibold capitalize">{shift.shift_type} Shift</span>
            {isAssigned && (
              <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">Assigned</span>
            )}
            {hasRequested && !isAssigned && (
              <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">Requested</span>
            )}
          </div>
          <p className="text-sm font-medium">{format(parseISO(shift.date), 'EEEE, d MMMM yyyy')}</p>
          <p className="text-sm mt-0.5 opacity-80">
            {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
            {shift.location && ` · ${shift.location}`}
            {shift.role_required && ` · ${shift.role_required}`}
          </p>
          <p className="text-xs mt-1 opacity-60">
            {shift.headcount} spot{shift.headcount !== 1 ? 's' : ''}
            {shift.assignment_count !== undefined && ` · ${shift.assignment_count} filled`}
          </p>
          {shift.notes && <p className="text-xs mt-1 italic opacity-70">{shift.notes}</p>}
        </div>

        {showFullBadge ? (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-gray-200 text-gray-500">Full</span>
        ) : !isAssigned && !hasRequested && !hasErrors ? (
          shift.request_status === 'open' ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 text-sm font-medium bg-white border border-current rounded-lg px-3 py-1.5 hover:bg-white/80 transition-colors"
            >
              Request
            </button>
          ) : shift.request_status === 'reviewing' ? (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-600">Requests closed</span>
          ) : (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-500">Requests not open yet</span>
          )
        ) : null}
      </div>

      {violations.length > 0 && (
        <div className="mt-3">
          <RuleViolationBanner violations={violations} />
        </div>
      )}

      {expanded && !showFullBadge && shift.request_status === 'open' && (
        <div className="mt-3 space-y-2 border-t border-current/10 pt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for your manager (optional)..."
            rows={2}
            className="w-full text-sm rounded-lg border border-current/20 bg-white/70 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-current/30 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRequest}
              disabled={loading}
              className="text-sm font-medium bg-white border border-current rounded-lg px-3 py-1.5 hover:bg-white/80 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Submitting...' : 'Confirm Request'}
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="text-sm text-current/60 hover:text-current px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
