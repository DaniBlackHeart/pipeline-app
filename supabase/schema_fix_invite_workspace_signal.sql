-- Pipeline: fix the signal schema_single_workspace_invites.sql relies on.
-- Run this AFTER schema_single_workspace_invites.sql (i.e. after everything
-- else in the numbered setup sequence). Safe to re-run: only replaces a
-- function body, no destructive operations.
--
-- WHAT WENT WRONG: schema_single_workspace_invites.sql skips personal-
-- workspace creation when auth.users.invited_at is not null, on the
-- assumption that Supabase's inviteUserByEmail() always sets it for
-- admin-created accounts. Confirmed against a real invite that this isn't
-- reliably true on current Supabase versions — invited_at came back NULL
-- even for a genuine invite-link signup, so the trigger's guard never
-- fired and the invited teammate got a stray personal workspace anyway,
-- same bug the earlier fix was meant to close.
--
-- THE FIX: api/invite-member.js now passes an explicit `pipeline_invited:
-- true` flag in the new account's own metadata at creation time — something
-- this app sets itself rather than depending on a Supabase-internal field.
-- This function checks that flag first. The old invited_at check stays in
-- as a harmless fallback in case it's ever actually set.

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
  if new.invited_at is not null or (new.raw_user_meta_data->>'pipeline_invited') = 'true' then
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
