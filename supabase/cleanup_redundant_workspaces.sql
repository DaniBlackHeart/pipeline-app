-- Pipeline: ONE-TIME cleanup — remove redundant personal workspaces
-- created before schema_single_workspace_invites.sql was run.
--
-- ⚠️ THIS FILE IS DIFFERENT FROM EVERY OTHER FILE IN /supabase.
-- Every other schema file only ever adds or safely replaces — this one
-- deletes data. Do not run it as part of your normal "run every
-- schema_*.sql file" setup. Run it once, deliberately, and only after
-- reading and reviewing STEP 1's output.
--
-- WHAT THIS TARGETS: a workspace gets flagged for deletion only if ALL of
-- the following are true —
--   - its only member is its own owner (nobody else was ever added to it)
--   - that owner also belongs to at least one OTHER workspace (so
--     deleting this one never leaves someone with zero workspaces —
--     that would lock them out of the app entirely)
--   - it has zero projects, tickets, invoices, and calendar events (i.e.
--     it was never actually used for anything real)
-- This is deliberately conservative. If a workspace has ever had a second
-- member added, or holds even one project/ticket/invoice/event, it will
-- NOT be touched.

-- ============================================================
-- STEP 1 — PREVIEW ONLY. Run this first. Read the output. Confirm every
-- row listed is genuinely a workspace you don't need, before going
-- anywhere near step 2.
-- ============================================================
select
  o.id as org_id,
  o.name as org_name,
  p.full_name as owner_name,
  p.email as owner_email
from public.organizations o
join public.org_members om on om.org_id = o.id and om.role = 'owner'
join public.profiles p on p.id = om.user_id
where
  (select count(*) from public.org_members om2 where om2.org_id = o.id) = 1
  and (select count(*) from public.org_members om3 where om3.user_id = om.user_id) > 1
  and not exists (select 1 from public.projects pr where pr.org_id = o.id)
  and not exists (select 1 from public.tickets t where t.org_id = o.id)
  and not exists (select 1 from public.invoices i where i.org_id = o.id)
  and not exists (select 1 from public.calendar_events ce where ce.org_id = o.id);


-- ============================================================
-- STEP 2 — THE ACTUAL DELETE. Only run this after step 1's output looks
-- right. Uses the exact same conditions as step 1 — nothing beyond what
-- you just reviewed gets touched. Cascades to org_members for that
-- workspace (and nothing else, since the checks above already confirmed
-- there's no project/ticket/invoice/calendar-event data to lose).
--
-- Commented out on purpose — select everything from "delete from" down
-- to the closing ");" below (not the leading "-- ") and run it
-- deliberately once step 1 looks right.
-- ============================================================
-- delete from public.organizations
-- where id in (
--   select o.id
--   from public.organizations o
--   join public.org_members om on om.org_id = o.id and om.role = 'owner'
--   where
--     (select count(*) from public.org_members om2 where om2.org_id = o.id) = 1
--     and (select count(*) from public.org_members om3 where om3.user_id = om.user_id) > 1
--     and not exists (select 1 from public.projects pr where pr.org_id = o.id)
--     and not exists (select 1 from public.tickets t where t.org_id = o.id)
--     and not exists (select 1 from public.invoices i where i.org_id = o.id)
--     and not exists (select 1 from public.calendar_events ce where ce.org_id = o.id)
-- );
