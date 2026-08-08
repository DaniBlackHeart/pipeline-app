-- Google Calendar two-way sync.
-- Run this AFTER schema_calendar.sql.
-- Safe to re-run: tables use IF NOT EXISTS, policies are dropped and
-- recreated, indexes use IF NOT EXISTS.

-- ============================================================
-- GOOGLE CALENDAR CONNECTIONS
-- ============================================================
-- One row per person who has connected their own Google account, per
-- workspace. Holds live OAuth tokens, so this table is deliberately NOT
-- exposed to the client at all -- RLS is enabled with zero policies for
-- `authenticated`, meaning every read and write goes through a
-- service-role serverless function (api/google-oauth-exchange.js,
-- api/google-calendar-status.js, api/google-calendar-disconnect.js,
-- api/google-calendar-push.js, api/google-calendar-sync.js). The
-- frontend never queries this table directly with the Supabase client --
-- it only ever gets a status summary back from those endpoints.
create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  sync_token text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table public.google_calendar_connections enable row level security;
-- Intentionally no policies here -- default-deny for anon/authenticated.
-- Only the service role (which bypasses RLS) can touch this table.

create index if not exists google_calendar_connections_org_id_idx on public.google_calendar_connections(org_id);

drop trigger if exists google_calendar_connections_set_updated_at on public.google_calendar_connections;
create trigger google_calendar_connections_set_updated_at before update on public.google_calendar_connections
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- CALENDAR EVENT <-> GOOGLE EVENT LINKS
-- ============================================================
-- A Pipeline event can map to a *different* Google event id per person's
-- connection (each team member syncs against their own Google Calendar
-- independently), so this is its own join table rather than columns on
-- calendar_events directly.
create table if not exists public.calendar_event_google_links (
  id uuid primary key default gen_random_uuid(),
  calendar_event_id uuid not null references public.calendar_events(id) on delete cascade,
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  google_event_id text not null,
  updated_at timestamptz not null default now(),
  unique (calendar_event_id, connection_id),
  unique (connection_id, google_event_id)
);

alter table public.calendar_event_google_links enable row level security;
-- Same reasoning as above -- this table only ever gets touched by the
-- service-role sync/push functions, never directly by the client.

create index if not exists calendar_event_google_links_event_idx on public.calendar_event_google_links(calendar_event_id);
create index if not exists calendar_event_google_links_connection_idx on public.calendar_event_google_links(connection_id);
