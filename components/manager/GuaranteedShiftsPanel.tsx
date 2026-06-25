'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, parseISO, endOfMonth } from 'date-fns'

interface PinnedAssignment {
  id: string
  employee_id: string
  date: string
  shift_type: string
  note: string | null
}

interface Props {
  month: string
  employees: { id: string; name: string }[]
}

const SHIFT_LABEL: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  night: 'Night',
}

function monthBounds(month: string) {
  const min = `${month}-01`
  const max = format(endOfMonth(parseISO(min)), 'yyyy-MM-dd')
  return { min, max }
}

export default function GuaranteedShiftsPanel({ month, employees }: Props) {
  const [pins, setPins] = useState<PinnedAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [pinWarnings, setPinWarnings] = useState<Record<string, string[]>>({})

  const { min: monthMin, max: monthMax } = useMemo(() => monthBounds(month), [month])

  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [date, setDate] = useState(monthMin)
  const [shiftType, setShiftType] = useState('morning')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formWarnings, setFormWarnings] = useState<string[]>([])

  const employeeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of employees) map[e.id] = e.name
    return map
  }, [employees])

  const fetchPins = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pinned-assignments?month=${month}`)
      if (!res.ok) return
      const data = await res.json()
      setPins(data.pins ?? [])
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    setDate(monthBounds(month).min)
    fetchPins()
  }, [month, fetchPins])

  useEffect(() => {
    if (!employeeId && employees.length > 0) setEmployeeId(employees[0].id)
  }, [employees, employeeId])

  async function handleAdd() {
    if (!employeeId || !date || !shiftType) return
    setSubmitting(true)
    setFormError(null)
    setFormWarnings([])
    try {
      const res = await fetch('/api/pinned-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, date, shift_type: shiftType, note: note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error ?? 'Failed to add pin')
        return
      }
      if (data.warnings?.length) {
        setFormWarnings(data.warnings)
        setPinWarnings(prev => ({ ...prev, [data.pin.id]: data.warnings }))
      }
      setNote('')
      await fetchPins()
    } catch {
      setFormError('Network error -- please try again')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(id: string) {
    await fetch(`/api/pinned-assignments/${id}`, { method: 'DELETE' })
    setPinWarnings(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    await fetchPins()
  }

  const displayMonth = (() => {
    try { return format(parseISO(`${month}-01`), 'MMMM yyyy') } catch { return month }
  })()

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Guaranteed Shifts</p>
        <p className="text-xs text-gray-400">
          Guaranteed guards are locked into these slots before generation and override scheduling rules. Generate (or regenerate) to apply.
        </p>
      </div>

      {/* Add form */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Guard</label>
          <select
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
          >
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date</label>
          <input
            type="date"
            value={date}
            min={monthMin}
            max={monthMax}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Shift</label>
          <select
            value={shiftType}
            onChange={e => setShiftType(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
          >
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={submitting || !employeeId}
          className="bg-[#1B3A5C] hover:bg-[#2a4a6b] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          {submitting ? 'Adding...' : 'Add'}
        </button>
      </div>

      {formError && <p className="text-sm text-red-600">{formError}</p>}
      {formWarnings.length > 0 && (
        <div className="space-y-1">
          {formWarnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      <div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : pins.length === 0 ? (
          <p className="text-sm text-gray-400">No guaranteed shifts for {displayMonth}.</p>
        ) : (
          <div className="divide-y divide-gray-50 border-t border-gray-100">
            {pins.map(pin => {
              const name = employeeMap[pin.employee_id] ?? pin.employee_id
              let dateLabel = pin.date
              try { dateLabel = format(parseISO(pin.date), 'EEE, MMM d') } catch { /* ignore */ }
              const hasWarning = (pinWarnings[pin.id]?.length ?? 0) > 0
              return (
                <div key={pin.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="font-medium text-gray-800 min-w-[100px] truncate">{name}</span>
                  <span className="text-gray-500 min-w-[110px]">{dateLabel}</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {SHIFT_LABEL[pin.shift_type] ?? pin.shift_type}
                  </span>
                  {pin.note && <span className="text-gray-400 italic truncate flex-1">{pin.note}</span>}
                  {hasWarning && (
                    <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  )}
                  <button
                    onClick={() => handleRemove(pin.id)}
                    className="ml-auto text-gray-400 hover:text-red-600 transition-colors shrink-0"
                    aria-label="Remove pin"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
