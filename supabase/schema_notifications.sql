-- Pipeline: notification preferences (backs the daily digest email)
-- Run this AFTER the other schema files.
--
-- The digest itself is sent by a Vercel serverless function + Cron job
-- (see /api/daily-digest.js and SETUP.md) — this file only stores each
-- member's preferences and defaults them to "on" the moment they join an
-- org, the same pattern as the auto-created personal workspace.

create table if not exists public.notification_preferences (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  notify_overdue_invoices boolean not null default true,
  notify_tasks_due boolean not null default true,
  notify_open_tickets boolean not null default true,
  notify_recurring_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.notification_preferences enable row level security;

-- Personal settings — visible/editable only by the member they belong to,
-- regardless of org role. Not admin-gated like Wise/invoice-prefix settings.
create policy "users can view their own notification preferences"
  on public.notification_preferences for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can insert their own notification preferences"
  on public.notification_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can update their own notification preferences"
  on public.notification_preferences for update
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists notification_prefs_set_updated_at on public.notification_preferences;
create trigger notification_prefs_set_updated_at before update on public.notification_preferences
  for each row execute procedure public.set_updated_at();

-- Auto-create a default (all-on) preferences row whenever someone joins an
-- org — mirrors handle_new_user_org's "sensible defaults, no setup step"
-- approach, so the digest works immediately without a trip to Settings.
create or replace function public.handle_new_org_member_notification_prefs()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notification_preferences (org_id, user_id)
  values (new.org_id, new.user_id)
  on conflict (org_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_org_member_added_notification_prefs on public.org_members;
create trigger on_org_member_added_notification_prefs
  after insert on public.org_members
  for each row execute procedure public.handle_new_org_member_notification_prefs();

-- Backfill for orgs/members that already existed before this migration ran.
insert into public.notification_preferences (org_id, user_id)
select org_id, user_id from public.org_members
on conflict (org_id, user_id) do nothing;
