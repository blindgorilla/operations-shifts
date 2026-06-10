'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, parseISO } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import type { Shift, Employee, RuleViolation } from '@/types'
import ShiftCard from '@/components/shifts/ShiftCard'
import InfoTooltip from '@/components/ui/InfoTooltip'
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
  allEmployees?: { id: string; name: string }[]
  /** When true: calendar shows draft assignments read-only; no request/assign UI */
  draftMode?: boolean
  /** Draft mode only — called when a shift pill is clicked, instead of opening the internal modal */
  onDraftSlotClick?: (shift: Shift) => void
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

function shiftToEvent(shift: Shift, isManager: boolean, isDraft?: boolean): CalEvent {
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
    ? `${isDraft ? '[DRAFT] ' : ''}${shift.shift_type} · ${assignmentCount}/${headcount}`
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
  allEmployees = [],
  draftMode = false,
  onDraftSlotClick,
}: ShiftCalendarClientProps) {
  const router = useRouter()
  const [dashboardTab, setDashboardTab] = useState<'available' | 'schedule'>(
    employee.role === 'employee' ? 'schedule' : 'available'
  )
  const [view, setView] = useState<'list' | 'calendar'>(employee.role === 'manager' ? 'calendar' : 'list')
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [requestedIds, setRequestedIds] = useState(new Set(requestedShiftIds))
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const [pendingViolations, setPendingViolations] = useState<RuleViolation[] | null>(null)
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string>('')
  const [shiftFullMessage, setShiftFullMessage] = useState<boolean>(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const [assigning, setAssigning] = useState(false)
  const [assignOverride, setAssignOverride] = useState(false)

  const events = shifts.map(s => shiftToEvent(s, employee.role === 'manager', draftMode))

  const assignedShifts = shifts.filter(s => assignedShiftIds.includes(s.id))
  const scheduleEvents = assignedShifts.map(s => {
    const [sh, sm] = s.start_time.split(':').map(Number)
    const [eh, em] = s.end_time.split(':').map(Number)
    const start = parseISO(s.date)
    start.setHours(sh, sm)
    const end = parseISO(s.date)
    end.setHours(eh, em)
    if (eh < sh || (eh === sh && em < sm)) end.setDate(end.getDate() + 1)
    const label = `${s.shift_type.charAt(0).toUpperCase() + s.shift_type.slice(1)} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
    return { id: s.id, title: label, start, end, resource: s }
  })

  const scheduleEventStyleGetter = (event: CalEvent) => {
    const color = SHIFT_COLORS[event.resource.shift_type] ?? '#6b7280'
    return { style: { backgroundColor: color, borderRadius: '6px', border: 'none', color: '#fff', fontSize: '12px' } }
  }

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

  const handleAssign = useCallback(async (shiftId: string, employeeId: string, override = false) => {
    setAssigning(true)
    const res = await fetch('/api/shifts/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_id: shiftId, employee_id: employeeId, override }),
    })
    const data = await res.json()
    setAssigning(false)

    if (!res.ok) {
      if (res.status === 422 && data.error === 'shift_full') {
        setAssignOverride(true)
        return
      }
      showToast('error', data.error ?? 'Failed to assign employee')
      return
    }

    showToast('success', 'Employee assigned successfully')
    setSelectedShift(null)
    setSelectedEmployeeId('')
    setAssignOverride(false)
    router.refresh()
  }, [router])

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
      return {
        style: {
          backgroundColor: color,
          borderRadius: '6px',
          border: draftMode ? '2px dashed rgba(255,255,255,0.6)' : 'none',
          opacity: draftMode ? 0.82 : 1,
          color: '#fff',
          fontSize: '12px',
        },
      }
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

  // ---------------------------------------------------------------------------
  // Draft mode calendar helpers
  // ---------------------------------------------------------------------------

  // One synthetic event per calendar day — carries all shifts for that day in
  // resource.shiftsForDay so DraftDayEvent can render them without extra fetches.
  const draftDayEvents = useMemo(() => {
    if (!draftMode) return []
    const byDay: Record<string, Shift[]> = {}
    for (const shift of shifts) {
      if (!byDay[shift.date]) byDay[shift.date] = []
      byDay[shift.date].push(shift)
    }
    const SHIFT_ORDER: Record<string, number> = { morning: 0, evening: 1, night: 2 }
    return Object.entries(byDay).map(([date, dayShifts]) => {
      const start = parseISO(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setHours(23, 59, 0, 0)
      const sorted = [...dayShifts].sort(
        (a, b) => (SHIFT_ORDER[a.shift_type] ?? 9) - (SHIFT_ORDER[b.shift_type] ?? 9)
      )
      return { id: `draft-day-${date}`, title: date, start, end, resource: { shiftsForDay: sorted } as any }
    })
  }, [draftMode, shifts])

  // Make the rbc-event wrapper invisible; the DraftDayEvent content provides all styling.
  const draftEventPropGetter = useCallback(() => ({
    style: { backgroundColor: 'transparent', border: 'none', boxShadow: 'none', padding: 0, margin: '1px 0' } as React.CSSProperties,
  }), [])

  // Compact M/E/N rows rendered inside each day cell in draft mode.
  const DraftDayEvent = useCallback(({ event }: { event: any }) => {
    const shiftsForDay: Shift[] = event?.resource?.shiftsForDay ?? []
    return (
      <div className="flex flex-col gap-0.5 p-0.5">
        {shiftsForDay.map((shift) => {
          const count = (shift as any).assignment_count ?? 0
          const headcount = (shift as any).headcount ?? 1
          const bgColor = count === 0 ? '#ef4444' : count < headcount ? '#f59e0b' : '#16a34a'
          const label = { morning: 'M', evening: 'E', night: 'N' }[shift.shift_type] ?? '?'
          return (
            <div
              key={shift.id}
              onClick={(e) => {
                e.stopPropagation()
                if (onDraftSlotClick) {
                  onDraftSlotClick(shift)
                } else {
                  setSelectedShift(shift)
                  setSelectedEmployeeId('')
                  setAssignOverride(false)
                }
              }}
              style={{ backgroundColor: bgColor }}
              className="flex items-center justify-between text-white text-[10px] font-semibold px-1 py-0.5 rounded cursor-pointer hover:opacity-90 transition-opacity"
            >
              <span>{label}</span>
              <span>{count}/{headcount}</span>
            </div>
          )
        })}
      </div>
    )
  }, [onDraftSlotClick]) // onDraftSlotClick added; setters are stable

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Employee dashboard tab toggle */}
      {employee.role === 'employee' && (
        <div className="flex items-center gap-2 mb-4">
          {(['available', 'schedule'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDashboardTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dashboardTab === tab
                  ? 'bg-[#1B3A5C] text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab === 'available' ? 'Available Shifts' : 'My Schedule'}
            </button>
          ))}
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

      {/* My Schedule view */}
      {employee.role === 'employee' && dashboardTab === 'schedule' && (
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">My Schedule</h2>
            <p className="text-sm text-gray-500 mt-0.5">Your assigned shifts for the month</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Morning</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Evening</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" /> Night</span>
          </div>
          {scheduleEvents.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">No assigned shifts this month</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ height: 600 }}>
              <Calendar
                localizer={localizer}
                events={scheduleEvents}
                defaultView={Views.MONTH}
                style={{ height: '100%' }}
                eventPropGetter={scheduleEventStyleGetter}
                onSelectEvent={(event: CalEvent) => setSelectedShift(event.resource)}
              />
            </div>
          )}
        </div>
      )}

      {/* Available Shifts view (existing UI) */}
      {(employee.role !== 'employee' || dashboardTab === 'available') && (
        <>
      {/* View toggle — hidden in draft mode (calendar only) */}
      <div className="flex items-center gap-2 mb-4">
        {!draftMode && (
          <>
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
          </>
        )}

        <div className={`flex items-center gap-3 text-xs text-gray-500 ${!draftMode ? 'ml-4' : ''}`}>
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

      {(view === 'calendar' || draftMode) ? (
        <div className={`bg-white rounded-xl border border-gray-200 p-4${draftMode ? ' rbc-draft' : ''}`} style={{ height: 600 }}>
          {draftMode && (
            <style>{`
              .rbc-draft .rbc-event {
                height: auto !important;
                overflow: visible !important;
                padding: 0 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                cursor: default !important;
              }
              .rbc-draft .rbc-event-content {
                height: auto !important;
                overflow: visible !important;
              }
              .rbc-draft .rbc-event:focus { outline: none !important; }
              .rbc-draft .rbc-show-more { display: none !important; }
            `}</style>
          )}
          <Calendar
            localizer={localizer}
            events={draftMode ? draftDayEvents : events}
            defaultView={Views.MONTH}
            style={{ height: '100%' }}
            eventPropGetter={draftMode ? draftEventPropGetter : eventStyleGetter}
            components={draftMode ? { event: DraftDayEvent as any } : { event: CustomEvent as any }}
            onSelectEvent={draftMode ? () => {} : (event: CalEvent) => {
              setSelectedShift(event.resource)
              setSelectedEmployeeId('')
              setAssignOverride(false)
            }}
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
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            Weekly Staff Coverage
            <InfoTooltip text="Shows how many shifts each employee has assigned this week. Everyone needs 5 shifts. Use the calendar above to directly assign employees to open shifts." />
          </h2>
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
        </>
      )}

      {/* My Schedule shift detail modal */}
      {selectedShift && employee.role === 'employee' && dashboardTab === 'schedule' && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => setSelectedShift(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-semibold">Shift Details</h2>
              <button onClick={() => setSelectedShift(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-700 w-20">Type</span>
                <span className="capitalize text-gray-900">{selectedShift.shift_type}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-700 w-20">Date</span>
                <span className="text-gray-900">{selectedShift.date}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-700 w-20">Time</span>
                <span className="text-gray-900">{selectedShift.start_time?.slice(0, 5)} – {selectedShift.end_time?.slice(0, 5)}</span>
              </div>
              {selectedShift.location && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700 w-20">Location</span>
                  <span className="text-gray-900">{selectedShift.location}</span>
                </div>
              )}
            </div>
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

      {/* Calendar shift modal — employee */}
      {selectedShift && view === 'calendar' && employee.role !== 'manager' && dashboardTab === 'available' && (
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

      {/* Calendar shift modal — manager assign */}
      {selectedShift && view === 'calendar' && employee.role === 'manager' && (() => {
        const shift = selectedShift as any
        const assignmentCount = shift.assignment_count ?? 0
        const headcount = shift.headcount ?? 1
        const isFull = assignmentCount >= headcount
        const assignedEmployees: string[] = shift.assigned_employees ?? []
        const assignedIds: string[] = shift.assigned_employee_ids ?? []
        const availableEmployees = allEmployees.filter(e => !assignedIds.includes(e.id))
        return (
          <div
            className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4"
            onClick={() => { setSelectedShift(null); setAssignOverride(false); setSelectedEmployeeId('') }}
          >
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-lg font-semibold">Shift Details</h2>
                <button
                  onClick={() => { setSelectedShift(null); setAssignOverride(false); setSelectedEmployeeId('') }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700 w-20">Type</span>
                  <span className="capitalize text-gray-900">{shift.shift_type}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700 w-20">Date</span>
                  <span className="text-gray-900">{shift.date}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700 w-20">Time</span>
                  <span className="text-gray-900">{shift.start_time?.slice(0, 5)} – {shift.end_time?.slice(0, 5)}</span>
                </div>
                {shift.location && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-700 w-20">Location</span>
                    <span className="text-gray-900">{shift.location}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700 w-20">Coverage</span>
                  <span className={`font-medium ${isFull ? 'text-green-700' : assignmentCount === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {assignmentCount}/{headcount} spots filled
                  </span>
                </div>
              </div>

              {assignedEmployees.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Assigned</p>
                  <ul className="space-y-1">
                    {assignedEmployees.map((name, i) => (
                      <li key={i} className="text-sm text-gray-800 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!draftMode && availableEmployees.length > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Assign Employee</p>
                  {assignOverride && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                      This shift is at headcount. Assign anyway?
                    </p>
                  )}
                  <div className="flex gap-2">
                    <select
                      value={selectedEmployeeId}
                      onChange={(e) => setSelectedEmployeeId(e.target.value)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]"
                    >
                      <option value="">Select employee…</option>
                      {availableEmployees.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    <button
                      disabled={!selectedEmployeeId || assigning}
                      onClick={() => handleAssign(shift.id, selectedEmployeeId, assignOverride)}
                      className="px-4 py-2 bg-[#1B3A5C] text-white text-sm font-medium rounded-lg hover:bg-[#16304e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {assigning ? 'Assigning…' : assignOverride ? 'Assign Anyway' : 'Assign'}
                    </button>
                  </div>
                </div>
              )}

              {!draftMode && availableEmployees.length === 0 && (
                <p className="text-sm text-gray-500 border-t border-gray-100 pt-4">All employees are already assigned to this shift.</p>
              )}

              {draftMode && (
                <p className="text-xs text-gray-400 border-t border-gray-100 pt-4 italic">
                  Draft preview — read only. Publish the schedule to lock in assignments.
                </p>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
