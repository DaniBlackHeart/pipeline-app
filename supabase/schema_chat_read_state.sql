-- Pipeline: chat unread tracking (Slack/Messenger-style badges)
-- Run this AFTER schema_chat.sql.
-- Safe to re-run.

create table if not exists public.chat_conversation_reads (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Reverse-lookup index -- same lesson as chat_conversation_participants
-- and task_assignees before it: the primary key alone (conversation_id
-- leading) doesn't serve "all of this user's read state," which is
-- exactly the shape get_unread_chat_counts() below needs.
create index if not exists chat_conversation_reads_user_id_idx
  on public.chat_conversation_reads(user_id);

alter table public.chat_conversation_reads enable row level security;

drop policy if exists "users manage their own read state" on public.chat_conversation_reads;
create policy "users manage their own read state"
  on public.chat_conversation_reads for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Deliberately not checked against can_access_chat_conversation() here --
-- a read-state row is just a personal bookmark ("when did I last look at
-- this"), not access to message content. Someone writing a bookmark for
-- a conversation they can't actually read is harmless: they still can't
-- see any messages, since chat_messages' own RLS is what actually gates
-- that, unaffected by anything in this table.

-- One row per conversation the caller can currently access, with a count
-- of messages sent by someone else since they last marked it read.
-- Deliberately NOT security definer -- this runs with the caller's own
-- privileges specifically so chat_messages' existing RLS keeps doing its
-- normal job (only counting messages from conversations they can
-- actually access) rather than that access logic needing to be
-- re-implemented inside this function too.
create or replace function public.get_unread_chat_counts(target_org_id uuid)
returns table(conversation_id uuid, unread_count bigint)
language sql
stable
as $$
  select
    m.conversation_id,
    count(*) as unread_count
  from public.chat_messages m
  left join public.chat_conversation_reads r
    on r.conversation_id = m.conversation_id and r.user_id = auth.uid()
  where m.org_id = target_org_id
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  group by m.conversation_id;
$$;

grant execute on function public.get_unread_chat_counts(uuid) to authenticated;
