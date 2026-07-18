-- Pipeline: team management (invite flow support + admin-only task creation
-- + per-task activity log)
-- Run this AFTER the other schema files.
-- Safe to re-run: every policy is dropped and recreated, tables use IF NOT EXISTS.

-- ============================================================
-- 1. Denormalize email onto profiles
-- ============================================================
-- auth.users.email isn't queryable through the normal RLS-protected client
-- (no public policy exposes it, and it shouldn't — auth.users holds a lot
-- more than we want world-readable). Storing a copy on profiles lets the
-- Team page list "who's on this workspace, and what's their email" with a
-- normal client-side query, no admin API call needed just to view the roster.
-- Trade-off: this copy goes stale if someone changes their email later via
-- Supabase Auth directly — acceptable for now, worth knowing.
alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Backfill existing profiles created before this column existed.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;


-- ============================================================
-- 2. Task creation becomes an admin/owner-only action
-- ============================================================
-- Everything else about tasks (marking done, reassigning, changing due date,
-- deleting) stays open to every org member — only *creating* a new task is
-- now gated. Members can still fully work their assigned tasks; they just
-- can't add net-new ones to a project.
drop policy if exists "org members can create tasks" on public.tasks;
drop policy if exists "org admins can create tasks" on public.tasks;
create policy "org admins can create tasks"
  on public.tasks for insert
  to authenticated
  with check (public.is_org_admin(org_id));


-- ============================================================
-- 3. Task activity log
-- ============================================================
-- One row per meaningful change to a task: created, status changed,
-- assignee changed, due date changed, deleted. Written entirely by a
-- trigger (not app code), so nothing can bypass it by calling the API a
-- different way, and no client-side INSERT policy is needed — only the
-- security-definer trigger function writes here.
--
-- task_id is intentionally NOT a foreign key: if it were, logging a
-- "deleted" entry in an AFTER DELETE trigger would fail, since by the time
-- the trigger runs, the referenced task row is already gone. task_title is
-- snapshotted at the time of each event instead, so the log stays readable
-- even after a task is renamed or deleted.
create table if not exists public.task_activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid,
  task_title text not null,
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('created', 'updated', 'deleted')),
  detail text not null,
  created_at timestamptz not null default now()
);

alter table public.task_activity_log enable row level security;

drop policy if exists "org members can view task activity" on public.task_activity_log;
create policy "org members can view task activity"
  on public.task_activity_log for select
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists task_activity_log_project_id_idx on public.task_activity_log(project_id);

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changes text := '';
  old_assignee_name text;
  new_assignee_name text;
begin
  if TG_OP = 'INSERT' then
    insert into public.task_activity_log (org_id, project_id, task_id, task_title, actor_id, action, detail)
    values (
      new.org_id, new.project_id, new.id, new.title, actor, 'created',
      'Created task'
    );
    return new;

  elsif TG_OP = 'UPDATE' then
    if old.status is distinct from new.status then
      changes := changes || format('Status: %s -> %s. ', old.status, new.status);
    end if;

    if old.assignee_id is distinct from new.assignee_id then
      select full_name into old_assignee_name from public.profiles where id = old.assignee_id;
      select full_name into new_assignee_name from public.profiles where id = new.assignee_id;
      changes := changes || format(
        'Assignee: %s -> %s. ',
        coalesce(old_assignee_name, 'Unassigned'),
        coalesce(new_assignee_name, 'Unassigned')
      );
    end if;

    if old.due_date is distinct from new.due_date then
      changes := changes || format(
        'Due date: %s -> %s. ',
        coalesce(old.due_date::text, 'none'),
        coalesce(new.due_date::text, 'none')
      );
    end if;

    if old.title is distinct from new.title then
      changes := changes || format('Title: "%s" -> "%s". ', old.title, new.title);
    end if;

    if changes = '' then
      -- Nothing we track changed (e.g. only `position` moved) — skip logging.
      return new;
    end if;

    insert into public.task_activity_log (org_id, project_id, task_id, task_title, actor_id, action, detail)
    values (new.org_id, new.project_id, new.id, new.title, actor, 'updated', trim(changes));
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.task_activity_log (org_id, project_id, task_id, task_title, actor_id, action, detail)
    values (old.org_id, old.project_id, old.id, old.title, actor, 'deleted', 'Deleted task');
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists tasks_log_activity on public.tasks;
create trigger tasks_log_activity
  after insert or update or delete on public.tasks
  for each row execute procedure public.log_task_activity();
