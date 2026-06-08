-- Phase 0: Additive schema changes for the automated scheduling engine.
-- Safe to run on an existing database — nothing is dropped or modified destructively.
-- Legacy shift_assignments rows default to status = 'published', locked = false.

-- ============================================================
-- SCHEDULE RUNS TABLE
-- (created first; shift_assignments will FK into it)
-- ============================================================
create table if not exists public.schedule_runs (
  id               uuid        primary key default uuid_generate_v4(),
  period_start     date        not null,
  period_end       date        not null,
  status           text        not null default 'draft'
                               check (status in ('draft', 'published')),
  generated_by     uuid        references public.employees,
  generated_at     timestamptz not null default now(),
  parameters_snapshot jsonb    default '{}'::jsonb,
  fairness_summary    jsonb    default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.schedule_runs enable row level security;

create policy "schedule_runs_select_all" on public.schedule_runs
  for select using (auth.uid() is not null);

create policy "schedule_runs_insert_manager" on public.schedule_runs
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "schedule_runs_update_manager" on public.schedule_runs
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create trigger schedule_runs_updated_at
  before update on public.schedule_runs
  for each row execute function public.handle_updated_at();

-- ============================================================
-- TIME OFF TABLE
-- ============================================================
create table if not exists public.time_off (
  id          uuid        primary key default uuid_generate_v4(),
  employee_id uuid        not null references public.employees on delete cascade,
  start_date  date        not null,
  end_date    date        not null,
  type        text        not null check (type in ('annual', 'sick')),
  status      text        not null default 'pending'
                          check (status in ('pending', 'approved')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint time_off_dates_check check (end_date >= start_date)
);

alter table public.time_off enable row level security;

-- Employees see their own; managers see all
create policy "time_off_select" on public.time_off
  for select using (
    employee_id = auth.uid()
    or exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "time_off_insert_own" on public.time_off
  for insert with check (employee_id = auth.uid());

create policy "time_off_update_manager" on public.time_off
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "time_off_delete_own_pending" on public.time_off
  for delete using (
    employee_id = auth.uid()
    and status = 'pending'
  );

create trigger time_off_updated_at
  before update on public.time_off
  for each row execute function public.handle_updated_at();

-- ============================================================
-- COVERAGE REQUIREMENTS TABLE
-- ============================================================
create table if not exists public.coverage_requirements (
  id                 uuid    primary key default uuid_generate_v4(),
  shift_type         text    not null check (shift_type in ('morning', 'evening', 'night')),
  day_type           text    not null check (day_type in ('weekday', 'friday', 'weekend', 'holiday')),
  required_headcount int     not null check (required_headcount >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (shift_type, day_type)
);

alter table public.coverage_requirements enable row level security;

create policy "coverage_requirements_select_all" on public.coverage_requirements
  for select using (auth.uid() is not null);

create policy "coverage_requirements_insert_manager" on public.coverage_requirements
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "coverage_requirements_update_manager" on public.coverage_requirements
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "coverage_requirements_delete_manager" on public.coverage_requirements
  for delete using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create trigger coverage_requirements_updated_at
  before update on public.coverage_requirements
  for each row execute function public.handle_updated_at();

-- ============================================================
-- SEED: confirmed coverage table (Decisions section)
-- ============================================================
-- Monday–Thursday (weekday): evening = 2, night = 2. No morning.
-- Friday:                    evening = 3, night = 2. No morning. (Friday evening is the only weekday slot needing 3)
-- Saturday–Sunday (weekend): morning = 2, evening = 2, night = 2.
-- Public holidays:           same as weekends — morning = 2, evening = 2, night = 2.

insert into public.coverage_requirements (shift_type, day_type, required_headcount) values
  -- weekday (Mon–Thu)
  ('morning', 'weekday',  0),
  ('evening', 'weekday',  2),
  ('night',   'weekday',  2),
  -- friday
  ('morning', 'friday',   0),
  ('evening', 'friday',   3),
  ('night',   'friday',   2),
  -- weekend (Sat–Sun)
  ('morning', 'weekend',  2),
  ('evening', 'weekend',  2),
  ('night',   'weekend',  2),
  -- public holiday
  ('morning', 'holiday',  2),
  ('evening', 'holiday',  2),
  ('night',   'holiday',  2)
on conflict (shift_type, day_type) do update
  set required_headcount = excluded.required_headcount,
      updated_at         = now();

-- ============================================================
-- ADDITIVE COLUMNS: shift_assignments
-- ============================================================
alter table public.shift_assignments
  add column if not exists schedule_run_id uuid
    references public.schedule_runs,
  add column if not exists status text not null default 'published'
    check (status in ('draft', 'published')),
  add column if not exists locked boolean not null default false;

-- ============================================================
-- ADDITIVE COLUMNS: scheduling_rules
-- ============================================================
-- is_hard: true = hard constraint (filters candidate pool),
--          false = soft objective (scored/penalised).
-- weight: tunable penalty weight for soft objectives (ignored for hard rules).
alter table public.scheduling_rules
  add column if not exists is_hard boolean not null default false,
  add column if not exists weight  numeric  not null default 1.0;

-- Backfill from existing severity: error rules are hard constraints, warning rules are soft.
update public.scheduling_rules
  set is_hard = (severity = 'error');
