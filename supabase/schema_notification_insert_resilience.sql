-- Pipeline: make every notification insert best-effort
-- Safe to re-run: every function below is `create or replace`, nothing
-- else changes.
--
-- Discovered while adding schema_admin_mfa_reset.sql: every trigger that
-- writes to public.notifications does a plain, unguarded `insert into
-- notifications (...)`. If that insert fails for ANY reason -- most
-- concretely, a `type` value the current notifications_type_check
-- constraint doesn't (yet) allow, but this generalizes to anything, e.g.
-- a future NOT NULL column, a bad FK -- the exception propagates out of
-- an AFTER INSERT/UPDATE trigger and rolls back the entire original
-- operation. In plain terms: adding a note to a task, commenting on a
-- ticket, assigning someone to a project, or being @mentioned in chat
-- would all have hard-failed for the *user performing the action*, not
-- just silently skipped sending a notification -- e.g. someone leaving a
-- comment or their whole comment failing to save, with no obvious reason
-- why to someone looking at just the app.
--
-- This is exactly what happened here: schema_project_requirements.sql,
-- schema_task_detail.sql, and schema_chat_mentions.sql each widened
-- notifications_type_check with only their own new type added to the
-- ORIGINAL three from schema_realtime_notifications.sql, silently
-- dropping whichever type the migration before it had added (see the
-- long comment in schema_admin_mfa_reset.sql for the full history). On
-- a database where those types had already been used for real, that
-- meant 'task_comment' and 'project_assigned' notifications started
-- failing outright the moment a later migration's narrower constraint
-- took effect -- which likely means task notes and project-assignment
-- notifications, and possibly the primary actions themselves, may have
-- been silently broken on this deployment for a while, not just the
-- constraint-widening migration you just tried to run.
--
-- The constraint mismatch itself is now fixed for good going forward
-- (schema_admin_mfa_reset.sql lists every type ever used, with a loud
-- comment about carrying the full list forward). This file is the other
-- half: making sure that even if something like this happens again --
-- from any cause, not just this one -- it can only ever cost a missing
-- notification, never the action the user was actually trying to take.
-- Each insert now runs inside its own nested block, which Postgres
-- treats as an implicit subtransaction: an exception there rolls back
-- only that insert, not the trigger's caller. A failure still isn't
-- silent -- it's logged via RAISE WARNING, visible in Supabase's
-- Postgres logs -- it just no longer blocks the person's actual click.

-- ============================================================
-- 1. Task assignment (schema_realtime_notifications.sql)
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

  if target_assignee is null or target_assignee = actor then
    return new;
  end if;

  if TG_OP = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = actor;

  begin
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
  exception when others then
    raise warning 'notify_task_assignment: notification insert failed, action proceeded anyway: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ============================================================
-- 2. Ticket comment (schema_realtime_notifications.sql)
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

  if ticket_row.assignee_id is not null and ticket_row.assignee_id <> new.author_id then
    begin
      insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
      values (
        ticket_row.org_id, ticket_row.assignee_id, new.author_id, 'ticket_comment',
        coalesce(actor_name, 'Someone') || ' commented on a ticket assigned to you',
        body_snippet, '/tickets/' || ticket_row.id
      );
    exception when others then
      raise warning 'notify_ticket_comment (assignee): notification insert failed, action proceeded anyway: %', sqlerrm;
    end;
  end if;

  if ticket_row.created_by is not null
     and ticket_row.created_by <> new.author_id
     and ticket_row.created_by is distinct from ticket_row.assignee_id then
    begin
      insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
      values (
        ticket_row.org_id, ticket_row.created_by, new.author_id, 'ticket_comment',
        coalesce(actor_name, 'Someone') || ' commented on your ticket',
        body_snippet, '/tickets/' || ticket_row.id
      );
    exception when others then
      raise warning 'notify_ticket_comment (creator): notification insert failed, action proceeded anyway: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- ============================================================
-- 3. Client-submitted ticket (schema_realtime_notifications.sql)
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
    begin
      insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
      values (new.org_id, admin_row.user_id, null, 'client_ticket_submitted', notif_title, new.title, '/tickets/' || new.id);
    exception when others then
      raise warning 'notify_client_ticket: notification insert failed for one admin, continuing to the rest: %', sqlerrm;
    end;
  end loop;

  return new;
end;
$$;

-- ============================================================
-- 4. Task assignee added (schema_task_detail.sql)
-- ============================================================
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
    return new;
  end if;

  select * into task_row from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  select full_name into actor_name from public.profiles where id = actor;

  begin
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (
      new.org_id, new.user_id, actor, 'task_assigned',
      coalesce(actor_name, 'Someone') || ' added you to a task',
      task_row.title,
      '/tasks/' || task_row.id
    );
  exception when others then
    raise warning 'notify_task_assignee_added: notification insert failed, action proceeded anyway: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ============================================================
-- 5. Task note/comment (schema_task_detail.sql)
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

  if task_row.assignee_id is not null and not (task_row.assignee_id = any(already_notified)) then
    begin
      insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
      values (task_row.org_id, task_row.assignee_id, new.author_id, 'task_comment',
              coalesce(actor_name, 'Someone') || ' added a note to a task assigned to you',
              body_snippet, '/tasks/' || task_row.id);
    exception when others then
      raise warning 'notify_task_comment (primary assignee): notification insert failed, action proceeded anyway: %', sqlerrm;
    end;
    already_notified := already_notified || task_row.assignee_id;
  end if;

  for recipient in select user_id from public.task_assignees where task_id = new.task_id loop
    if not (recipient.user_id = any(already_notified)) then
      begin
        insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
        values (task_row.org_id, recipient.user_id, new.author_id, 'task_comment',
                coalesce(actor_name, 'Someone') || ' added a note to a task assigned to you',
                body_snippet, '/tasks/' || task_row.id);
      exception when others then
        raise warning 'notify_task_comment (multi-assignee): notification insert failed for one recipient, continuing to the rest: %', sqlerrm;
      end;
      already_notified := already_notified || recipient.user_id;
    end if;
  end loop;

  return new;
end;
$$;

-- ============================================================
-- 6. Project assignee added (schema_project_requirements.sql)
-- ============================================================
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

  begin
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (
      new.org_id, new.user_id, actor, 'project_assigned',
      coalesce(actor_name, 'Someone') || ' added you to a project',
      project_row.name,
      '/projects/' || project_row.id
    );
  exception when others then
    raise warning 'notify_project_assignee_added: notification insert failed, action proceeded anyway: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ============================================================
-- 7. Chat @mention (schema_chat_mentions.sql)
-- ============================================================
create or replace function public.notify_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
  sender_name text;
  body_snippet text;
  conv_label text;
begin
  select * into msg from public.chat_messages where id = new.message_id;
  if not found or msg.sender_id = new.mentioned_user_id then
    return new;
  end if;

  select full_name into sender_name from public.profiles where id = msg.sender_id;
  body_snippet := left(msg.body, 140);

  select case c.type
    when 'org' then 'General'
    when 'project' then p.name
    when 'task' then t.title
    else null
  end
  into conv_label
  from public.chat_conversations c
  left join public.projects p on p.id = c.project_id
  left join public.tasks t on t.id = c.task_id
  where c.id = msg.conversation_id;

  begin
    insert into public.notifications (org_id, user_id, actor_id, type, title, body, link_path)
    values (
      msg.org_id,
      new.mentioned_user_id,
      msg.sender_id,
      'chat_mention',
      coalesce(sender_name, 'Someone') || ' mentioned you' || coalesce(' in ' || conv_label, ''),
      body_snippet,
      '/chat?conversation=' || msg.conversation_id
    );
  exception when others then
    raise warning 'notify_chat_mention: notification insert failed, action proceeded anyway: %', sqlerrm;
  end;

  return new;
end;
$$;
