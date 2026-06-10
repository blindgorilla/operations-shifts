-- Chunk 2b: Override Visibility
-- Safe additive nullable column — no defaults needed, no backfill required.
-- Run this in the Supabase SQL editor.

ALTER TABLE public.shift_assignments
  ADD COLUMN IF NOT EXISTS override_reason text;
