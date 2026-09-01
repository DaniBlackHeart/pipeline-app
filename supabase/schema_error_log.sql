-- Pipeline: lightweight error log for the admin dashboard's System
-- Health tab. Run this AFTER schema_backups.sql. Safe to re-run.
--
-- This is the "lightweight" option chosen over wiring up a real tracker
-- (Sentry's free tier) -- see README, "How the admin dashboard works".
-- It gives the System Health tab something to show beyond integration
-- config booleans, but it's deliberately not a replacement for a real
-- tracker: no alerting, no stack traces, and writes are best-effort (see
-- api/_authHelpers.js's recordErrorLog -- fire-and-forget, not awaited
-- by any of the ~45 logServerError call sites across api/*.js, since
-- making every one of those awaited for a "nice to have" log table
-- wasn't worth the churn). Vercel's own function logs, which every
-- logServerError call already writes to via console.error, remain the
-- unconditional source of truth if a row here is ever lost.

create table if not exists public.error_log (
  id uuid primary key default gen_random_uuid(),
  context text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists error_log_created_at_idx on public.error_log (created_at desc);

alter table public.error_log enable row level security;
-- Deliberately no policies beyond RLS being on -- nothing granted to
-- anon or authenticated. The only writer is recordErrorLog() via the
-- service-role client (bypasses RLS regardless), and the only reader is
-- api/admin.js's health handler, gated by requirePlatformAdmin. Same
-- access model as rate_limit_events and google_calendar_connections.

-- Housekeeping note, not a to-do: same as rate_limit_events, nothing
-- prunes this table yet. At Pipeline's current scale that's harmless
-- clutter for a long time, not worth a cron job. Revisit if it ever
-- grows large enough to slow down the "recent errors" query in
-- api/admin.js (which already only asks for the newest 20 rows).
