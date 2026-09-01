-- Pipeline: invited users get no personal workspace of their own
-- Run this AFTER schema.sql.
-- Safe to re-run: this only replaces a function body, no destructive operations.
--
-- THE MODEL THIS SUPPORTS: each client who licenses/uses this app signs up
-- themselves and becomes the sole owner/admin of their own workspace —
-- that's the "self-service signup" path, unaffected by this file. Everyone
-- THEY invite should only ever land inside THAT workspace, never get a
-- stray personal workspace of their own. Before this fix, every new
-- account — invited or not — triggered handle_new_user_org(), which always
-- created a fresh personal workspace. For an invited teammate, that meant
-- two workspaces: the one they were invited to, and an empty one nobody
-- wanted, defaulting to the wrong one on login until they manually
-- switched (exactly what happened during testing).
--
-- The fix: Supabase sets a real, non-null `invited_at` timestamp on
-- auth.users specifically for accounts created via the invite flow
-- (Team page -> Send invite, when the email has no existing account) —
-- and leaves it null for a normal self-service signUp(). That's the
-- distinguishing signal used below.

create or replace function public.handle_new_user_org()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  if new.invited_at is not null then
    -- Invited account: invite-member.js already adds them to the inviting
    -- workspace's org_members directly. Nothing more to do here.
    return new;
  end if;

  base_slug := regexp_replace(lower(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))), '[^a-z0-9]+', '-', 'g');
  final_slug := base_slug;

  while exists (select 1 from public.organizations where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (coalesce(new.raw_user_meta_data->>'full_name', new.email) || '''s Workspace', final_slug, new.id)
  returning id into new_org_id;

  insert into public.org_members (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

-- The trigger itself (on_auth_user_created_org, defined in schema.sql)
-- doesn't need to change — only this function's body does.
