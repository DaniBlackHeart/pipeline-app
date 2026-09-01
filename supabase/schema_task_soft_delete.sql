-- Soft-delete for tasks: "Delete" now moves a task to a recoverable Trash
-- view (deleted_at set to the current time) instead of destroying it
-- immediately. Existing rows are untouched -- deleted_at defaults to null,
-- so nothing already in the table is affected by adding this column.
alter table public.tasks add column if not exists deleted_at timestamptz;

-- Every "active tasks" list/report/search query filters on
-- (org_id, deleted_at is null); the Trash view filters on
-- (org_id, deleted_at is not null) -- one index serves both directions.
create index if not exists idx_tasks_org_deleted_at on public.tasks (org_id, deleted_at);

-- No RLS policy changes needed. Moving a task to Trash (setting
-- deleted_at) and restoring it (clearing it) are both ordinary column
-- updates, already covered by the existing UPDATE policy
-- (`is_org_member(org_id)`, evaluated per row). Permanently deleting a
-- task from Trash is covered the same way by the existing DELETE policy.
-- Restricting *permanent* delete to workspace admins is enforced in the
-- application layer (src/pages/Trash.jsx, src/pages/TaskDetail.jsx), the
-- same way admin-only task creation already is -- there was no existing
-- precedent in this schema for a role check inside an RLS policy itself,
-- so this stays consistent with that pattern rather than introducing a
-- new one for just this feature.
