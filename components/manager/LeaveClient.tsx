'use client'

import { useState } from 'react'
import { format, parseISO, isAfter, startOfToday } from 'date-fns'

interface Guard {
  id: string
  name: string
}

interface LeaveEntry {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  type: 'absent' | 'sick'
  note: string | null
  created_at: string
}

interface Props {
  employees: Guard[]
  initialLeave: LeaveEntry[]
}

const TYPE_LABELS: Record<string, string> = {
  absent: 'Absent leave',
  sick: 'Sick leave',
}

const TYPE_BADGE: Record<string, string> = {
  absent: 'bg-amber-100 text-amber-800',
  sick: 'bg-red-100 text-red-800',
}

export default function LeaveClient({ employees, initialLeave }: Props) {
  const [leave, setLeave] = useState<LeaveEntry[]>(initialLeave)
  const [guardId, setGuardId] = useState('')
  const [type, setType] = useState<'absent' | 'sick'>('absent')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const guardMap = Object.fromEntries(employees.map((g) => [g.id, g.name]))

  function showToast(kind: 'success' | 'error', msg: string) {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 3500)
  }

  async function addLeave(e: React.FormEvent) {
    e.preventDefault()
    if (!guardId) { showToast('error', 'Please select a guard'); return }
    setLoading(true)
    const res = await fetch('/api/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: guardId, type, start_date: startDate, end_date: endDate, note }),
    })
    setLoading(false)
    if (!res.ok) {
      const err = await res.json()
      showToast('error', err.error ?? 'Failed to add leave')
      return
    }
    const created: LeaveEntry = await res.json()
    setLeave((prev) => [created, ...prev].sort((a, b) => b.start_date.localeCompare(a.start_date)))
    setGuardId('')
    setType('absent')
    setStartDate('')
    setEndDate('')
    setNote('')
    showToast('success', 'Leave recorded')
  }

  async function deleteLeave(id: string) {
    const res = await fetch(`/api/time-off/${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast('error', 'Failed to delete'); return }
    setLeave((prev) => prev.filter((l) => l.id !== id))
    showToast('success', 'Leave removed')
  }

  const today = startOfToday()
  const upcoming = leave.filter((l) => !isAfter(today, parseISO(l.end_date)))
  const past = leave.filter((l) => isAfter(today, parseISO(l.end_date)))

  function LeaveRow({ entry, onDelete }: { entry: LeaveEntry; onDelete: () => void }) {
    const name = guardMap[entry.employee_id] ?? 'Unknown'
    const start = format(parseISO(entry.start_date), 'd MMM yyyy')
    const end = format(parseISO(entry.end_date), 'd MMM yyyy')
    const sameDay = entry.start_date === entry.end_date
    return (
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-3 font-medium text-gray-900">{name}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[entry.type]}`}>
            {TYPE_LABELS[entry.type]}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700">
          {sameDay ? start : `${start} – ${end}`}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">{entry.note ?? '—'}</td>
        <td className="px-4 py-3 text-right">
          <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700 font-medium">
            Remove
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={addLeave} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Record Leave</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            required
            value={guardId}
            onChange={(e) => setGuardId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select guard…</option>
            {employees.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'absent' | 'sick')}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="absent">Absent leave</option>
            <option value="sick">Sick leave</option>
          </select>

          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-10 shrink-0">From</label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                if (endDate && e.target.value > endDate) setEndDate(e.target.value)
              }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-10 shrink-0">To</label>
            <input
              type="date"
              required
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            {loading ? 'Saving…' : 'Add Leave'}
          </button>
        </div>
      </form>

      {/* Current / upcoming */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Current &amp; Upcoming Leave</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {upcoming.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">No current or upcoming leave</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Guard</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Dates</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Note</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {upcoming.map((entry) => (
                  <LeaveRow key={entry.id} entry={entry} onDelete={() => deleteLeave(entry.id)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Past */}
      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-2">Past Leave</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden opacity-75">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Guard</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Dates</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Note</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {past.map((entry) => (
                  <LeaveRow key={entry.id} entry={entry} onDelete={() => deleteLeave(entry.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
