-- Adds phone number and address to the clients table, for the redesigned
-- client detail page layout. Run this AFTER schema_clients.sql, in the
-- Supabase SQL editor. Safe to re-run: IF NOT EXISTS.
--
-- Both nullable and optional, same reasoning as schema_client_email.sql --
-- existing clients won't have these yet, and adding a client shouldn't be
-- blocked on knowing their full contact details up front.
alter table public.clients add column if not exists phone text;
alter table public.clients add column if not exists address text;

-- No RLS changes needed: both are just more clients columns, already
-- covered by the existing select/insert/update policies.
