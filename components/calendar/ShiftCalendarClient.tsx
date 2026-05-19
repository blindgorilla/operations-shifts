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
  weeklyAssignedCount?: number
  weeklyRequired?: number
  employeeCoverage?: { id: string; name: string; assigned: number; required: number }[]
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

function shiftToEvent(shift: Shift, isManager: boolean): CalEvent {
  const assignmentCount = (shift as any).assignment_count ?? 0
  const headcount = (shift as any).headcount ?? 1
  const [sh, sm] = shift.start_time.split(':').map(Number)
  const [eh, em] = shift.end_time.split(':').map(Number)
  const start = parseISO(shift.date)
  start.setHours(sh, sm)
  const end = parseISO(shift.date)
  end.setHours(eh, em)
  if (eh < sh || (eh === sh && em < sm)) end.setDate(end.getDate() + 1)
  const isFull = assignmentCount >= headcount
  const baseTitle = isManager
    ? `${shift.shift_type} · ${assignmentCount}/${headcount}`
    : `${shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} ${shift.start_time.slice(0, 5)}`
  const title = (!isManager && isFull) ? `${baseTitle} · Full` : baseTitle
  return { id: shift.id, title, start, end, resource: shift }
}

export default function ShiftCalendarClient({
  shifts,
  employee,
  requestedShiftIds,
  assignedShiftIds,
  weeklyAssignedCount,
  weeklyRequired = 5,
  employeeCoverage,
}: ShiftCalendarClientProps) {
  const [view, setView] = useState<'list' | 'calendar'>(employee.role === 'manager' ? 'calendar' : 'list')
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [requestedIds, setRequestedIds] = useState(new Set(requestedShiftIds))
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const [pendingViolations, setPendingViolations] = useState<RuleViolation[] | null>(null)
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string>('')
  const [shiftFullMessage, setShiftFullMessage] = useState<boolean>(false)

  const events = shifts.map(s => shiftToEvent(s, employee.role === 'manager'))

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  const handleRequest = useCallback(async (shiftId: string, note: string, confirmViolations?: boolean) => {
    const res = await fetch('/api/shift-requests/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_id: shiftId,
        employee_note: note,
        ...(confirmViolations ? { confirm_violations: true } : {}),
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      if (res.status === 422 && data.error === 'shift_full') {
        setShiftFullMessage(true)
      } else {
        showToast('error', data.error ?? 'Failed to submit request')
      }
      return
    }

    if (data.needs_confirmation) {
      setPendingViolations(data.violations ?? [])
      setPendingShiftId(shiftId)
      setPendingNote(note)
      return
    }

    setRequestedIds((prev) => new Set([...prev, shiftId]))
    setViolations(data.violations ?? [])
    showToast('success', 'Shift request submitted successfully')
    setSelectedShift(null)
  }, [])

  const CustomEvent = useCallback(({ event }: { event: CalEvent }) => {
    const employees = (event.resource as any).assigned_employees ?? []
    const tooltipText = employees.length > 0
      ? `Assigned: ${employees.join(', ')}`
      : 'No one assigned yet'
    return (
      <div title={employee.role === 'manager' ? tooltipText : undefined} className="w-full h-full px-1 text-xs leading-tight overflow-hidden">
        {event.title}
      </div>
    )
  }, [employee.role])

  const eventStyleGetter = useCallback((event: CalEvent) => {
    if (employee.role === 'manager') {
      const count = (event.resource as any).assignment_count ?? 0
      const total = (event.resource as any).headcount ?? 1
      const color = count === 0 ? '#ef4444' : count < total ? '#f59e0b' : '#16a34a'
      return { style: { backgroundColor: color, borderRadius: '6px', border: 'none', color: '#fff', fontSize: '12px' } }
    }
    const color = SHIFT_COLORS[event.resource.shift_type] ?? '#6b7280'
    const isAssigned = assignedShiftIds.includes(event.id)
    const isRequested = requestedIds.has(event.id)
    const assignmentCount = (event.resource as any).assignment_count ?? 0
    const headcount = (event.resource as any).headcount ?? 1
    const isFull = assignmentCount >= headcount
    const bgColor = isAssigned ? '#16a34a' : isRequested ? '#7c3aed' : (isFull ? '#9ca3af' : color)
    return { style: { backgroundColor: bgColor, borderRadius: '6px', border: 'none', color: '#fff', fontSize: '12px' } }
  }, [employee.role, assignedShiftIds, requestedIds])

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Employee weekly shift banner */}
      {employee.role === 'employee' && weeklyAssignedCount !== undefined && (
        <div className={`mb-6 p-4 rounded-lg border ${weeklyAssignedCount >= weeklyRequired ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <p className={`text-sm font-medium ${weeklyAssignedCount >= weeklyRequired ? 'text-green-700' : 'text-amber-700'}`}>
            You have {weeklyAssignedCount}/{weeklyRequired} shifts assigned this week
            {weeklyAssignedCount < weeklyRequired && ` — you still need ${weeklyRequired - weeklyAssignedCount} more`}
          </p>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setView('list')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'list' ? 'bg-[#1B3A5C] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          List
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'calendar' ? 'bg-[#1B3A5C] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          Calendar
        </button>

        <div className="ml-4 flex items-center gap-3 text-xs text-gray-500">
          {employee.role === 'manager' ? (
            <>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Empty</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Partial</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> Fully staffed</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Morning</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Evening</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" /> Night</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> Assigned</span>
            </>
          )}
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
            components={{ event: CustomEvent as any }}
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
              isFull={((shift as any).assignment_count ?? 0) >= ((shift as any).headcount ?? 1)}
              onRequest={handleRequest}
            />
          ))}
        </div>
      )}

      {/* Manager weekly staff coverage */}
      {employee.role === 'manager' && employeeCoverage && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Weekly Staff Coverage</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {employeeCoverage.map(emp => (
              <div key={emp.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-900">{emp.name}</span>
                <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${emp.assigned >= emp.required ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {emp.assigned}/{emp.required} shifts
                  {emp.assigned < emp.required && ' ⚠'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shift full modal */}
      {shiftFullMessage && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold mb-3">This shift is full</h2>
            <p className="text-sm text-gray-600 mb-6">All spots for this shift have been filled. Check back later or speak to your manager.</p>
            <button
              onClick={() => setShiftFullMessage(false)}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg text-sm transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Violation confirmation modal */}
      {pendingViolations && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setPendingViolations(null); setPendingShiftId(null); setPendingNote('') }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-3">Heads up — scheduling notice</h2>
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
              {pendingViolations.map((v, i) => (
                <p key={i} className="text-sm text-red-700">{v.message}</p>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setPendingViolations(null); setPendingShiftId(null); setPendingNote('') }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const shiftId = pendingShiftId
                  const note = pendingNote
                  setPendingViolations(null)
                  setPendingShiftId(null)
                  setPendingNote('')
                  if (shiftId !== null) await handleRequest(shiftId, note, true)
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
              isFull={((selectedShift as any).assignment_count ?? 0) >= ((selectedShift as any).headcount ?? 1)}
              onRequest={handleRequest}
            />
          </div>
        </div>
      )}
    </div>
  )
}
