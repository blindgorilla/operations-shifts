# Operations Shifts — Automated Scheduling Engine
## Product architecture & migration plan

Status: proposal for review. No code changes until agreed.
Stack constraint: stay within the existing Next.js 16 / React 19 / Supabase / Tailwind 4 / Resend / Vercel stack. No new runtimes or services.

---

## 0. Summary of the decision

Move from a **request-based** workflow (employees request shifts → manager approves/denies → schedule emerges) to a **generate-then-review** workflow (manager clicks "Generate" → system produces a full draft from rules → manager reviews and tweaks → publish).

Keep a human approval gate, but move it from per-request to per-schedule. Replace employee shift *requests* with employee *availability and time-off*, which feed the generator instead of fighting it.

What we reuse (already built):
- `employees`, `shifts`, `shift_assignments`, `public_holidays`, `scheduling_rules` tables.
- The rule logic in `lib/rules/validateShiftRequest.ts` (12h rest, night follow-up, new-employee pairing, consecutive days, night-rest preference, weekend/holiday fairness, headcount).
- The DB-configurable rules pattern (`scheduling_rules` with `is_enabled`, `severity`, `parameters` jsonb).
- Resend email notifications, the calendar UI, the rules/employees/holidays manager pages.

What changes: a new generator module, a few additive tables/columns, new draft-review and availability UIs, and deprecation of the request/approval screens.

---

## 1. Overall user flow

### Manager workflow
1. One-time setup: confirm rules and parameters on the existing Rules page; set coverage requirements (how many people per shift type per day type).
2. Ongoing maintenance: keep `employees` (weekly_days, is_new_employee), `public_holidays`, and time-off up to date.
3. Each month: open the new **Generate Schedule** screen, pick the target month, review an input summary (headcount, people on leave, coverage gaps), click **Generate draft**.
4. Review the draft on the calendar: fairness sidebar (weekend/holiday/total counts per person), flagged soft-rule penalties, any unfillable slots highlighted.
5. Adjust: lock assignments to keep, drag/drop to move, or **Regenerate** (which respects locked assignments). Manual edits are re-validated against the same rules.
6. **Publish.** Employees are notified via Resend. Published assignments become read-only to employees.

### Employee workflow
1. Set **availability / unavailability** and submit **time-off** (annual leave, medical) — proactive, not shift-by-shift.
2. View the published schedule (read-only calendar).
3. (Optional, later phase) request a swap with a colleague, which the manager approves — a much smaller surface than the old request queue.

### Schedule generation workflow (system)
1. Gather inputs: active employees, their weekly_days targets and is_new_employee flags, time-off ranges, coverage requirements, public holidays, enabled rules + parameters, and carry-forward fairness counters from prior months.
2. Build the slot list: for each day in the month and each shift type, create the required number of open slots from the coverage template (weekend AM/PM = 3, etc.).
3. Order slots hardest-to-fill first (weekends, holidays, nights, high-headcount).
4. For each slot: compute the eligible employees (those passing all **hard** constraints), score each eligible candidate against **soft** objectives plus running fairness counters, assign the best candidate(s).
5. Local-search repair pass: swap assignments that reduce total penalty or correct fairness imbalances.
6. Produce a draft: write unpublished `shift_assignments` tagged to a `schedule_run`, plus a fairness/violation report. Flag any slot left unfilled for manager attention.

---

## 2. Rules engine

The `scheduling_rules` table already supports this. The change is conceptual: separate rules into **hard constraints** (never violated — they filter the candidate pool) and **soft objectives** (penalized and optimized — they score candidates). Each keeps its `parameters` jsonb.

### Hard constraints (filter — an assignment that breaks these is never made)
- Minimum rest between shifts — `min_rest_hours` (default 12).
- No morning/evening the day after any night shift.
- After 2 consecutive night shifts, 2 full days off.
- Exact headcount per slot (no overbooking, and understaffing is flagged).
- Maximum consecutive working days — `max_consecutive_days`.
- Employee on approved annual or sick leave that day.
- New employees not paired together on Friday or Saturday.

### Soft objectives (score — optimized, can be traded off)
- 5-on / 2-off pattern adherence (days off need not be consecutive).
- Weekend fairness — even distribution of weekend shifts across the team.
- Public-holiday fairness — even distribution of holiday shifts.
- Total-shift fairness — even total load.
- Avoid pairing new employees mid-week (hard only on Fri/Sat).

### Configurable parameters (per rule, in `parameters` jsonb)
- `min_rest_hours`, `max_consecutive_days`, `rest_days_after_night`.
- Per-soft-rule **penalty weight** — lets the manager tune what matters most when rules conflict.
- Coverage requirements: required headcount per `shift_type` × `day_type`. Confirmed: Mon–Thu evening = 2, night = 2; Friday evening = 3, night = 2; weekend & holiday morning = 2, evening = 2, night = 2 (no weekday morning).

Add an `is_hard` boolean (or reuse `severity`: `error` = hard, `warning` = soft) and a `weight` field to the rules table so the split and the tuning live in data, not code.

---

## 3. Data structure changes

All changes are **additive** — nothing is dropped during migration.

### Keep as-is
`employees`, `shifts`, `public_holidays`, `scheduling_rules`.

### Modify
- `shift_assignments`: add `schedule_run_id uuid` (nullable, FK to schedule_runs), `status text` (`draft` | `published`, default `published` for legacy rows), and `locked boolean default false` (manager-pinned assignments survive regeneration).
- `scheduling_rules`: add `is_hard boolean` (or repurpose `severity`) and `weight numeric` for soft-rule tuning.

### Add
- `time_off` — `id`, `employee_id`, `start_date`, `end_date`, `type` (`annual` | `sick`), `status` (`pending` | `approved`), `note`. Feeds the generator as a hard unavailability constraint. (Recurring `employee_availability` is not needed for v1.)
- `coverage_requirements` — `shift_type`, `day_type` (`weekday` | `friday` | `weekend` | `holiday`), `required_headcount`. Encodes the confirmed coverage table, including the Friday-evening = 3 exception. (Alternatively store inside `scheduling_rules.parameters`, but a dedicated table is clearer to edit in the UI.)
- `schedule_runs` — `id`, `month` (or `period_start`/`period_end`), `status` (`draft` | `published`), `generated_by`, `generated_at`, `parameters_snapshot jsonb`, `fairness_summary jsonb`. One row per generation; lets you regenerate, compare, and audit.

### Deprecate (do not drop yet)
- `shift_requests` — keep the table for history; stop writing to it once the request UI is retired.

### Important codebase constraint
Foreign-key join syntax fails silently throughout this codebase. Every join in the generator and its API must use **separate sequential queries via the admin client** and stitch results in code (the same pattern already used in `app/api/shift-requests/submit/route.ts`). Build the generator this way from the start.

---

## 4. Scheduling algorithm

Recommendation: **hybrid — constraint-filtered greedy + weighted scoring + local-search repair, in pure TypeScript.**

### Options considered

**Constraint solver (e.g. OR-Tools CP-SAT)**
- Pros: mathematically optimal; handles hard combinatorial constraints elegantly.
- Cons: requires a Python runtime — a second deployment and cross-service calls, mismatched with the Next.js/Vercel stack; harder to debug and explain; overkill at this problem size. Rejected for this context.

**Pure greedy / priority rules**
- Pros: fast, simple, fully explainable.
- Cons: can paint itself into a corner (later slots become unfillable); fairness tends to be suboptimal without correction.

**Pure weighted scoring**
- Pros: good at fairness and preference balancing.
- Cons: needs a hard-constraint layer on top or it produces invalid schedules.

**Hybrid (recommended)**
- Constraint filter guarantees validity (reuses the existing rule logic). Weighted scoring drives fairness and preferences. The local-search repair pass fixes the greedy corner-painting and imbalances.
- Pros: produces valid, fair, near-optimal schedules in milliseconds at this scale; all TypeScript, one codebase; explainable ("assigned because highest fairness score among eligible"); reuses `validateShiftRequest` logic.
- Cons: not provably optimal (irrelevant for an internal roster of this size); needs sensible slot-ordering and weight tuning (handled by the configurable weights above).

### Mechanics
1. Slot ordering: hardest-to-fill first — weekends, holidays, nights, high-headcount slots — so scarce-eligibility slots are filled before the pool is exhausted.
2. Eligibility filter per slot: drop any employee who would break a hard constraint (rest, night follow-up, consecutive-day cap, time-off, Fri/Sat new-pairing).
3. Scoring per eligible candidate: weighted sum of soft objectives + running fairness counters (fewer weekend shifts so far → higher score for a weekend slot). Lowest cumulative penalty wins.
4. Repair pass: attempt swaps that reduce total penalty or correct fairness gaps; keep a swap only if it lowers the global score and breaks no hard constraint.
5. Carry fairness counters across months (stored on/derived for `schedule_runs`) so rotation is fair over time, not reset every month.

---

## 5. User interface changes

### Remove / hide
- Employee shift-request submission (`app/my-requests`, the request side of the calendar).
- Manager request-review queue (`components/manager/ManagerRequestsClient.tsx`, `app/manager/requests`).
- Request-status toggling, pending counts (`app/api/pending-count`, `app/api/pending-requests`, `app/api/shift-requests/*`, `app/api/shifts/request-status`).

### Add
- Manager → **Generate Schedule**: month picker, input summary, generate button.
- Manager → **Draft review**: the calendar with a fairness sidebar, soft-penalty flags, unfilled-slot highlights, lock/unlock per assignment, regenerate, manual edit (re-validated), and publish.
- Manager → **Coverage requirements** config (headcount per shift type × day type).
- Employee → **Availability / time-off**: replaces `my-requests`; submit leave, view status.

### Keep / reuse
- Rules config page (`app/manager/rules`) — already does the job; just surface the new hard/soft split and weights.
- Employees page, Holidays page.
- Calendar component — repurpose for both draft (manager, editable) and published (employee, read-only) views.

### How managers configure rules
On the existing Rules page: toggle enabled, set hard vs soft, set parameters (rest hours, consecutive-day cap, days-off-after-night), and set soft-rule weights. Coverage requirements on their own small screen.

### How employees view schedules
Read-only calendar of published assignments, filtered to themselves with an option to see the full team view. Notified by email on publish.

---

## 6. Automation opportunities

- Auto-create the month's shift rows from the coverage template (no more manual one-by-one shift creation).
- Auto-assign every slot respecting all rules.
- Auto-balance weekend/holiday load using an extended version of the existing `employee_weekend_stats` view plus cross-month carry-forward.
- Auto-notify employees on publish (Resend already wired).
- Auto-flag understaffed/unfillable slots and rule conflicts for manager attention.
- Optional: scheduled monthly draft generation via Vercel Cron or a Supabase scheduled function, leaving the manager only the review-and-publish step.

---

## 7. Recommended architecture

Keep everything in the current stack. No microservice, no Python.

- **Scheduler module** `lib/scheduler/` — pure functions: `generateSchedule(inputs)`, `scoreCandidate(...)`, `buildSlots(...)`. No I/O inside the core so it is unit-testable.
- **Shared constraints** `lib/rules/constraints.ts` — refactor `validateShiftRequest.ts` into pure predicate functions used by **both** the manual-assign validator and the generator. One source of truth for every rule (DRY).
- **Generation API** `POST /api/schedule/generate` — gathers inputs via sequential admin-client queries, runs the module, writes a `schedule_run` plus draft `shift_assignments`, returns the fairness/violation report. A month's worth is fast enough to run inline; if it ever isn't, move to a background job / Edge Function writing results to `schedule_runs` and poll.
- **Publish API** `POST /api/schedule/[runId]/publish` — flips draft assignments to published and fires notifications.
- Data access keeps the **sequential-query, no-FK-join** workaround everywhere.

This is scalable for the foreseeable team size, lives in one repo and one deploy, and is maintainable by one developer.

---

## 8. Migration plan (minimal disruption)

Run the new flow in parallel with the old one, additive-only, feature-flagged, deprecate-not-delete.

- **Phase 0 — schema (non-breaking).** Add `time_off`, `coverage_requirements`, `schedule_runs`; add columns to `shift_assignments` and `scheduling_rules`. Legacy assignments default to `published`. Old request flow keeps working untouched.
- **Phase 1 — engine + draft (behind a flag).** Build `lib/scheduler/`, refactor rules into shared predicates, add the generate API and the draft-review UI on a new route. Old request flow still live.
- **Phase 2 — employee availability/time-off UI.** Stand up the new employee screen; start collecting leave data.
- **Phase 3 — shadow run.** Generate 1–2 real months with the new engine alongside the old flow; compare for correctness and fairness; tune weights. No employee-facing change yet.
- **Phase 4 — cutover.** Hide the request/approval UI, route managers to generate-and-publish, route employees to availability + read-only schedule. Deprecate request endpoints (return 410 or redirect). Keep the `shift_requests` table archived for history.
- **Phase 5 — cleanup (optional).** Remove dead request code/routes once a couple of cycles confirm the new flow is trusted.

Rollback at any phase is trivial because nothing was deleted and the old flow stays intact until Phase 4.

---

## Decisions (locked in)
1. **Night rest is a hard rule, layered:** (a) no morning or evening shift the day after *any* night shift; (b) after *2 consecutive* night shifts, the employee gets 2 full days off. Nights are therefore worked in blocks of 1–2, then rest.
2. **Coverage requirements (confirmed):**
   - Monday–Thursday: evening = 2, night = 2. No morning shift.
   - Friday: evening = 3, night = 2. No morning shift. (Friday evening is the only weekday slot needing 3.)
   - Saturday–Sunday: morning = 2, evening = 2, night = 2.
   - Public holidays: same as weekends — morning = 2, evening = 2, night = 2.
3. **Everyone works 5 days / 2 off per week.** No 4-day employees. The 4-day rotation fairness objective is dropped entirely; `weekly_days` is always 5.
4. **Leave types: annual and sick only.** A single `time_off` table is sufficient; `employee_availability` is not needed for v1.
5. **Swap requests are a later phase**, not in v1.

## Feasibility note (headcount)
Weekly demand = (4 days Mon–Thu × 4 slots) + (Friday = 3 evening + 2 night = 5 slots) + (2 weekend days × 6 slots) = 16 + 5 + 12 = **33 shift-slots/week**. At 5 shifts per employee, the absolute minimum is ~7 people. After the rest rules, the 2-consecutive-night block rule, and weekend fairness are applied, **8–10 guards** is the realistic minimum for the generator to fill every slot cleanly. Below that, the engine still runs but will correctly flag unfilled slots for the manager.
