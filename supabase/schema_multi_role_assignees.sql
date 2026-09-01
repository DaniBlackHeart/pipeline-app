-- Pipeline: let one person hold more than one role on the same project/task
-- Safe to re-run.
--
-- project_assignees and task_assignees both had a composite primary key
-- of (project_id/task_id, user_id) -- one row per person, full stop,
-- regardless of role. That meant picking someone for a second role
-- (either a second fixed slot, or an extra "+ Add member" row) had to
-- *move* them there and clear whatever they held before, since a second
-- row for the same person would violate that primary key. For a small
-- team -- or a solo freelancer working a project alone -- that's wrong:
-- one person legitimately needs to hold every role sometimes.
--
-- Fix: replace the composite primary key with a surrogate id, and add a
-- (project_id/task_id, user_id, role_label) unique constraint instead.
-- Same person, different role_label, is now two separate rows. The same
-- person with the exact same role_label twice still isn't allowed --
-- that would just be a literal duplicate of the same assignment.

-- ============================================================
-- 1. project_assignees
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'project_assignees'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name = 'id'
  ) then
    alter table public.project_assignees add column if not exists id uuid default gen_random_uuid();
    update public.project_assignees set id = gen_random_uuid() where id is null;
    alter table public.project_assignees alter column id set not null;
    alter table public.project_assignees drop constraint if exists project_assignees_pkey;
    alter table public.project_assignees add constraint project_assignees_pkey primary key (id);
  end if;
end $$;

alter table public.project_assignees drop constraint if exists project_assignees_user_role_unique;
alter table public.project_assignees add constraint project_assignees_user_role_unique
  unique (project_id, user_id, role_label);

-- ============================================================
-- 2. task_assignees
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'task_assignees'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name = 'id'
  ) then
    alter table public.task_assignees add column if not exists id uuid default gen_random_uuid();
    update public.task_assignees set id = gen_random_uuid() where id is null;
    alter table public.task_assignees alter column id set not null;
    alter table public.task_assignees drop constraint if exists task_assignees_pkey;
    alter table public.task_assignees add constraint task_assignees_pkey primary key (id);
  end if;
end $$;

alter table public.task_assignees drop constraint if exists task_assignees_user_role_unique;
alter table public.task_assignees add constraint task_assignees_user_role_unique
  unique (task_id, user_id, role_label);
