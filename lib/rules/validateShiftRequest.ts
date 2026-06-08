import { parseISO, getDay } from 'date-fns'
import type { Employee, Shift, ShiftAssignment, RuleViolation, SchedulingRule } from '@/types'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  getShiftStartDatetime,
  getShiftEndDatetime,
  checkHeadcount,
  checkMinRest,
  checkNightFollowup,
  checkConsecutiveNightsRest,
  checkNewEmployeePairing,
  checkConsecutiveDays,
  checkNightRestPreference,
  checkFairnessInfo,
} from './constraints'

interface ValidationInput {
  employee: Employee
  requestedShift: Shift
  existingAssignments: (ShiftAssignment & { shift: Shift })[]
  allAssignmentsOnShift: (ShiftAssignment & { employee: Employee })[]
  publicHolidays: string[] // ISO date strings
  employeeWeeklyStats: { weekStart: string; daysWorked: number }[]
}

export async function validateShiftRequest(input: ValidationInput): Promise<RuleViolation[]> {
  const violations: RuleViolation[] = []
  const { employee, requestedShift, existingAssignments, allAssignmentsOnShift, publicHolidays } =
    input

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: rules, error } = await admin
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
  const dayOfWeek = getDay(requestedDate)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const isHoliday = publicHolidays.includes(requestedShift.date)
  const isFriday = dayOfWeek === 5
  const isSaturday = dayOfWeek === 6

  for (const rule of rules as SchedulingRule[]) {
    try {
      switch (rule.name) {
        case 'headcount': {
          const v = checkHeadcount(rule, allAssignmentsOnShift.length, requestedShift.headcount)
          if (v) violations.push(v)
          break
        }

        case 'min_rest': {
          violations.push(...checkMinRest(rule, existingAssignments, requestedStart, requestedEnd))
          break
        }

        case 'night_followup': {
          const vFollowup = checkNightFollowup(rule, existingAssignments, requestedShift)
          if (vFollowup) violations.push(vFollowup)
          const vConsec = checkConsecutiveNightsRest(rule, existingAssignments, requestedDate)
          if (vConsec) violations.push(vConsec)
          break
        }

        case 'new_employee_pairing': {
          const v = checkNewEmployeePairing(
            rule,
            employee,
            allAssignmentsOnShift,
            isFriday,
            isSaturday,
          )
          if (v) violations.push(v)
          break
        }

        case 'consecutive_days': {
          const v = checkConsecutiveDays(rule, employee, existingAssignments, requestedDate)
          if (v) violations.push(v)
          break
        }

        case 'night_rest_preference': {
          const v = checkNightRestPreference(rule, existingAssignments, requestedDate)
          if (v) violations.push(v)
          break
        }

        case 'fairness_info': {
          const v = checkFairnessInfo(rule, isWeekend, isHoliday)
          if (v) violations.push(v)
          break
        }
      }
    } catch (err) {
      console.error(`Error applying rule ${rule.name}:`, err)
    }
  }

  return violations
}

export function hasBlockingViolations(violations: RuleViolation[]): boolean {
  return violations.some((v) => v.severity === 'error')
}
