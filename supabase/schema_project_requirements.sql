-- Pipeline: project requirements — mandatory client/due date, start date,
-- project assignees
-- Run this AFTER schema_task_detail.sql.
--
-- Three changes:
--   1. client_name and due_date can no longer be blank on a project.
--   2. A new start_date, also mandatory going forward.
--   3. Projects can now have multiple assigned members with optional role
--      labels — same pattern as task_assignees, applied to projects.
--
-- IMPORTANT — READ BEFORE RUNNING: same caution as
-- schema_invoice_requirements.sql. The client_name/due_date ALTER
-- statements can fail if any existing project doesn't already have both
-- filled in — safe either way, Postgres just refuses and tells you which
-- rows are the problem, nothing gets corrupted. Run the preview query
-- below first. start_date is different: since it's a brand-new column
-- with no prior UI ever asking for it, existing projects are backfilled
-- automatically (using each project's creation date as a reasonable
-- stand-in) rather than requiring a manual fix — a new, mandatory-only-
-- going-forward field doesn't need the same manual review as a value that
-- was always optional and might be meaningfully missing.

-- ============================================================
-- STEP 1 — PREVIEW. Run this first. If it returns any rows, open those
-- specific projects in the app and fill in the missing client name and/or
-- due date before running the ALTER statements in step 3.
-- ============================================================
select id, name, client_name, due_date
from public.projects
where client_name is null or due_date is null;


-- ============================================================
-- STEP 2 — start_date: add nullable, backfill from creation date, then
-- make mandatory. No manual review needed — every existing project gets
-- a reasonable value automatically.
-- ============================================================
alter table public.projects add column if not exists start_date date;

update public.projects
set start_date = created_at::date
where start_date is null;

alter table public.projects alter column start_date set not null;
alter table public.projects alter column start_date set default current_date;


-- ============================================================
-- STEP 3 — client_name and due_date become mandatory. Run only after
-- confirming step 1's preview came back empty (or after fixing any rows
-- it flagged).
-- ============================================================
alter table public.projects alter column client_name set not null;
alter table public.projects alter column due_date set not null;


-- ============================================================
-- STEP 4 — project assignees: multiple people per project, each with an
-- optional role label (e.g. "Video Editor", "Project Coordinator") —
-- identical pattern to task_assignees.
-- ============================================================
create table if not exists public.project_assignees (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_label text,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_assignees enable row level security;

drop policy if exists "org members can view project assignees" on public.project_assignees;
create policy "org members can view project assignees"
  on public.project_assignees for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can add project assignees" on public.project_assignees;
create policy "org members can add project assignees"
  on public.project_assignees for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can remove project assignees" on public.project_assignees;
create policy "org members can remove project assignees"
  on public.project_assignees for delete
  to authenticated
  using (public.is_org_member(org_id));


-- ============================================================
-- STEP 5 — log assignee changes to the unified activity log, same as
-- task_assignees already does.
-- ============================================================
create or replace function public.log_project_assignee_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  person_name text;
  project_row record;
begin
  if TG_OP = 'INSERT' then
    select * into project_row from public.projects where id = new.project_id;
    if not found then return new; end if;
    select full_name into person_name from public.profiles where id = new.user_id;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (
      new.org_id, new.project_id, 'project', new.project_id, project_row.name, actor, 'updated',
      format('Added %s%s', coalesce(person_name, 'someone'), case when new.role_label is not null then ' (' || new.role_label || ')' else '' end)
    );
    return new;

  elsif TG_OP = 'DELETE' then
    select * into project_row from public.projects where id = old.project_id;
    if not found then return old; end if;
    select full_name into person_name from public.profiles where id = old.user_id;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (
      old.org_id, old.project_id, 'project', old.project_id, project_row.name, actor, 'updated',
      format('Removed %s as assignee', coalesce(person_name, 'someone'))
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists project_assignees_log_activity on public.project_assignees;
create trigger project_assignees_log_activity
  after insert or delete on public.project_assignees
  for each row execute procedure public.log_project_assignee_activity();


-- ============================================================
-- STEP 6 — notify when someone is added to a project (new notification
-- type, same safe drop-then-recreate as when task_comment was added).
-- ============================================================
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('task_assigned', 'ticket_comment', 'client_ticket_submitted', 'task_comment', 'project_assigned'));

create or replace function public.notify_project_assignee_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  project_row record;
begin
  if new.user_id = actor then
    return new;
  end if;

  select * into project_row from public.projects where id = new.project_id;
  if not found then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = actor;

  insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
  values (
    new.org_id, new.user_id, actor, 'project_assigned',
    coalesce(actor_name, 'Someone') || ' added you to a project',
    project_row.name,
    '/projects/' || project_row.id
  );

  return new;
end;
$$;

drop trigger if exists project_assignees_notify on public.project_assignees;
create trigger project_assignees_notify
  after insert on public.project_assignees
  for each row execute procedure public.notify_project_assignee_added();
