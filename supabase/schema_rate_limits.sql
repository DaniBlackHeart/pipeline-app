-- Pipeline: shared rate-limit table for write-capable serverless endpoints
-- Run this AFTER the other schema files. Safe to re-run.
--
-- A minimal, reusable "count recent attempts, cap at N per window" table --
-- the same pattern schema_client_tickets.sql already uses inside
-- submit_client_ticket(), generalized here so any api/*.js handler can use
-- it without inventing its own tracking table. See api/_rateLimit.js for
-- the JS side.
--
-- Service-role only: no RLS policies are granted to anon or authenticated.
-- Every caller of checkRateLimit() already runs server-side with the
-- admin (service-role) client, which bypasses RLS entirely -- so this
-- table simply has zero client-side access, same as
-- google_calendar_connections.
--
-- First two consumers (closing a real gap found in a 13-layer
-- architecture audit): invite-member.js, capping invites per workspace,
-- and google-calendar.js's OAuth code-exchange endpoint, capping connect
-- attempts per user. Neither had any limit before this.

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_scope_created_idx
  on public.rate_limit_events (scope, created_at);

alter table public.rate_limit_events enable row level security;
-- Deliberately no policies beyond RLS being on: nothing is granted to
-- anon or authenticated. Every access path is server-side via the admin
-- client, which bypasses RLS regardless of policies -- turning RLS on
-- here is just consistent hygiene (same as every other table in this
-- project), not a functional requirement for this table specifically.

-- Housekeeping note, not a to-do: without any cleanup, this table grows
-- forever, but at Pipeline's current scale (a couple of rate-limited
-- actions, tiny row size, one query per attempt) that's harmless clutter
-- for a very long time -- not worth a cron job or scheduled delete yet.
-- Revisit only if this table's row count ever becomes large enough to
-- actually slow the count query down.
