-- Pipeline: real-time in-app notifications (the notification bell)
-- Run this AFTER the other schema files, including schema_ticketing.sql
-- and schema_client_tickets.sql.
-- Safe to re-run: every policy is dropped and recreated, tables use IF NOT EXISTS.
--
-- Distinct from schema_notifications.sql, which stores per-person
-- daily-digest email preferences. This file is about the in-app bell —
-- instant, live, no email involved. The two are meant to complement each
-- other: the bell for "I'm using the app right now", the digest for
-- "I wasn't looking, catch me up once a day."

-- ============================================================
-- 1. NOTIFICATIONS
-- ============================================================
-- title/body/link_path are snapshotted at write time (same reasoning as
-- task_activity_log's task_title) rather than joined at read time — the
-- notification should still read sensibly even if the task/ticket it
-- refers to is later renamed or deleted.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  type text not null check (type in ('task_assigned', 'ticket_comment', 'client_ticket_submitted')),
  title text not null,
  body text,
  link_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- Recipients only ever see their own notifications — not even other
-- members of the same org. No insert policy for `authenticated` at all;
-- every row is written by a security-definer trigger below, never
-- directly by client code.
drop policy if exists "users can view their own notifications" on public.notifications;
create policy "users can view their own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can mark their own notifications read" on public.notifications;
create policy "users can mark their own notifications read"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, read_at);

-- Required for the frontend's live subscription to receive anything at
-- all — a table isn't part of Realtime's broadcast until it's added to
-- this publication. RLS above still governs what each connected client
-- actually receives; this only turns the broadcast on.
alter publication supabase_realtime add table public.notifications;


-- ============================================================
-- 2. Task assignment -> notify the new assignee
-- ============================================================
create or replace function public.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  target_assignee uuid;
begin
  target_assignee := new.assignee_id;

  -- Only act when there's actually a new assignee, and skip notifying
  -- someone for assigning a task to themselves.
  if target_assignee is null or target_assignee = actor then
    return new;
  end if;

  -- For UPDATE, only fire when the assignee actually changed — not on
  -- every unrelated edit to the row.
  if TG_OP = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = actor;

  insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
  values (
    new.org_id,
    target_assignee,
    actor,
    'task_assigned',
    coalesce(actor_name, 'Someone') || ' assigned you a task',
    new.title,
    '/projects/' || new.project_id
  );

  return new;
end;
$$;

drop trigger if exists tasks_notify_assignment on public.tasks;
create trigger tasks_notify_assignment
  after insert or update on public.tasks
  for each row execute procedure public.notify_task_assignment();


-- ============================================================
-- 3. Ticket comment -> notify the ticket's assignee and creator
-- ============================================================
create or replace function public.notify_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  ticket_row record;
  body_snippet text;
begin
  select * into ticket_row from public.tickets where id = new.ticket_id;
  if not found then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = new.author_id;
  body_snippet := left(new.body, 140);

  -- Notify the assignee, unless they're the one who just commented.
  if ticket_row.assignee_id is not null and ticket_row.assignee_id <> new.author_id then
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (
      ticket_row.org_id, ticket_row.assignee_id, new.author_id, 'ticket_comment',
      coalesce(actor_name, 'Someone') || ' commented on a ticket assigned to you',
      body_snippet, '/tickets/' || ticket_row.id
    );
  end if;

  -- Also notify whoever filed the ticket, if that's a different person
  -- than both the commenter and the assignee (avoid double-notifying the
  -- same person twice for one comment).
  if ticket_row.created_by is not null
     and ticket_row.created_by <> new.author_id
     and ticket_row.created_by is distinct from ticket_row.assignee_id then
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (
      ticket_row.org_id, ticket_row.created_by, new.author_id, 'ticket_comment',
      coalesce(actor_name, 'Someone') || ' commented on your ticket',
      body_snippet, '/tickets/' || ticket_row.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists ticket_comments_notify on public.ticket_comments;
create trigger ticket_comments_notify
  after insert on public.ticket_comments
  for each row execute procedure public.notify_ticket_comment();


-- ============================================================
-- 4. Client-submitted ticket -> notify org admins/owners
-- ============================================================
create or replace function public.notify_client_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row record;
  notif_title text;
begin
  if not new.submitted_by_client then
    return new;
  end if;

  notif_title := case
    when new.client_name is not null then new.client_name || ' filed a new ticket'
    else 'New ticket from a client'
  end;

  for admin_row in
    select user_id from public.org_members
    where org_id = new.org_id and role in ('owner', 'admin')
  loop
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (new.org_id, admin_row.user_id, null, 'client_ticket_submitted', notif_title, new.title, '/tickets/' || new.id);
  end loop;

  return new;
end;
$$;

drop trigger if exists tickets_notify_client_submission on public.tickets;
create trigger tickets_notify_client_submission
  after insert on public.tickets
  for each row execute procedure public.notify_client_ticket();
