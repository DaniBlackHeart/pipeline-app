-- Pipeline: lets people set a nickname alongside their full name.
-- Run this after schema_fix_invite_workspace_signal.sql. Safe to re-run
-- (IF NOT EXISTS guard).
--
-- No RLS changes needed — "users can update their own profile" (schema.sql)
-- is a row-level policy, not column-level, so it already covers this new
-- column for free.

alter table public.profiles add column if not exists nickname text;
