export type ShiftType = 'morning' | 'evening' | 'night'
export type RequestStatus = 'pending' | 'approved' | 'denied'
export type ShiftRequestStatus = 'closed' | 'open' | 'reviewing'
export type UserRole = 'employee' | 'manager'

export interface Employee {
  id: string
  name: string
  email: string
  role: UserRole
  is_new_employee: boolean
  is_active: boolean
  employment_start_date: string | null
  weekly_days: 4 | 5
  created_at: string
  updated_at: string
}

export interface Shift {
  id: string
  date: string
  shift_type: ShiftType
  start_time: string
  end_time: string
  location: string | null
  role_required: string | null
  headcount: number
  notes: string | null
  is_published: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  request_status: ShiftRequestStatus
  // computed / joined
  request_count?: number
  assignment_count?: number
}

export interface ShiftAssignment {
  id: string
  employee_id: string
  shift_id: string
  assigned_by: string | null
  created_at: string
  override_reason?: string | null
  employee?: Employee
  shift?: Shift
}

export interface RuleViolation {
  rule: string
  severity: 'error' | 'warning'
  message: string
}

export interface SchedulingRule {
  id: string
  name: string
  display_name: string
  description: string
  severity: 'error' | 'warning'
  is_hard?: boolean // DB column added in Phase 0; takes precedence over severity when present
  is_enabled: boolean
  parameters: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ShiftRequest {
  id: string
  employee_id: string
  shift_id: string
  status: RequestStatus
  employee_note: string | null
  manager_note: string | null
  rule_violations: RuleViolation[]
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  // joined
  employee?: Employee
  shift?: Shift
}

export interface PublicHoliday {
  id: string
  date: string
  name: string
  created_by: string | null
  created_at: string
}

export interface EmployeeWeekendStats {
  employee_id: string
  name: string
  weekend_shifts: number
  holiday_shifts: number
  total_shifts: number
}
