'use client'

import { useState, useCallback } from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, parseISO } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import type { Shift, Employee, RuleViolation } from '@/types'
import ShiftCard from '@/components/shifts/ShiftCard'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { 'en-US': enUS },
})

interface ShiftCalendarClientProps {
  shifts: Shift[]
  employee: Employee
  requestedShiftIds: string[]
  assignedShiftIds: string[]
}

const SHIFT_COLORS: Record<string, string> = {
  morning: '#f59e0b',
  evening: '#3b82f6',
  night: '#6366f1',
}

interface CalEvent {
  id: string
  title: string
  start: Date
  end: Date
  resource: Shift
}

function shiftToEvent(shift: Shift): CalEvent {
  const [sh, sm] = shift.start_time.split(':').map(Number)
  const [eh, em] = shift.end_time.split(':').map(Number)
  const start = parseISO(shift.date)
  start.setHours(sh, sm)
  const end = parseISO(shift.date)
  end.setHours(eh, em)
  if (shift.shift_type === 'night' && eh < 12) end.setDate(end.getDate() + 1)

  return {
    id: shift.id,
    title: `${shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} ${shift.start_time.slice(0, 5)}`,
    start,
    end,
    resource: shift,
  }
}

export default function ShiftCalendarClient({
  shifts,
  employee,
  requestedShiftIds,
  assignedShiftIds,
}: ShiftCalendarClientProps) {
  const [view, setView] = useState<'calendar' | 'list'>('list')
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [requestedIds, setRequestedIds] = useState(new Set(requestedShiftIds))
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const [pendingViolations, setPendingViolations] = useState<RuleViolation[] | null>(null)
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null)

  const events = shifts.map(shiftToEvent)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  const handleRequest = useCallback(async (shiftId: string, note: string) => {
    const res = await fetch('/api/shift-requests/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_id: shiftId, employee_note: note }),
    })

    const data = await res.json()

    if (!res.ok) {
      showToast('error', data.error ?? 'Failed to submit request')
      return
    }

    const responseViolations: RuleViolation[] = data.violations ?? []
    const hasErrorViolations = responseViolations.some((v) => v.severity === 'error')

    if (hasErrorViolations) {
      setPendingViolations(responseViolations)
      setPendingShiftId(shiftId)
      return
    }

    setRequestedIds((prev) => new Set([...prev, shiftId]))
    setViolations(responseViolations)
    showToast('success', 'Shift request submitted successfully')
    setSelectedShift(null)
  }, [])

  const eventStyleGetter = useCallback((event: CalEvent) => {
    const color = SHIFT_COLORS[event.resource.shift_type] ?? '#6b7280'
    const isAssigned = assignedShiftIds.includes(event.id)
    const isRequested = requestedIds.has(event.id)
    return {
      style: {
        backgroundColor: isAssigned ? '#16a34a' : isRequested ? '#7c3aed' : color,
        borderRadius: '6px',
        border: 'none',
        color: '#fff',
        fontSize: '12px',
      },
    }
  }, [assignedShiftIds, requestedIds])

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setView('list')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          List
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'calendar' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          Calendar
        </button>

        <div className="ml-4 flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Morning</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Evening</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" /> Night</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> Assigned</span>
        </div>
      </div>

      {view === 'calendar' ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ height: 600 }}>
          <Calendar
            localizer={localizer}
            events={events}
            defaultView={Views.MONTH}
            style={{ height: '100%' }}
            eventPropGetter={eventStyleGetter}
            onSelectEvent={(event: CalEvent) => setSelectedShift(event.resource)}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {shifts.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">No upcoming shifts available</p>
            </div>
          )}
          {shifts.map((shift) => (
            <ShiftCard
              key={shift.id}
              shift={shift}
              violations={selectedShift?.id === shift.id ? violations : []}
              hasRequested={requestedIds.has(shift.id)}
              isAssigned={assignedShiftIds.includes(shift.id)}
              onRequest={handleRequest}
            />
          ))}
        </div>
      )}

      {/* Violation confirmation modal */}
      {pendingViolations && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setPendingViolations(null); setPendingShiftId(null) }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-3">Scheduling Violations Detected</h2>
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
              {pendingViolations.map((v, i) => (
                <p key={i} className="text-sm text-red-700">{v.message}</p>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setPendingViolations(null); setPendingShiftId(null) }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (pendingShiftId) setRequestedIds((prev) => new Set([...prev, pendingShiftId]))
                  setViolations(pendingViolations)
                  showToast('success', 'Shift request submitted successfully')
                  setPendingViolations(null)
                  setPendingShiftId(null)
                  setSelectedShift(null)
                }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Request Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar shift modal */}
      {selectedShift && view === 'calendar' && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => { setSelectedShift(null); setViolations([]) }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold">Shift Details</h2>
              <button onClick={() => { setSelectedShift(null); setViolations([]) }} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ShiftCard
              shift={selectedShift}
              violations={violations}
              hasRequested={requestedIds.has(selectedShift.id)}
              isAssigned={assignedShiftIds.includes(selectedShift.id)}
              onRequest={handleRequest}
            />
          </div>
        </div>
      )}
    </div>
  )
}
