-- Attachments (links + file uploads) now work on projects too, not just
-- tasks and tickets. Needed for the New Project page's attachments
-- section, and for a project's own page to show/manage them afterward.
-- Safe to re-run: the constraint is dropped and recreated, and this only
-- adds an allowed value -- existing rows are all still 'task' or
-- 'ticket', so there's nothing here that can conflict with live data.

alter table public.attachments drop constraint if exists attachments_parent_type_check;
alter table public.attachments add constraint attachments_parent_type_check
  check (parent_type in ('task', 'ticket', 'project'));
