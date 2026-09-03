-- Adds a separate company email to the clients table, distinct from the
-- client's own personal email (schema_client_email.sql). Run this AFTER
-- schema_clients.sql, in the Supabase SQL editor. Safe to re-run: IF NOT
-- EXISTS.
--
-- Nullable and optional, same reasoning as the other client contact
-- fields -- a general/company inbox often differs from the actual
-- contact person's own email, and not every client has one on file.
-- This column is display/reference only for now: invoice auto-fill
-- (schema_client_email.sql) still uses the personal client email, not
-- this one.
alter table public.clients add column if not exists company_email text;

-- No RLS changes needed: just another clients column, already covered by
-- the existing select/insert/update policies.
