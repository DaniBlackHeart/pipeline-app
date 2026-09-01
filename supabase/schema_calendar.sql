-- Pipeline: calendar module
-- Run this AFTER schema.sql and schema_invoicing.sql, in the Supabase SQL editor.
-- Safe to re-run: every policy is dropped and recreated, tables use IF NOT EXISTS.

-- ============================================================
-- CALENDAR EVENTS
-- ============================================================
-- Standalone events. Project due dates and task due dates are NOT
-- duplicated here — the calendar UI merges this table with projects/tasks
-- at query time so there's only ever one source of truth for a due date.
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calendar_events enable row level security;

drop policy if exists "org members can view events" on public.calendar_events;
create policy "org members can view events"
  on public.calendar_events for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can create events" on public.calendar_events;
create policy "org members can create events"
  on public.calendar_events for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update events" on public.calendar_events;
create policy "org members can update events"
  on public.calendar_events for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can delete events" on public.calendar_events;
create policy "org members can delete events"
  on public.calendar_events for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists calendar_events_org_id_idx on public.calendar_events(org_id);
create index if not exists calendar_events_start_at_idx on public.calendar_events(start_at);

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at before update on public.calendar_events
  for each row execute procedure public.set_updated_at();
