-- Chunk 2a: add last_edited_at to schedule_runs
-- Run this in the Supabase SQL editor before deploying.
ALTER TABLE public.schedule_runs
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;
