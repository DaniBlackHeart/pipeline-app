-- Pipeline: team chat (org channel, project/task threads, direct messages)
-- Run this AFTER the other schema files.
-- Safe to re-run: every policy is dropped and recreated, tables/indexes use
-- IF NOT EXISTS.
--
-- Deliberately a new, separate feature from task_comments/ticket_comments
-- (the existing "Notes" threads) rather than an upgrade to those — team
-- members only, no client access. Three conversation shapes share one
-- schema:
--   'org'     — one shared channel per organization
--   'project' — one thread per project
--   'task'    — one thread per task
--   'dm'      — direct messages between exactly two people
--
-- org/project/task conversations follow the same org-wide RLS precedent
-- already established for tasks/projects/comments elsewhere in this app
-- (any org member can see them — the UI, not RLS, is the relevance
-- filter). DMs are the one genuinely different case: RLS restricts them
-- to their two participants specifically, which is why they need their
-- own participants table and a security-definer function to create one
-- without a chicken-and-egg RLS problem (see below).
--
-- Section order matters here and is deliberate: tables and indexes first,
-- then helper functions, then RLS policies. CREATE POLICY validates that
-- any function its USING/WITH CHECK clause references already exists at
-- the moment that policy is created — unlike a function's own body, which
-- isn't checked against schema objects until the function is actually
-- called. The first version of this file created policies before the
-- functions they reference and failed with "function ... does not exist"
-- as a result; fixed by reordering, not by changing what anything does.

-- ============================================================
-- 1. TABLES + INDEXES
-- ============================================================

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('org', 'project', 'task', 'dm')),
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint chat_conversations_shape check (
    (type = 'org'     and project_id is null     and task_id is null) or
    (type = 'project' and project_id is not null and task_id is null) or
    (type = 'task'    and task_id is not null    and project_id is null) or
    (type = 'dm'      and project_id is null     and task_id is null)
  )
);

-- One conversation per org/project/task -- also doubles as the exact
-- index each lookup needs (get-or-create queries filter on these same
-- columns), so this closes the "forgot the index" mistake found and
-- fixed in a previous session before it could happen here too.
create unique index if not exists chat_conversations_org_channel_idx
  on public.chat_conversations(org_id) where type = 'org';
create unique index if not exists chat_conversations_project_thread_idx
  on public.chat_conversations(project_id) where type = 'project';
create unique index if not exists chat_conversations_task_thread_idx
  on public.chat_conversations(task_id) where type = 'task';

create table if not exists public.chat_conversation_participants (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- The primary key above covers "who's in conversation X" (conversation_id
-- leading). This covers the other direction -- "which DMs is user X in" --
-- which the primary key alone can't serve, same lesson as
-- task_assignees.user_id from a previous session's RLS-performance fix.
create index if not exists chat_conversation_participants_user_id_idx
  on public.chat_conversation_participants(user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

-- Primary access pattern: ordered messages within one conversation.
create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages(conversation_id, created_at);

-- Hygiene index, not an active query path today (every real fetch goes
-- through conversation_id above) -- added now anyway per the same
-- RLS-performance lesson: org_id is what RLS actually filters on, so it
-- gets its own index even though the app-level query routes through a
-- different indexed column first.
create index if not exists chat_messages_org_id_idx
  on public.chat_messages(org_id);

-- ============================================================
-- 2. HELPER FUNCTIONS
-- ============================================================

-- Mirrors is_org_member()/is_org_admin()'s existing shape: a small,
-- reusable, security-definer boolean check, used anywhere a DM's access
-- needs verifying.
create or replace function public.is_dm_participant(check_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.chat_conversation_participants
    where conversation_id = check_conversation_id and user_id = auth.uid()
  );
$$;

-- One check usable by both chat_messages policies regardless of which of
-- the four conversation types is being accessed, so that branching logic
-- lives in exactly one place rather than being repeated per policy.
create or replace function public.can_access_chat_conversation(check_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case c.type
    when 'dm' then public.is_dm_participant(c.id)
    else public.is_org_member(c.org_id)
  end
  from public.chat_conversations c
  where c.id = check_conversation_id;
$$;

-- Solves the DM chicken-and-egg problem: a freshly-inserted 'dm'
-- conversation row has no participants yet, so its own SELECT policy
-- would block even its creator from reading it back before the
-- participant rows exist. Running the whole thing as one security-definer
-- transaction sidesteps that entirely -- RLS never gets a chance to block
-- an in-progress creation.
--
-- Also the only place that decides "is this actually a new DM, or does
-- one already exist between these two people in this org" -- get-or-create
-- semantics, safe to call repeatedly, matching every other lazy-create
-- pattern in this schema (org/project/task conversations use a plain
-- client-side get-or-create against their unique index instead, since
-- they don't have this same RLS chicken-and-egg issue).
create or replace function public.get_or_create_dm_conversation(target_org_id uuid, other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  new_id uuid;
begin
  if other_user_id = auth.uid() then
    raise exception 'Cannot start a conversation with yourself';
  end if;

  if not public.is_org_member(target_org_id) then
    raise exception 'Not a member of this organization';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = target_org_id and user_id = other_user_id
  ) then
    raise exception 'That person is not a member of this organization';
  end if;

  select c.id into existing_id
  from public.chat_conversations c
  where c.org_id = target_org_id
    and c.type = 'dm'
    and exists (
      select 1 from public.chat_conversation_participants p1
      where p1.conversation_id = c.id and p1.user_id = auth.uid()
    )
    and exists (
      select 1 from public.chat_conversation_participants p2
      where p2.conversation_id = c.id and p2.user_id = other_user_id
    )
    and (
      select count(*) from public.chat_conversation_participants p
      where p.conversation_id = c.id
    ) = 2
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.chat_conversations (org_id, type, created_by)
  values (target_org_id, 'dm', auth.uid())
  returning id into new_id;

  insert into public.chat_conversation_participants (conversation_id, user_id)
  values (new_id, auth.uid()), (new_id, other_user_id);

  return new_id;
end;
$$;

grant execute on function public.get_or_create_dm_conversation(uuid, uuid) to authenticated;

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

alter table public.chat_conversations enable row level security;

drop policy if exists "org members can view non-dm conversations" on public.chat_conversations;
create policy "org members can view non-dm conversations"
  on public.chat_conversations for select
  to authenticated
  using (type <> 'dm' and public.is_org_member(org_id));

drop policy if exists "participants can view their dm conversations" on public.chat_conversations;
create policy "participants can view their dm conversations"
  on public.chat_conversations for select
  to authenticated
  using (type = 'dm' and public.is_dm_participant(id));

-- Any org member can create the shared org/project/task container --
-- matches the existing precedent that non-admins can freely participate
-- in comment threads. DMs are deliberately excluded here: they can only
-- be created through get_or_create_dm_conversation() above, which
-- atomically creates the conversation AND both participant rows so
-- nobody can end up with a DM conversation that has no participants yet.
drop policy if exists "org members can create shared conversations" on public.chat_conversations;
create policy "org members can create shared conversations"
  on public.chat_conversations for insert
  to authenticated
  with check (type <> 'dm' and public.is_org_member(org_id));

-- Deliberately no update/delete policy for v1 -- conversations are
-- permanent once created (no renaming/archiving yet).

alter table public.chat_conversation_participants enable row level security;

drop policy if exists "participants can view their conversation's roster" on public.chat_conversation_participants;
create policy "participants can view their conversation's roster"
  on public.chat_conversation_participants for select
  to authenticated
  using (public.is_dm_participant(conversation_id));

-- Deliberately no insert/update/delete policy for `authenticated` at all
-- -- the only way rows are ever created is inside
-- get_or_create_dm_conversation()'s security-definer context above, same
-- reasoning as notifications' insert-free policy set.

alter table public.chat_messages enable row level security;

drop policy if exists "conversation members can view messages" on public.chat_messages;
create policy "conversation members can view messages"
  on public.chat_messages for select
  to authenticated
  using (public.can_access_chat_conversation(conversation_id));

drop policy if exists "conversation members can send messages" on public.chat_messages;
create policy "conversation members can send messages"
  on public.chat_messages for insert
  to authenticated
  with check (sender_id = auth.uid() and public.can_access_chat_conversation(conversation_id));

-- Deliberately no update/delete policy for v1 -- messages are immutable
-- once sent (no editing or deleting a sent message yet).

-- ============================================================
-- 4. REALTIME
-- ============================================================
-- Required for the frontend's live subscription to receive anything --
-- RLS above still governs what each connected client actually receives;
-- this only turns the broadcast on. Same pattern as
-- schema_realtime_notifications.sql / schema_activity_log.sql.
alter publication supabase_realtime add table public.chat_messages;
