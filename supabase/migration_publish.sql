-- Migration: add 'superseded' to status CHECK constraints
-- for schedule_runs and shift_assignments.
--
-- IMPORTANT: Before running, verify the actual constraint names in your Supabase
-- database by running:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid IN (
--     'public.schedule_runs'::regclass,
--     'public.shift_assignments'::regclass
--   ) AND contype = 'c';
--
-- PostgreSQL auto-names inline CHECK constraints as <table>_<column>_check.
-- If your names differ, update the DROP lines below before running.

-- schedule_runs
ALTER TABLE public.schedule_runs
  DROP CONSTRAINT IF EXISTS schedule_runs_status_check;
ALTER TABLE public.schedule_runs
  ADD CONSTRAINT schedule_runs_status_check
    CHECK (status IN ('draft', 'published', 'superseded'));

-- shift_assignments
ALTER TABLE public.shift_assignments
  DROP CONSTRAINT IF EXISTS shift_assignments_status_check;
ALTER TABLE public.shift_assignments
  ADD CONSTRAINT shift_assignments_status_check
    CHECK (status IN ('draft', 'published', 'superseded'));
