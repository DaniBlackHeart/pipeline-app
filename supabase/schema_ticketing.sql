-- Pipeline: ticketing module (internal use — no client-facing portal)
-- Run this AFTER schema.sql, schema_invoicing.sql, and schema_calendar.sql.
-- Safe to re-run: every policy is dropped and recreated, tables use IF NOT EXISTS.

-- ============================================================
-- TICKETS
-- ============================================================
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text,
  type text not null default 'request' check (type in ('bug', 'request', 'question', 'other')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  assignee_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tickets enable row level security;

drop policy if exists "org members can view tickets" on public.tickets;
create policy "org members can view tickets"
  on public.tickets for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can create tickets" on public.tickets;
create policy "org members can create tickets"
  on public.tickets for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update tickets" on public.tickets;
create policy "org members can update tickets"
  on public.tickets for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can delete tickets" on public.tickets;
create policy "org members can delete tickets"
  on public.tickets for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists tickets_org_id_idx on public.tickets(org_id);
create index if not exists tickets_project_id_idx on public.tickets(project_id);

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at before update on public.tickets
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- TICKET COMMENTS (lightweight thread per ticket)
-- ============================================================
create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.ticket_comments enable row level security;

drop policy if exists "org members can view comments" on public.ticket_comments;
create policy "org members can view comments"
  on public.ticket_comments for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can post comments" on public.ticket_comments;
create policy "org members can post comments"
  on public.ticket_comments for insert
  to authenticated
  with check (public.is_org_member(org_id));

-- Only the author can edit or delete their own comment — unlike tickets/
-- tasks, a comment thread should stay attributable to whoever wrote it.
drop policy if exists "authors can update own comments" on public.ticket_comments;
create policy "authors can update own comments"
  on public.ticket_comments for update
  to authenticated
  using (author_id = auth.uid());

drop policy if exists "authors can delete own comments" on public.ticket_comments;
create policy "authors can delete own comments"
  on public.ticket_comments for delete
  to authenticated
  using (author_id = auth.uid());

create index if not exists ticket_comments_ticket_id_idx on public.ticket_comments(ticket_id);
