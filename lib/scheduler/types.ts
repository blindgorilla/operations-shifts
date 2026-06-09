import type { Employee, ShiftType, SchedulingRule } from '@/types'

export type DayType = 'weekday' | 'friday' | 'weekend' | 'holiday'

export interface CoverageRequirement {
  shift_type: ShiftType
  day_type: DayType
  required_headcount: number
}

export interface TimeOff {
  employee_id: string
  start_date: string // yyyy-MM-dd
  end_date: string   // yyyy-MM-dd
  type: 'absent' | 'sick'
  status: 'pending' | 'approved'
}

export interface Slot {
  date: string // yyyy-MM-dd
  shift_type: ShiftType
  day_type: DayType
  headcount: number
}

export interface GeneratedAssignment {
  employee_id: string
  date: string       // yyyy-MM-dd
  shift_type: ShiftType
  day_type: DayType
  reason: string
}

export interface EmployeeFairnessCounters {
  totalShifts: number
  morningShifts: number
  eveningShifts: number
  nightShifts: number
  weekendShifts: number
  holidayShifts: number
  /** Sorted yyyy-MM-dd dates in the current month — used for 5-on/2-off tracking */
  recentDates: string[]
}

export type FairnessSummary = Record<string, EmployeeFairnessCounters>

export interface GeneratorInputs {
  month: string // yyyy-MM
  employees: Employee[]
  coverageRequirements: CoverageRequirement[]
  publicHolidays: string[] // yyyy-MM-dd
  timeOff: TimeOff[]
  rules: SchedulingRule[]
  /** Fairness counters carried forward from prior months for multi-month fairness. */
  carryForwardCounters?: FairnessSummary
}

export interface GeneratorOutput {
  assignments: GeneratedAssignment[]
  fairnessSummary: FairnessSummary
  unfilledSlots: Slot[]
}
