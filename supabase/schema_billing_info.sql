-- Pipeline: billing/biller info shown as the letterhead on invoice PDFs
-- Run this AFTER schema.sql. Safe to re-run: columns use IF NOT EXISTS.
--
-- Three nullable text columns on organizations, edited from Settings ->
-- Billing. All optional and start unset for every existing org — nothing
-- to backfill, no NOT NULL/CHECK constraints, so no preview-first dry run
-- needed the way schema_project_requirements.sql/schema_invoice_requirements.sql
-- require. Reuses organizations' existing RLS (is_org_member for select,
-- is_org_admin for update, same as wise_payment_link/invoice_prefix
-- already on this table) -- no new policies needed.

alter table public.organizations
  add column if not exists biller_name text,
  add column if not exists biller_company text,
  add column if not exists biller_address text;
