-- Pipeline: client-facing ticket submission
-- Run this AFTER the other schema files, including schema_client_sharing.sql
-- and schema_ticketing.sql.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.
--
-- Same design as schema_client_sharing.sql: rather than opening RLS to the
-- `anon` role on the tickets table directly, the only public-facing surface
-- is one narrow function that does exactly one thing — file a ticket
-- against the project matching a given share token, with sensible limits.
-- The tickets table's own RLS is completely untouched; anon still has zero
-- direct read/write access to it.

-- ============================================================
-- 1. Mark which tickets came in from a client, and how to reach them
-- ============================================================
alter table public.tickets
  add column if not exists submitted_by_client boolean not null default false,
  add column if not exists client_name text,
  add column if not exists client_email text;


-- ============================================================
-- 2. The public submission function
-- ============================================================
create or replace function public.submit_client_ticket(
  share_token uuid,
  submitter_name text,
  submitter_email text,
  ticket_type text,
  ticket_title text,
  ticket_description text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row record;
  recent_count int;
  safe_type text;
begin
  select * into project_row from public.projects where public_token = share_token;
  if not found then
    raise exception 'Invalid link';
  end if;

  if ticket_title is null or length(trim(ticket_title)) = 0 then
    raise exception 'A title is required';
  end if;
  if length(ticket_title) > 200 then
    raise exception 'Title is too long (200 characters max)';
  end if;
  if ticket_description is not null and length(ticket_description) > 5000 then
    raise exception 'Description is too long (5000 characters max)';
  end if;

  -- Only allow a type the tickets table itself already recognizes; fall
  -- back to 'other' for anything unexpected rather than letting a bad
  -- value 500 the request.
  safe_type := case
    when ticket_type in ('bug', 'request', 'question', 'other') then ticket_type
    else 'other'
  end;

  -- Basic abuse guard: caps client submissions per project to a modest
  -- rate. This is intentionally simple — no IP tracking, no CAPTCHA — just
  -- enough to blunt a runaway script or an accidental double-submit, not a
  -- determined attacker. Revisit if this ever becomes a real problem.
  select count(*) into recent_count
  from public.tickets
  where project_id = project_row.id
    and submitted_by_client = true
    and created_at > now() - interval '10 minutes';

  if recent_count >= 5 then
    raise exception 'Too many submissions recently — please try again in a few minutes.';
  end if;

  insert into public.tickets (
    org_id, project_id, title, description, type, priority, status,
    submitted_by_client, client_name, client_email
  )
  values (
    project_row.org_id,
    project_row.id,
    trim(ticket_title),
    nullif(trim(coalesce(ticket_description, '')), ''),
    safe_type,
    'medium',
    'open',
    true,
    nullif(trim(coalesce(submitter_name, '')), ''),
    nullif(trim(coalesce(submitter_email, '')), '')
  );

  return true;
end;
$$;

-- Deliberately grant to `anon` — this is the one write path unauthenticated
-- visitors are allowed to use, and it only ever creates a single ticket
-- scoped to the project matching the token, with priority/status/type
-- fixed or constrained above. It can never read or modify anything else.
grant execute on function public.submit_client_ticket(uuid, text, text, text, text, text) to anon;
grant execute on function public.submit_client_ticket(uuid, text, text, text, text, text) to authenticated;
