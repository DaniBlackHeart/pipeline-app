-- Pipeline: time tracking
-- Run this AFTER schema_task_detail.sql (needs public.tasks) and
-- schema.sql (needs public.set_updated_at(), public.is_org_member(),
-- public.is_org_admin()). Safe to re-run: columns use IF NOT EXISTS,
-- the table uses IF NOT EXISTS, every policy/trigger is dropped and
-- recreated.
--
-- Adds a start/stop timer AND manual time-entry logging against a task
-- (project-level rollups are computed by joining through the task, same
-- way invoices already resolve "for this task or its whole project"),
-- plus an org-wide default hourly rate that a project can override, and
-- the plumbing an invoice needs to pull unbilled time in as a line item.

-- ============================================================
-- 1. Billable rate: an org-wide default, overridable per project
-- ============================================================
alter table public.organizations
  add column if not exists default_hourly_rate numeric(10, 2);

alter table public.projects
  add column if not exists hourly_rate numeric(10, 2);


-- ============================================================
-- 2. TIME_ENTRIES
-- ============================================================
-- A row is either a completed entry (minutes is set, started_at is null)
-- or a currently-running timer (started_at is set, minutes is null) --
-- never both. Manual entries are created already-completed; a timer
-- entry starts running and gets its minutes filled in when stopped, at
-- which point it looks identical in shape to a manual one.
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null default current_date,
  minutes integer check (minutes is null or minutes > 0),
  started_at timestamptz,
  source text not null default 'manual' check (source in ('timer', 'manual')),
  note text,
  billed boolean not null default false,
  invoice_id uuid references public.invoices(id) on delete set null,
  rate_snapshot numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_running_xor_completed check (
    (started_at is not null and minutes is null) or
    (started_at is null and minutes is not null)
  )
);

alter table public.time_entries enable row level security;

-- A person can only ever have one timer running at a time (across any
-- task) -- enforced here, not just in the UI, since two people sharing a
-- login or two open tabs could otherwise both start one.
drop index if exists time_entries_one_running_timer_per_user;
create unique index time_entries_one_running_timer_per_user
  on public.time_entries (user_id)
  where started_at is not null;

create index if not exists time_entries_org_id_idx on public.time_entries(org_id);
create index if not exists time_entries_task_id_idx on public.time_entries(task_id);
create index if not exists time_entries_user_id_idx on public.time_entries(user_id);
create index if not exists time_entries_invoice_id_idx on public.time_entries(invoice_id);
-- Backs the "unbilled entries for this task" lookup InvoiceForm and
-- TaskDetail both run.
create index if not exists time_entries_task_billed_idx on public.time_entries(task_id, billed);

drop policy if exists "org members can view time entries" on public.time_entries;
create policy "org members can view time entries"
  on public.time_entries for select
  to authenticated
  using (public.is_org_member(org_id));

-- You can only ever log time under your own account -- no logging time
-- on someone else's behalf, admin or not. Also requires the task to
-- actually belong to the org you're claiming (org_id alone wasn't
-- enough -- without this, any org member could log a fabricated entry
-- against a task_id from a completely different org, and it would
-- later get pulled into THIS org's own invoices as real unbilled time).
drop policy if exists "members can log their own time" on public.time_entries;
create policy "members can log their own time"
  on public.time_entries for insert
  to authenticated
  with check (
    public.is_org_member(org_id)
    and user_id = auth.uid()
    and exists (
      select 1 from public.tasks
      where tasks.id = time_entries.task_id
        and tasks.org_id = time_entries.org_id
    )
  );

-- Editing/deleting your own entry covers correcting a mistake or
-- deleting a bad one; org admins additionally need update access so
-- invoice creation can mark other people's entries billed.
drop policy if exists "owner or admin can update time entries" on public.time_entries;
create policy "owner or admin can update time entries"
  on public.time_entries for update
  to authenticated
  using (user_id = auth.uid() or public.is_org_admin(org_id));

drop policy if exists "owner or admin can delete time entries" on public.time_entries;
create policy "owner or admin can delete time entries"
  on public.time_entries for delete
  to authenticated
  using (user_id = auth.uid() or public.is_org_admin(org_id));

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at before update on public.time_entries
  for each row execute procedure public.set_updated_at();
