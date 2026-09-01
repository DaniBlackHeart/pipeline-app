-- Adds an email address to the clients table itself, so it only has to be
-- typed once (when the client is added, or later on their record) instead
-- of retyped on every invoice. Run this AFTER schema_clients.sql, in the
-- Supabase SQL editor. Safe to re-run: IF NOT EXISTS.
--
-- Nullable and optional on purpose -- existing clients won't have one yet,
-- and adding a client shouldn't be blocked on knowing their email up
-- front. invoices.client_email stays its own separate, mandatory column
-- (see schema_invoice_requirements.sql) -- this just gives the invoice
-- form something real to auto-fill it from, instead of always starting
-- blank.
alter table public.clients add column if not exists email text;

-- No RLS changes needed: email is just another clients column, already
-- covered by the existing select/insert/update policies.
