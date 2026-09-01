-- ============================================================
-- RLS performance indexes
-- ============================================================
-- Every RLS policy in this app filters on org_id (via is_org_member()/
-- is_org_admin()) or occasionally user_id. That filter is only cheap if
-- the target table itself has an index on the filtered column — otherwise
-- Postgres has to sequentially scan the WHOLE table (every org's rows,
-- not just the caller's) to find matches, and that scan gets slower as
-- total row count grows across every tenant, not just a single org's.
--
-- Confirmed via direct query-pattern audit (schema policies vs. actual
-- frontend .eq() calls), not assumed. Safe to run multiple times.

-- --------------------------------------------------------------
-- 1. task_assignees — the real gap. Only indexed column was the
--    composite primary key (task_id, user_id), which does NOT serve
--    lookups on user_id or org_id alone.
--    - MyTasks.jsx queries .eq('user_id', ...) with no task_id — every
--      "My Tasks" page load was a full table scan across all orgs.
--    - Reports.jsx (Project Rollup) queries .eq('org_id', ...) directly
--      — every Reports page load for an admin was also a full scan.
-- --------------------------------------------------------------
create index if not exists task_assignees_user_id_idx
  on public.task_assignees(user_id);

create index if not exists task_assignees_org_id_idx
  on public.task_assignees(org_id);

-- --------------------------------------------------------------
-- 2. task_comments — Reports.jsx queries .eq('org_id', ...) directly
--    (not scoped through task_id in that call), and only task_id was
--    indexed.
-- --------------------------------------------------------------
create index if not exists task_comments_org_id_idx
  on public.task_comments(org_id);

-- --------------------------------------------------------------
-- 3. Hygiene: these tables' RLS also filters on org_id with no
--    matching index, but every current frontend query against them is
--    already scoped through a different indexed foreign key first
--    (invoice_id / project_id / ticket_id / template_id), so this
--    isn't an active slow-query problem today — just closing the gap
--    cheaply now so a future query change doesn't quietly reintroduce
--    the same issue these first two had.
-- --------------------------------------------------------------
create index if not exists invoice_items_org_id_idx
  on public.invoice_items(org_id);

create index if not exists project_assignees_org_id_idx
  on public.project_assignees(org_id);

create index if not exists ticket_comments_org_id_idx
  on public.ticket_comments(org_id);

create index if not exists recurring_invoice_items_org_id_idx
  on public.recurring_invoice_items(org_id);

create index if not exists activity_log_org_id_idx
  on public.activity_log(org_id);

create index if not exists task_activity_log_org_id_idx
  on public.task_activity_log(org_id);
