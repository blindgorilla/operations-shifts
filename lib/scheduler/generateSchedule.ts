import type { Employee, SchedulingRule } from '@/types'
import type {
  GeneratorInputs,
  GeneratorOutput,
  Slot,
  GeneratedAssignment,
  FairnessSummary,
  EmployeeFairnessCounters,
  TimeOff,
} from './types'
import { buildSlots } from './buildSlots'
import { isEligible } from './eligibility'
import { scoreCandidate, updateCounters, revertCounters, globalPenalty } from './scoring'

// ---------------------------------------------------------------------------
// Slot ordering: hardest-to-fill first
// Priority: holiday > weekend > friday > weekday
// Within day type: night > evening > morning
// Ties broken by higher headcount first
// ---------------------------------------------------------------------------

const DAY_TYPE_PRIORITY: Record<string, number> = {
  holiday: 0,
  weekend: 1,
  friday: 2,
  weekday: 3,
}

const SHIFT_TYPE_PRIORITY: Record<string, number> = {
  night: 0,
  evening: 1,
  morning: 2,
}

function slotPriority(slot: Slot): number {
  return DAY_TYPE_PRIORITY[slot.day_type] * 10 + SHIFT_TYPE_PRIORITY[slot.shift_type]
}

function orderSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => {
    const p = slotPriority(a) - slotPriority(b)
    if (p !== 0) return p
    // Higher headcount first for equal priority
    return b.headcount - a.headcount
  })
}

// ---------------------------------------------------------------------------
// Assignment helpers
// ---------------------------------------------------------------------------

function empAssignments(assignments: GeneratedAssignment[], empId: string): GeneratedAssignment[] {
  return assignments.filter(a => a.employee_id === empId)
}

function slotAssignments(assignments: GeneratedAssignment[], slot: Slot): GeneratedAssignment[] {
  return assignments.filter(a => a.date === slot.date && a.shift_type === slot.shift_type)
}

function buildReason(
  employee: Employee,
  slot: Slot,
  counters: FairnessSummary,
  allEmployees: Employee[],
): string {
  const c = counters[employee.id]
  if (!c) return 'assigned (first shift)'
  const parts: string[] = []
  if (slot.day_type === 'weekend') parts.push(`${c.weekendShifts} weekend shifts`)
  if (slot.day_type === 'holiday') parts.push(`${c.holidayShifts} holiday shifts`)
  parts.push(`${c.totalShifts} total shifts`)
  return `lowest imbalance score (${parts.join(', ')})`
}

function emptyCounters(): EmployeeFairnessCounters {
  return { totalShifts: 0, weekendShifts: 0, holidayShifts: 0, nightShifts: 0, recentDates: [] }
}

function deepCopyCounters(counters: FairnessSummary): FairnessSummary {
  const copy: FairnessSummary = {}
  for (const [k, v] of Object.entries(counters)) {
    copy[k] = { ...v, recentDates: [...v.recentDates] }
  }
  return copy
}

// ---------------------------------------------------------------------------
// Local-search repair pass
// Attempts pairwise employee swaps between assignments that lower globalPenalty
// and break no hard constraint.
// ---------------------------------------------------------------------------

function repairPass(
  assignments: GeneratedAssignment[],
  counters: FairnessSummary,
  employees: Employee[],
  timeOff: TimeOff[],
  rules: SchedulingRule[],
  passes: number = 2,
): void {
  const empIds = employees.map(e => e.id)

  for (let pass = 0; pass < passes; pass++) {
    let improved = false

    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1 = assignments[i]
        const a2 = assignments[j]
        if (a1.employee_id === a2.employee_id) continue

        const emp1 = employees.find(e => e.id === a1.employee_id)!
        const emp2 = employees.find(e => e.id === a2.employee_id)!

        // Build per-employee assignment lists excluding the two assignments under review
        const empAssignmentsExcl = (empId: string, excludeIdx: number) =>
          assignments.filter((_, idx) => assignments[idx].employee_id === empId && idx !== excludeIdx)

        const slot1: Slot = { date: a1.date, shift_type: a1.shift_type, day_type: a1.day_type, headcount: 0 }
        const slot2: Slot = { date: a2.date, shift_type: a2.shift_type, day_type: a2.day_type, headcount: 0 }

        // Slot assignments for each slot, excluding the two being swapped
        const slot1Others = assignments.filter(
          (a, idx) => idx !== i && a.date === slot1.date && a.shift_type === slot1.shift_type,
        )
        const slot2Others = assignments.filter(
          (a, idx) => idx !== j && a.date === slot2.date && a.shift_type === slot2.shift_type,
        )

        const e1ExclI = empAssignmentsExcl(a1.employee_id, i)
        const e2ExclJ = empAssignmentsExcl(a2.employee_id, j)

        // Check eligibility for the swapped positions
        const emp2CanTakeSlot1 = isEligible(slot1, emp2, e2ExclJ, slot1Others, timeOff, rules, employees)
        const emp1CanTakeSlot2 = isEligible(slot2, emp1, e1ExclI, slot2Others, timeOff, rules, employees)

        if (!emp2CanTakeSlot1 || !emp1CanTakeSlot2) continue

        // Compute penalty delta
        const before = globalPenalty(counters, empIds)

        // Tentatively apply swap to counters
        revertCounters(counters, a1.employee_id, slot1)
        revertCounters(counters, a2.employee_id, slot2)
        updateCounters(counters, a2.employee_id, slot1)
        updateCounters(counters, a1.employee_id, slot2)

        const after = globalPenalty(counters, empIds)

        if (after < before - 0.001) {
          // Accept swap
          assignments[i] = {
            ...a1,
            employee_id: a2.employee_id,
            reason: `swapped for fairness (was ${a1.employee_id})`,
          }
          assignments[j] = {
            ...a2,
            employee_id: a1.employee_id,
            reason: `swapped for fairness (was ${a2.employee_id})`,
          }
          improved = true
        } else {
          // Roll back
          revertCounters(counters, a2.employee_id, slot1)
          revertCounters(counters, a1.employee_id, slot2)
          updateCounters(counters, a1.employee_id, slot1)
          updateCounters(counters, a2.employee_id, slot2)
        }
      }
    }

    if (!improved) break
  }
}

// ---------------------------------------------------------------------------
// generateSchedule — main orchestrator
// ---------------------------------------------------------------------------

/**
 * Pure scheduling engine.
 *
 * 1. Expands the month into Slots via buildSlots.
 * 2. Orders slots hardest-to-fill first.
 * 3. For each slot: filters eligible employees, scores them, assigns the best.
 * 4. Runs a local-search repair pass to improve fairness.
 * 5. Returns assignments, the fairness summary, and any unfilled slots.
 *
 * No I/O — all inputs are passed in.
 */
export function generateSchedule(inputs: GeneratorInputs): GeneratorOutput {
  const { month, employees, coverageRequirements, publicHolidays, timeOff, rules, carryForwardCounters } =
    inputs

  // 1. Build and order slots
  const allSlots = buildSlots(month, coverageRequirements, publicHolidays)
  const orderedSlots = orderSlots(allSlots)

  // 2. Initialise fairness counters (seed with carry-forward data if provided)
  const counters: FairnessSummary = deepCopyCounters(carryForwardCounters ?? {})
  for (const emp of employees) {
    if (!counters[emp.id]) counters[emp.id] = emptyCounters()
  }

  // 3. Greedy assignment pass
  const assignments: GeneratedAssignment[] = []
  const unfilledSlots: Slot[] = []

  for (const slot of orderedSlots) {
    const alreadyInSlot: GeneratedAssignment[] = []
    const needed = slot.headcount

    // Eligible employees for the first position in this slot
    const candidates = employees.filter(emp =>
      isEligible(slot, emp, empAssignments(assignments, emp.id), alreadyInSlot, timeOff, rules, employees),
    )

    // Score and sort ascending (lower = better)
    const scored = candidates
      .map(emp => ({
        emp,
        score: scoreCandidate(emp, slot, counters, alreadyInSlot, rules, employees),
      }))
      .sort((a, b) => a.score - b.score || a.emp.id.localeCompare(b.emp.id))

    for (const { emp } of scored.slice(0, needed)) {
      // Re-check eligibility each iteration because alreadyInSlot grows
      if (!isEligible(slot, emp, empAssignments(assignments, emp.id), alreadyInSlot, timeOff, rules, employees)) {
        continue
      }
      const reason = buildReason(emp, slot, counters, employees)
      const assignment: GeneratedAssignment = {
        employee_id: emp.id,
        date: slot.date,
        shift_type: slot.shift_type,
        day_type: slot.day_type,
        reason,
      }
      assignments.push(assignment)
      alreadyInSlot.push(assignment)
      updateCounters(counters, emp.id, slot)
    }

    if (alreadyInSlot.length < needed) {
      unfilledSlots.push({ ...slot, headcount: needed - alreadyInSlot.length })
    }
  }

  // 4. Local-search repair pass
  repairPass(assignments, counters, employees, timeOff, rules)

  return { assignments, fairnessSummary: counters, unfilledSlots }
}
