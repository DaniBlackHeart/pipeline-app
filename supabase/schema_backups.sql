-- Pipeline: automated backup export
-- Run this AFTER the other schema files. Safe to re-run.
--
-- Closes a real gap from the 13-layer architecture audit: Supabase's free
-- tier has no point-in-time recovery, and nothing was actually exporting
-- data on any cadence — the manual "click through Table Editor
-- periodically" instructions that used to live in SETUP.md were exactly
-- the kind of thing that quietly never happens. api/backup-export.js now
-- runs daily via cron and needs two things from this file:
--   1. list_public_tables() -- so it can discover every real data table
--      without a hardcoded list going stale as the schema evolves.
--   2. a private 'backups' Storage bucket to write each day's export to.

-- ============================================================
-- 1. Table discovery
-- ============================================================
-- A plain information_schema query, wrapped in a function so it can be
-- called via the JS client's .rpc() (there's no direct "run arbitrary
-- SQL" method on the client) rather than because it needs elevated
-- privilege -- the caller already uses the service-role admin client,
-- which bypasses RLS regardless.
create or replace function public.list_public_tables()
returns table (table_name text)
language sql
stable
as $$
  select t.table_name::text
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
  order by t.table_name;
$$;

grant execute on function public.list_public_tables() to service_role;

-- ============================================================
-- 2. Storage bucket for the exports themselves
-- ============================================================
-- Private, and deliberately no RLS policies at all -- not even an
-- authenticated one. Every access (the daily cron writing a new export,
-- the rotation cleanup deleting old ones) goes through the service-role
-- admin client, which bypasses RLS entirely, same pattern as
-- google_calendar_connections and wise_reconciliation_connections. This
-- means the only way to reach these files through the public API is
-- with the service-role key itself, which never leaves server-side code.
-- You can still browse and download them yourself anytime from the
-- Supabase dashboard's Storage section -- that's an owner-level view,
-- not subject to these policies.
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 104857600)
on conflict (id) do nothing;
