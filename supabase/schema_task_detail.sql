-- Pipeline: full task detail page support
-- Run this AFTER schema_activity_log.sql and schema_realtime_notifications.sql.
-- Safe to re-run: every policy/trigger is dropped and recreated, columns
-- and tables use IF NOT EXISTS.
--
-- Lets a task exist without a project (a standalone task, with its own
-- client info), gives tasks multiple assignees with optional role labels,
-- a forum-style notes thread, manual links to other related tasks, and
-- lets an invoice be tied to one specific task instead of only ever the
-- whole project.

-- ============================================================
-- 1. Tasks: allow standalone (no project), add client info + start date
-- ============================================================
alter table public.tasks alter column project_id drop not null;
alter table public.tasks
  add column if not exists client_name text,
  add column if not exists client_website text,
  add column if not exists brand_guidelines text,
  add column if not exists start_date date;

-- So a project-linked task can show the same client-website field a
-- standalone task has, inherited from its project rather than repeated.
alter table public.projects add column if not exists client_website text;


-- ============================================================
-- 2. Multiple assignees per task, each with an optional role label
-- ============================================================
-- Deliberately kept separate from the existing tasks.assignee_id column
-- rather than replacing it — assignee_id stays as the simple "who's on
-- this" used in project task rows, My Tasks, and notifications (all
-- already working); this table is the richer list managed on the task's
-- own detail page. The two aren't kept in sync automatically.
create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_label text,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_assignees enable row level security;

drop policy if exists "org members can view task assignees" on public.task_assignees;
create policy "org members can view task assignees"
  on public.task_assignees for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can add task assignees" on public.task_assignees;
create policy "org members can add task assignees"
  on public.task_assignees for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can remove task assignees" on public.task_assignees;
create policy "org members can remove task assignees"
  on public.task_assignees for delete
  to authenticated
  using (public.is_org_member(org_id));


-- ============================================================
-- 3. Task notes — a forum-style thread, same pattern as ticket_comments
-- ============================================================
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.task_comments enable row level security;

drop policy if exists "org members can view task notes" on public.task_comments;
create policy "org members can view task notes"
  on public.task_comments for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can post task notes" on public.task_comments;
create policy "org members can post task notes"
  on public.task_comments for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "authors can update own task notes" on public.task_comments;
create policy "authors can update own task notes"
  on public.task_comments for update
  to authenticated
  using (author_id = auth.uid());

drop policy if exists "authors can delete own task notes" on public.task_comments;
create policy "authors can delete own task notes"
  on public.task_comments for delete
  to authenticated
  using (author_id = auth.uid());

create index if not exists task_comments_task_id_idx on public.task_comments(task_id);


-- ============================================================
-- 4. Manual task-to-task relations (works across different projects)
-- ============================================================
-- Symmetric by convention: linking A<->B inserts both (A,B) and (B,A) rows
-- from the app layer, so a simple "where task_id = X" query returns the
-- full related list regardless of which side the link was created from —
-- no UNION/OR needed at read time. Unlinking removes both rows the same way.
create table if not exists public.task_relations (
  task_id uuid not null references public.tasks(id) on delete cascade,
  related_task_id uuid not null references public.tasks(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, related_task_id),
  check (task_id <> related_task_id)
);

alter table public.task_relations enable row level security;

drop policy if exists "org members can view task relations" on public.task_relations;
create policy "org members can view task relations"
  on public.task_relations for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can add task relations" on public.task_relations;
create policy "org members can add task relations"
  on public.task_relations for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can remove task relations" on public.task_relations;
create policy "org members can remove task relations"
  on public.task_relations for delete
  to authenticated
  using (public.is_org_member(org_id));


-- ============================================================
-- 5. Invoices can link to one specific task, not just the whole project
-- ============================================================
alter table public.invoices add column if not exists task_id uuid references public.tasks(id) on delete set null;
-- on delete set null (not cascade): deleting a task should never delete a
-- financial record — it just becomes unlinked, same philosophy already
-- used for project_id on invoices.


-- ============================================================
-- 6. Activity log: track start_date changes too (extends the existing
-- task trigger from schema_activity_log.sql; the create-or-replace below
-- fully supersedes it)
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
    if old.start_date is distinct from new.start_date then
      changes := changes || format('Start date: %s -> %s. ', coalesce(old.start_date::text, 'none'), coalesce(new.start_date::text, 'none'));
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
-- Trigger itself already exists (tasks_log_activity, from schema_activity_log.sql)
-- and doesn't need recreating — only the function body changed.


-- ============================================================
-- 7. Activity log: track the multi-assignee list changing too
-- ============================================================
create or replace function public.log_task_assignee_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  person_name text;
  task_row record;
begin
  if TG_OP = 'INSERT' then
    select * into task_row from public.tasks where id = new.task_id;
    if not found then return new; end if;
    select full_name into person_name from public.profiles where id = new.user_id;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (
      new.org_id, task_row.project_id, 'task', new.task_id, task_row.title, actor, 'updated',
      format('Added %s%s', coalesce(person_name, 'someone'), case when new.role_label is not null then ' (' || new.role_label || ')' else '' end)
    );
    return new;

  elsif TG_OP = 'DELETE' then
    select * into task_row from public.tasks where id = old.task_id;
    if not found then return old; end if;
    select full_name into person_name from public.profiles where id = old.user_id;
    insert into public.activity_log (org_id, project_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (
      old.org_id, task_row.project_id, 'task', old.task_id, task_row.title, actor, 'updated',
      format('Removed %s as assignee', coalesce(person_name, 'someone'))
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists task_assignees_log_activity on public.task_assignees;
create trigger task_assignees_log_activity
  after insert or delete on public.task_assignees
  for each row execute procedure public.log_task_assignee_activity();


-- ============================================================
-- 8. Notify when someone is added as a task assignee (multi-assignee list)
-- ============================================================
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('task_assigned', 'ticket_comment', 'client_ticket_submitted', 'task_comment'));

create or replace function public.notify_task_assignee_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  task_row record;
begin
  if new.user_id = actor then
    return new; -- don't notify someone for adding themselves
  end if;

  select * into task_row from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = actor;

  insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
  values (
    new.org_id, new.user_id, actor, 'task_assigned',
    coalesce(actor_name, 'Someone') || ' added you to a task',
    task_row.title,
    '/tasks/' || task_row.id
  );

  return new;
end;
$$;

drop trigger if exists task_assignees_notify on public.task_assignees;
create trigger task_assignees_notify
  after insert on public.task_assignees
  for each row execute procedure public.notify_task_assignee_added();


-- ============================================================
-- 9. Notify on a new task note (mirrors notify_ticket_comment)
-- ============================================================
create or replace function public.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  task_row record;
  body_snippet text;
  recipient record;
  already_notified uuid[] := array[new.author_id];
begin
  select * into task_row from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = new.author_id;
  body_snippet := left(new.body, 140);

  -- Notify the simple primary assignee, if set and not the commenter.
  if task_row.assignee_id is not null and not (task_row.assignee_id = any(already_notified)) then
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (task_row.org_id, task_row.assignee_id, new.author_id, 'task_comment',
            coalesce(actor_name, 'Someone') || ' added a note to a task assigned to you',
            body_snippet, '/tasks/' || task_row.id);
    already_notified := already_notified || task_row.assignee_id;
  end if;

  -- Also notify everyone in the richer multi-assignee list, skipping
  -- anyone already notified above.
  for recipient in select user_id from public.task_assignees where task_id = new.task_id loop
    if not (recipient.user_id = any(already_notified)) then
      insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
      values (task_row.org_id, recipient.user_id, new.author_id, 'task_comment',
              coalesce(actor_name, 'Someone') || ' added a note to a task assigned to you',
              body_snippet, '/tasks/' || task_row.id);
      already_notified := already_notified || recipient.user_id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify
  after insert on public.task_comments
  for each row execute procedure public.notify_task_comment();
