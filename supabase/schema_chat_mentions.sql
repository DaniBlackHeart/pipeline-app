-- Pipeline: chat @mentions
-- Run this AFTER schema_chat.sql and schema_chat_read_state.sql.
-- Safe to re-run.
--
-- Mentions are tracked explicitly (which user IDs were tagged), not
-- derived by re-parsing message text later -- the composer already
-- knows exactly who was selected via the @ autocomplete at send time,
-- so that's what gets stored. This survives a mentioned person's
-- display name changing later and avoids any ambiguity from two people
-- sharing a name.

-- ============================================================
-- 1. CHAT_MESSAGE_MENTIONS
-- ============================================================
create table if not exists public.chat_message_mentions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (message_id, mentioned_user_id)
);

-- Reverse-lookup index, same repeated lesson from task_assignees,
-- chat_conversation_participants, and chat_conversation_reads before it:
-- the primary key alone (message_id leading) doesn't serve "everywhere
-- this user was mentioned," which is exactly what the notification
-- trigger and the mention-count query below both need.
create index if not exists chat_message_mentions_user_id_idx
  on public.chat_message_mentions(mentioned_user_id);

alter table public.chat_message_mentions enable row level security;

drop policy if exists "conversation members can view mentions" on public.chat_message_mentions;
create policy "conversation members can view mentions"
  on public.chat_message_mentions for select
  to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id and public.can_access_chat_conversation(m.conversation_id)
    )
  );

-- Only the actual sender of a message can attach mention rows to it --
-- stops anyone from tagging themselves (or anyone else) as mentioned in
-- a message they didn't send, which would otherwise be a way to
-- generate fake notifications for other people.
drop policy if exists "senders can tag mentions on their own messages" on public.chat_message_mentions;
create policy "senders can tag mentions on their own messages"
  on public.chat_message_mentions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id and m.sender_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.chat_message_mentions;

-- ============================================================
-- 2. NOTIFY THE MENTIONED PERSON (bell)
-- ============================================================
-- Extend notifications' existing type check rather than adding a new
-- table -- 'chat_mention' slots into the same bell, same as
-- 'task_assigned'/'ticket_comment'/'client_ticket_submitted' already do.
--
-- Found and dropped by its actual definition rather than by guessing
-- Postgres's auto-generated name (notifications_type_check) and using
-- IF EXISTS on that guess: if the guess were ever wrong, IF EXISTS would
-- silently no-op, the ADD CONSTRAINT below would still succeed under
-- that name, and the ORIGINAL constraint (still active under its real
-- name) would keep rejecting 'chat_mention' anyway -- a silent,
-- hard-to-debug failure. Matching on the literal 'task_assigned' value
-- inside the constraint's definition finds the real one regardless of
-- what it's actually named.
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'notifications'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%task_assigned%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table public.notifications drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.notifications add constraint notifications_type_check
  check (type in ('task_assigned', 'ticket_comment', 'client_ticket_submitted', 'chat_mention'));

-- Same shape as notify_task_assignment()/notify_ticket_comment() in
-- schema_realtime_notifications.sql: security-definer trigger, snapshots
-- title/body at write time, no direct client insert policy on
-- notifications at all.
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
    -- Not found is defensive (shouldn't happen given the FK); mentioning
    -- yourself shouldn't notify yourself either way.
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

  return new;
end;
$$;

drop trigger if exists chat_mentions_notify on public.chat_message_mentions;
create trigger chat_mentions_notify
  after insert on public.chat_message_mentions
  for each row execute procedure public.notify_chat_mention();

-- ============================================================
-- 3. EXTEND UNREAD COUNTS WITH A MENTION COUNT
-- ============================================================
-- Return type is changing (an added column), which CREATE OR REPLACE
-- can't do -- must drop first.
drop function if exists public.get_unread_chat_counts(uuid);

create or replace function public.get_unread_chat_counts(target_org_id uuid)
returns table(conversation_id uuid, unread_count bigint, mention_count bigint)
language sql
stable
as $$
  select
    m.conversation_id,
    count(*) as unread_count,
    count(*) filter (where mn.message_id is not null) as mention_count
  from public.chat_messages m
  left join public.chat_conversation_reads r
    on r.conversation_id = m.conversation_id and r.user_id = auth.uid()
  left join public.chat_message_mentions mn
    on mn.message_id = m.id and mn.mentioned_user_id = auth.uid()
  where m.org_id = target_org_id
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  group by m.conversation_id;
$$;

grant execute on function public.get_unread_chat_counts(uuid) to authenticated;
