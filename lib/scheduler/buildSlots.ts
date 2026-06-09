import { getDaysInMonth, parseISO, getDay, format, addDays } from 'date-fns'
import type { CoverageRequirement, DayType, Slot } from './types'

/**
 * Expand a month into individual shift slots.
 * For each calendar day, classify its day_type, then emit one Slot per matching
 * coverage requirement where required_headcount > 0.
 */
export function buildSlots(
  month: string, // yyyy-MM
  coverageRequirements: CoverageRequirement[],
  publicHolidays: string[],
): Slot[] {
  const [year, mon] = month.split('-').map(Number)
  const firstDay = new Date(year, mon - 1, 1)
  const daysInMonth = getDaysInMonth(firstDay)
  const holidaySet = new Set(publicHolidays)

  const slots: Slot[] = []

  for (let d = 0; d < daysInMonth; d++) {
    const date = format(addDays(firstDay, d), 'yyyy-MM-dd')
    const dow = getDay(parseISO(date)) // 0=Sun 1=Mon … 6=Sat

    const dayType: DayType = (() => {
      if (holidaySet.has(date)) return 'holiday'
      if (dow === 0 || dow === 6) return 'weekend'
      if (dow === 5) return 'friday'
      return 'weekday'
    })()

    for (const req of coverageRequirements) {
      if (req.day_type !== dayType) continue
      if (req.required_headcount <= 0) continue
      slots.push({ date, shift_type: req.shift_type, day_type: dayType, headcount: req.required_headcount })
    }
  }

  return slots
}
