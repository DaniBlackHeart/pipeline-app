-- Pipeline: unified activity log (tasks, tickets, invoices, projects)
-- Run this AFTER schema_team.sql (which created task_activity_log — this
-- file generalizes it) and after schema_ticketing.sql / schema_invoicing.sql.
-- Safe to re-run: every policy/trigger is dropped and recreated; the
-- migration from task_activity_log uses ON CONFLICT DO NOTHING so
-- re-running never duplicates history.
--
-- Replaces the task-only `task_activity_log` (from schema_team.sql) with
-- one table covering tasks, tickets, invoices, and projects — the old
-- table's data is migrated in, not discarded. The payoff: a project's
-- activity feed can now show its tasks, tickets, and invoices interleaved
-- in one combined timeline, not four separate ones.

-- ============================================================
-- 1. The unified table
-- ============================================================
-- entity_id is NOT a foreign key, same reasoning as task_activity_log:
-- logging a deletion in an AFTER DELETE trigger would fail otherwise,
-- since the parent row is already gone by the time the trigger runs.
-- entity_title is snapshotted at write time so the log stays readable
-- even after the thing it refers to is renamed or deleted.
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  entity_type text not null check (entity_type in ('task', 'ticket', 'invoice', 'project')),
  entity_id uuid,
  entity_title text not null,
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('created', 'updated', 'deleted')),
  detail text not null,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

drop policy if exists "org members can view activity log" on public.activity_log;
create policy "org members can view activity log"
  on public.activity_log for select
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists activity_log_project_id_idx on public.activity_log(project_id);
create index if not exists activity_log_entity_idx on public.activity_log(entity_type, entity_id);

-- Same live-updating treatment as notifications — a project's or ticket's
-- activity feed can update without a refresh, not just the bell.
alter publication supabase_realtime add table public.activity_log;

-- Carry over existing task history rather than starting the log over.
-- ON CONFLICT on the original row id makes this safe to re-run.
insert into public.activity_log (id, org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail, created_at)
select id, org_id, project_id, 'task', task_id, task_title, actor_id, action, detail, created_at
from public.task_activity_log
on conflict (id) do nothing;


-- ============================================================
-- 2. Tasks — replaces the old task-only trigger from schema_team.sql
-- ============================================================
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changes text := '';
  old_assignee_name text;
  new_assignee_name text;
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.project_id, 'task', new.id, new.title, actor, 'created', 'Created task');
    return new;

  elsif TG_OP = 'UPDATE' then
    if old.status is distinct from new.status then
      changes := changes || format('Status: %s -> %s. ', old.status, new.status);
    end if;
    if old.assignee_id is distinct from new.assignee_id then
      select full_name into old_assignee_name from public.profiles where id = old.assignee_id;
      select full_name into new_assignee_name from public.profiles where id = new.assignee_id;
      changes := changes || format('Assignee: %s -> %s. ', coalesce(old_assignee_name, 'Unassigned'), coalesce(new_assignee_name, 'Unassigned'));
    end if;
    if old.due_date is distinct from new.due_date then
      changes := changes || format('Due date: %s -> %s. ', coalesce(old.due_date::text, 'none'), coalesce(new.due_date::text, 'none'));
    end if;
    if old.title is distinct from new.title then
      changes := changes || format('Title: "%s" -> "%s". ', old.title, new.title);
    end if;
    if changes = '' then
      return new;
    end if;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.project_id, 'task', new.id, new.title, actor, 'updated', trim(changes));
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (old.org_id, old.project_id, 'task', old.id, old.title, actor, 'deleted', 'Deleted task');
    return old;
  end if;

  return null;
end;
$$;

-- Drop the old trigger from schema_team.sql — log_task_activity() now
-- writes to activity_log instead of task_activity_log. The old table
-- itself is left in place, untouched, as a passive historical artifact
-- (its data already migrated above) rather than dropped outright.
drop trigger if exists tasks_log_activity on public.tasks;
create trigger tasks_log_activity
  after insert or update or delete on public.tasks
  for each row execute procedure public.log_task_activity();


-- ============================================================
-- 3. Tickets
-- ============================================================
create or replace function public.log_ticket_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changes text := '';
  old_assignee_name text;
  new_assignee_name text;
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.project_id, 'ticket', new.id, new.title, actor, 'created', 'Created ticket');
    return new;

  elsif TG_OP = 'UPDATE' then
    if old.status is distinct from new.status then
      changes := changes || format('Status: %s -> %s. ', old.status, new.status);
    end if;
    if old.priority is distinct from new.priority then
      changes := changes || format('Priority: %s -> %s. ', old.priority, new.priority);
    end if;
    if old.assignee_id is distinct from new.assignee_id then
      select full_name into old_assignee_name from public.profiles where id = old.assignee_id;
      select full_name into new_assignee_name from public.profiles where id = new.assignee_id;
      changes := changes || format('Assignee: %s -> %s. ', coalesce(old_assignee_name, 'Unassigned'), coalesce(new_assignee_name, 'Unassigned'));
    end if;
    if changes = '' then
      return new;
    end if;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.project_id, 'ticket', new.id, new.title, actor, 'updated', trim(changes));
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (old.org_id, old.project_id, 'ticket', old.id, old.title, actor, 'deleted', 'Deleted ticket');
    return old;
  end if;

  return null;
end;
$$;

-- Note: this is separate from tickets_notify_client_submission (the
-- realtime-notifications trigger) — multiple independent AFTER triggers
-- on the same table and operation are fine in Postgres.
drop trigger if exists tickets_log_activity on public.tickets;
create trigger tickets_log_activity
  after insert or update or delete on public.tickets
  for each row execute procedure public.log_ticket_activity();


-- ============================================================
-- 4. Invoices
-- ============================================================
create or replace function public.log_invoice_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changes text := '';
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.project_id, 'invoice', new.id, new.invoice_number, actor, 'created', 'Created invoice for ' || new.client_name);
    return new;

  elsif TG_OP = 'UPDATE' then
    if old.status is distinct from new.status then
      changes := changes || format('Status: %s -> %s. ', old.status, new.status);
    end if;
    if changes = '' then
      return new;
    end if;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.project_id, 'invoice', new.id, new.invoice_number, actor, 'updated', trim(changes));
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (old.org_id, old.project_id, 'invoice', old.id, old.invoice_number, actor, 'deleted', 'Deleted invoice');
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists invoices_log_activity on public.invoices;
create trigger invoices_log_activity
  after insert or update or delete on public.invoices
  for each row execute procedure public.log_invoice_activity();


-- ============================================================
-- 5. Projects
-- ============================================================
-- project_id here is the project's own id — so querying "everything for
-- project X" (where project_id = X) naturally includes the project's own
-- status-change history alongside its tasks/tickets/invoices.
create or replace function public.log_project_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changes text := '';
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.id, 'project', new.id, new.name, actor, 'created', 'Created project');
    return new;

  elsif TG_OP = 'UPDATE' then
    if old.status is distinct from new.status then
      changes := changes || format('Status: %s -> %s. ', old.status, new.status);
    end if;
    if changes = '' then
      return new;
    end if;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, new.id, 'project', new.id, new.name, actor, 'updated', trim(changes));
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (old.org_id, old.id, 'project', old.id, old.name, actor, 'deleted', 'Deleted project');
    return old;
  end if;

  return null;
end;
$$;

-- No UI delete button exists for projects today, so the DELETE branch is
-- unreachable through the app right now — included anyway since it's
-- cheap and makes the trigger already correct if that ever gets added.
drop trigger if exists projects_log_activity on public.projects;
create trigger projects_log_activity
  after insert or update or delete on public.projects
  for each row execute procedure public.log_project_activity();
