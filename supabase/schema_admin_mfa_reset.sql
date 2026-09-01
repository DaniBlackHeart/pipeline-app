-- Pipeline: admin-assisted 2FA reset
-- Safe to re-run.
--
-- Closes a real gap in the existing 2FA recovery story: backup codes
-- (schema_mfa_backup_codes.sql) cover "I lost my authenticator app," but
-- someone who's also lost or never saved their backup codes had no way
-- back in except manually, through the Supabase dashboard. This lets a
-- workspace owner/admin remove a locked-out teammate's authenticator
-- from the Team page instead -- see api/mfa.js's new 'admin-reset'
-- action and "How two-factor authentication works" in README.md.
--
-- No new table: this only widens the existing notifications.type check
-- constraint so api/mfa.js can notify the affected person in-app that
-- their 2FA was reset (and by whom), the same way every other security-
-- relevant change already gets surfaced. That notification is written
-- directly by the server function via the service-role client, not by a
-- security-definer trigger like every other row in this table -- there's
-- no ordinary table write to hang a trigger off here, since the reset
-- itself happens through Supabase's Admin Auth API (deleting the user's
-- MFA factor), not a change to any Postgres row.
--
-- IMPORTANT, learned the hard way: this constraint has already been
-- independently widened by THREE earlier migrations --
-- schema_project_requirements.sql ('project_assigned'),
-- schema_task_detail.sql ('task_comment'), and
-- schema_chat_mentions.sql ('chat_mention') -- and each one's ALTER only
-- listed the original three types (schema_realtime_notifications.sql's
-- 'task_assigned'/'ticket_comment'/'client_ticket_submitted') plus its
-- own addition, silently dropping whichever type(s) the migration before
-- it had added. That's invisible on a brand-new database (nothing has
-- used the dropped type yet, so nothing violates it), but breaks exactly
-- like this the moment a real row exists with one of the dropped types
-- and a later ALTER's list doesn't include it -- which is what happened
-- here. The list below is the FULL union of every type any trigger or
-- server function in this codebase actually inserts, not just this
-- file's own addition on top of the immediately-prior migration. If you
-- are adding another notification type after this file, grep for
-- `insert into public.notifications` across supabase/*.sql first and
-- carry the complete list forward the same way -- don't repeat this
-- mistake a fourth time.
--
-- Also matches schema_chat_mentions.sql's more defensive approach:
-- finds the constraint by its actual definition (contains
-- 'task_assigned') rather than assuming Postgres's auto-generated name
-- (notifications_type_check) is still what it's called -- if a prior
-- migration's guess were ever wrong, a plain `drop constraint if exists`
-- on the wrong name would silently no-op and this ALTER would then fail
-- outright (a constraint name can't be reused), which is at least loud,
-- but finding it by content avoids that entirely.
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'notifications'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%task_assigned%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table public.notifications drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_assigned',
    'ticket_comment',
    'client_ticket_submitted',
    'project_assigned',
    'task_comment',
    'chat_mention',
    'mfa_reset_by_admin'
  ));
