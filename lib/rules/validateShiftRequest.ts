import { differenceInHours, parseISO, format, getDay, addDays } from 'date-fns'
import type { Employee, Shift, ShiftAssignment, RuleViolation, SchedulingRule } from '@/types'
import { createClient } from '@/lib/supabase/server'

interface ValidationInput {
  employee: Employee
  requestedShift: Shift
  existingAssignments: (ShiftAssignment & { shift: Shift })[]
  allAssignmentsOnShift: (ShiftAssignment & { employee: Employee })[]
  publicHolidays: string[] // ISO date strings
  employeeWeeklyStats: { weekStart: string; daysWorked: number }[]
}

const SHIFT_TIMES: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 14 },
  evening: { start: 14, end: 22 },
  night: { start: 22, end: 6 }, // crosses midnight
}

function shiftStartHour(shiftType: string): number {
  return SHIFT_TIMES[shiftType]?.start ?? 0
}

function shiftEndHour(shiftType: string): number {
  return SHIFT_TIMES[shiftType]?.end ?? 8
}

function getShiftStartDatetime(shift: Shift): Date {
  const [h, m] = shift.start_time.split(':').map(Number)
  const d = parseISO(shift.date)
  d.setHours(h, m, 0, 0)
  return d
}

function getShiftEndDatetime(shift: Shift): Date {
  const [h, m] = shift.end_time.split(':').map(Number)
  const d = parseISO(shift.date)
  d.setHours(h, m, 0, 0)
  // Night shifts end the next day
  if (shift.shift_type === 'night' && h < 12) {
    d.setDate(d.getDate() + 1)
  }
  return d
}

export async function validateShiftRequest(input: ValidationInput): Promise<RuleViolation[]> {
  const violations: RuleViolation[] = []
  const { employee, requestedShift, existingAssignments, allAssignmentsOnShift, publicHolidays } = input

  // Fetch enabled rules from database
  const supabase = await createClient()
  const { data: rules, error } = await supabase
    .from('scheduling_rules')
    .select('*')
    .eq('is_enabled', true)

  if (error) {
    console.error('Error fetching rules:', error)
    return violations
  }

  const requestedStart = getShiftStartDatetime(requestedShift)
  const requestedEnd = getShiftEndDatetime(requestedShift)
  const requestedDate = parseISO(requestedShift.date)
  const dayOfWeek = getDay(requestedDate) // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const isHoliday = publicHolidays.includes(requestedShift.date)
  const isFriday = dayOfWeek === 5
  const isSaturday = dayOfWeek === 6

  // Apply each enabled rule
  for (const rule of rules) {
    try {
      switch (rule.name) {
        case 'headcount':
          if (allAssignmentsOnShift.length >= requestedShift.headcount) {
            violations.push({
              rule: rule.name,
              severity: rule.severity,
              message: `This shift is fully booked (${allAssignmentsOnShift.length}/${requestedShift.headcount} spots filled).`,
            })
          }
          break

        case 'min_rest':
          const minRestHours = rule.parameters?.min_rest_hours || 12
          for (const assignment of existingAssignments) {
            const assignedEnd = getShiftEndDatetime(assignment.shift)
            const assignedStart = getShiftStartDatetime(assignment.shift)

            // Gap between end of previous shift and start of requested
            const restAfter = differenceInHours(requestedStart, assignedEnd)
            // Gap between end of requested shift and start of next shift
            const restBefore = differenceInHours(assignedStart, requestedEnd)

            if (restAfter >= 0 && restAfter < minRestHours) {
              violations.push({
                rule: rule.name,
                severity: rule.severity,
                message: `Less than ${minRestHours} hours rest between your ${assignment.shift.shift_type} shift on ${format(parseISO(assignment.shift.date), 'dd MMM')} and this shift (${restAfter}h gap).`,
              })
            }

            if (restBefore >= 0 && restBefore < minRestHours) {
              violations.push({
                rule: rule.name,
                severity: rule.severity,
                message: `Less than ${minRestHours} hours rest between this shift and your ${assignment.shift.shift_type} shift on ${format(parseISO(assignment.shift.date), 'dd MMM')} (${restBefore}h gap).`,
              })
            }
          }
          break

        case 'night_followup':
          const prevNight = existingAssignments.find((a) => {
            if (a.shift.shift_type !== 'night') return false
            const nightDate = parseISO(a.shift.date)
            const dayAfterNight = addDays(nightDate, 1)
            return format(dayAfterNight, 'yyyy-MM-dd') === requestedShift.date
          })

          if (prevNight && (requestedShift.shift_type === 'morning' || requestedShift.shift_type === 'evening')) {
            violations.push({
              rule: rule.name,
              severity: rule.severity,
              message: `You worked a night shift on ${format(parseISO(prevNight.shift.date), 'dd MMM')}. Morning and evening shifts are not allowed the following day.`,
            })
          }
          break

        case 'new_employee_pairing':
          if (employee.is_new_employee) {
            const otherNewEmployees = allAssignmentsOnShift.filter(
              (a) => a.employee.is_new_employee && a.employee_id !== employee.id
            )

            if (otherNewEmployees.length > 0) {
              const names = otherNewEmployees.map((a) => a.employee.name).join(', ')
              const severity = isFriday || isSaturday ? 'error' : rule.severity
              violations.push({
                rule: rule.name,
                severity,
                message: `New employee(s) already on this shift: ${names}. ${isFriday || isSaturday ? 'Friday & Saturday pairings of new employees are not permitted.' : 'Avoid pairing new employees on the same shift.'}`,
              })
            }
          }
          break

        case 'consecutive_days':
          const DAYS_BEFORE = 4
          const consecutiveBefore = []
          for (let i = 1; i <= DAYS_BEFORE; i++) {
            const checkDate = format(addDays(requestedDate, -i), 'yyyy-MM-dd')
            const worked = existingAssignments.some((a) => a.shift.date === checkDate)
            if (worked) consecutiveBefore.push(checkDate)
            else break
          }

          if (consecutiveBefore.length >= employee.weekly_days) {
            violations.push({
              rule: rule.name,
              severity: rule.severity,
              message: `You have worked ${consecutiveBefore.length} consecutive days leading up to this shift. Check weekly rest allocation.`,
            })
          }
          break

        case 'night_rest_preference':
          const restDaysAfterNight = rule.parameters?.rest_days_after_night || 2
          const prevNightForRest = existingAssignments.find((a) => {
            if (a.shift.shift_type !== 'night') return false
            const nightDate = parseISO(a.shift.date)
            const restPeriodEnd = addDays(nightDate, restDaysAfterNight)
            return requestedDate <= restPeriodEnd && requestedDate > nightDate
          })

          if (prevNightForRest) {
            violations.push({
              rule: rule.name,
              severity: rule.severity,
              message: `It is recommended to have ${restDaysAfterNight} consecutive days off after a night shift (night on ${format(parseISO(prevNightForRest.shift.date), 'dd MMM')}). Manager may adjust if needed.`,
            })
          }
          break

        case 'fairness_info':
          if (isWeekend || isHoliday) {
            violations.push({
              rule: rule.name,
              severity: rule.severity,
              message: `This is a ${isHoliday ? 'public holiday' : 'weekend'} shift. Weekend and holiday shifts are rotated fairly — manager will review allocation.`,
            })
          }
          break
      }
    } catch (error) {
      console.error(`Error applying rule ${rule.name}:`, error)
    }
  }

  return violations
}

export function hasBlockingViolations(violations: RuleViolation[]): boolean {
  return violations.some((v) => v.severity === 'error')
}
