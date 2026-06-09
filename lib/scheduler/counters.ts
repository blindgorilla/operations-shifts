import type { EmployeeFairnessCounters } from './types'

/**
 * Returns a zeroed EmployeeFairnessCounters.
 * Single source of truth — imported by scoring.ts, generateSchedule.ts,
 * and the generate API route so they can't drift out of sync.
 */
export function emptyCounters(): EmployeeFairnessCounters {
  return {
    totalShifts: 0,
    morningShifts: 0,
    eveningShifts: 0,
    nightShifts: 0,
    weekendShifts: 0,
    holidayShifts: 0,
    recentDates: [],
  }
}
