-- Operations Shifts Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- EMPLOYEES TABLE
-- ============================================================
create table if not exists public.employees (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  email text not null unique,
  role text not null default 'employee' check (role in ('employee', 'manager')),
  is_new_employee boolean not null default false,
  employment_start_date date,
  weekly_days int not null default 5 check (weekly_days in (4, 5)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employees enable row level security;

-- Employees can read their own profile and all employees (for manager views)
create policy "employees_select" on public.employees
  for select using (auth.uid() is not null);

create policy "employees_insert_own" on public.employees
  for insert with check (auth.uid() = id);

create policy "employees_update_own" on public.employees
  for update using (auth.uid() = id);

-- Managers can update any employee
create policy "managers_update_any_employee" on public.employees
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

-- ============================================================
-- PUBLIC HOLIDAYS TABLE
-- ============================================================
create table if not exists public.public_holidays (
  id uuid primary key default uuid_generate_v4(),
  date date not null unique,
  name text not null,
  created_by uuid references public.employees,
  created_at timestamptz not null default now()
);

alter table public.public_holidays enable row level security;

create policy "holidays_select_all" on public.public_holidays
  for select using (auth.uid() is not null);

create policy "holidays_insert_manager" on public.public_holidays
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "holidays_delete_manager" on public.public_holidays
  for delete using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

-- ============================================================
-- SHIFTS TABLE
-- ============================================================
create table if not exists public.shifts (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  shift_type text not null check (shift_type in ('morning', 'evening', 'night')),
  start_time time not null,
  end_time time not null,
  location text,
  role_required text,
  headcount int not null default 1 check (headcount > 0),
  notes text,
  is_published boolean not null default false,
  created_by uuid references public.employees,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shifts enable row level security;

create policy "shifts_select_published" on public.shifts
  for select using (
    is_published = true
    or exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "shifts_insert_manager" on public.shifts
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "shifts_update_manager" on public.shifts
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "shifts_delete_manager" on public.shifts
  for delete using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

-- ============================================================
-- SHIFT ASSIGNMENTS TABLE
-- ============================================================
create table if not exists public.shift_assignments (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references public.employees on delete cascade,
  shift_id uuid not null references public.shifts on delete cascade,
  assigned_by uuid references public.employees,
  created_at timestamptz not null default now(),
  unique(employee_id, shift_id)
);

alter table public.shift_assignments enable row level security;

create policy "assignments_select_all" on public.shift_assignments
  for select using (auth.uid() is not null);

create policy "assignments_insert_manager" on public.shift_assignments
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "assignments_delete_manager" on public.shift_assignments
  for delete using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

-- ============================================================
-- SHIFT REQUESTS TABLE
-- ============================================================
create table if not exists public.shift_requests (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references public.employees on delete cascade,
  shift_id uuid not null references public.shifts on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  employee_note text,
  manager_note text,
  rule_violations jsonb default '[]'::jsonb,
  reviewed_by uuid references public.employees,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, shift_id)
);

alter table public.shift_requests enable row level security;

-- Employees see their own requests; managers see all
create policy "requests_select" on public.shift_requests
  for select using (
    employee_id = auth.uid()
    or exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "requests_insert_own" on public.shift_requests
  for insert with check (employee_id = auth.uid());

create policy "requests_update_manager" on public.shift_requests
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "requests_delete_own" on public.shift_requests
  for delete using (
    employee_id = auth.uid()
    and status = 'pending'
  );

-- ============================================================
-- SCHEDULING RULES TABLE
-- ============================================================
create table if not exists public.scheduling_rules (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  display_name text not null,
  description text not null,
  severity text not null check (severity in ('error', 'warning')),
  is_enabled boolean not null default true,
  parameters jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scheduling_rules enable row level security;

create policy "rules_select_all" on public.scheduling_rules
  for select using (auth.uid() is not null);

create policy "rules_insert_manager" on public.scheduling_rules
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "rules_update_manager" on public.scheduling_rules
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "rules_delete_manager" on public.scheduling_rules
  for delete using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- Weekend & holiday fairness view: count per employee
create or replace view public.employee_weekend_stats as
  select
    e.id as employee_id,
    e.name,
    count(sa.id) filter (
      where extract(dow from s.date) in (0, 6)
    ) as weekend_shifts,
    count(sa.id) filter (
      where exists (
        select 1 from public.public_holidays ph where ph.date = s.date
      )
    ) as holiday_shifts,
    count(sa.id) as total_shifts
  from public.employees e
  left join public.shift_assignments sa on sa.employee_id = e.id
  left join public.shifts s on s.id = sa.shift_id
  where e.role = 'employee'
  group by e.id, e.name;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger employees_updated_at
  before update on public.employees
  for each row execute function public.handle_updated_at();

create trigger shifts_updated_at
  before update on public.shifts
  for each row execute function public.handle_updated_at();

create trigger shift_requests_updated_at
  before update on public.shift_requests
  for each row execute function public.handle_updated_at();

create trigger scheduling_rules_updated_at
  before update on public.scheduling_rules
  for each row execute function public.handle_updated_at();

-- ============================================================
-- AUTO-CREATE EMPLOYEE PROFILE ON SIGNUP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.employees (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
