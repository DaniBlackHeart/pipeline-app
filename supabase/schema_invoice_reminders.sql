-- Client-facing overdue-invoice reminders.
-- Run this AFTER schema_invoicing.sql, in the Supabase SQL editor.
-- Safe to re-run: IF NOT EXISTS everywhere.

-- Per-workspace opt-in for the automatic reminder cron (api/invoice-reminders.js).
-- Defaults to false -- nothing gets emailed to a client automatically
-- until an admin turns this on in Settings. A manual "Send reminder"
-- button on the invoice page works regardless of this flag.
alter table public.organizations
  add column if not exists auto_invoice_reminders boolean not null default false;

-- Tracks the last time a reminder actually went out for this invoice,
-- whether triggered manually or by the automatic job -- both paths write
-- the same column, so a manual send counts toward (and resets) the
-- automatic job's weekly cadence instead of the two overlapping.
alter table public.invoices
  add column if not exists last_reminder_sent_at timestamptz;

-- No RLS changes: last_reminder_sent_at is just another invoices column,
-- already covered by the existing UPDATE policy. auto_invoice_reminders
-- is likewise covered by the existing organizations UPDATE policy (the
-- Settings toggle uses the ordinary authenticated client, admin-gated in
-- the UI same as the other billing fields on that page). The actual
-- email sends happen server-side in api/invoice-reminders.js using the
-- service-role key, same as api/daily-digest.js already does.
