-- Migration: pinned_assignments table
--
-- Lets a manager guarantee a specific employee a specific (date, shift_type)
-- before schedule generation. Keyed on (employee_id, date, shift_type) rather
-- than shift_id because the target month's shift rows don't exist yet at
-- pin time — they're created during generation.

create table if not exists public.pinned_assignments (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references public.employees on delete cascade,
  date date not null,
  shift_type text not null check (shift_type in ('morning', 'evening', 'night')),
  note text,
  created_by uuid references public.employees,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, date, shift_type)
);

alter table public.pinned_assignments enable row level security;

-- Employees see their own pins; managers see all
create policy "pinned_assignments_select" on public.pinned_assignments
  for select using (
    employee_id = auth.uid()
    or exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "pinned_assignments_insert_manager" on public.pinned_assignments
  for insert with check (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "pinned_assignments_update_manager" on public.pinned_assignments
  for update using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create policy "pinned_assignments_delete_manager" on public.pinned_assignments
  for delete using (
    exists (
      select 1 from public.employees e
      where e.id = auth.uid() and e.role = 'manager'
    )
  );

create trigger pinned_assignments_updated_at
  before update on public.pinned_assignments
  for each row execute function public.handle_updated_at();
