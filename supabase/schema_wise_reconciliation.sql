-- Wise auto-reconciliation.
-- Safe to re-run: tables use IF NOT EXISTS, policies are dropped and
-- recreated, indexes use IF NOT EXISTS.
--
-- Real, API-based reconciliation only works for Wise accounts based in
-- the US, Canada, Australia, New Zealand, Singapore, or Malaysia --
-- that's a restriction on Wise's own side (their personal API token
-- can't read balance statements anywhere else), not something this
-- schema or the sync function can work around. Built generically per-org
-- specifically so it works out of the box for any workspace whose own
-- Wise account happens to be eligible, even though it won't do anything
-- for one that isn't -- see api/wise-reconcile-sync.js and the "supported"
-- column below, which is how that gets detected and surfaced honestly
-- rather than failing silently.

-- ============================================================
-- WISE RECONCILIATION CONNECTIONS
-- ============================================================
-- One row per org (a Wise Business account is a company-wide thing, not
-- personal like the Google Calendar connection). Holds the live API
-- token, so -- same reasoning as google_calendar_connections -- this
-- table is NOT exposed to the client via RLS at all. Every read/write
-- goes through a service-role serverless function.
create table if not exists public.wise_reconciliation_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade unique,
  api_token text not null,
  wise_profile_id text,
  supported boolean,
  last_checked_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wise_reconciliation_connections enable row level security;
-- Intentionally no policies -- default-deny for anon/authenticated. Only
-- the service role (which bypasses RLS) can touch this table.

drop trigger if exists wise_reconciliation_connections_set_updated_at on public.wise_reconciliation_connections;
create trigger wise_reconciliation_connections_set_updated_at before update on public.wise_reconciliation_connections
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- WISE TRANSACTIONS
-- ============================================================
-- Every incoming transaction pulled from a connected org's Wise balance
-- statement, whether or not it could be matched to an invoice.
-- match_confidence: 'auto' (reference text contained the invoice number
-- AND amount/currency matched exactly -- safe to auto-mark that invoice
-- paid), 'manual' (an admin confirmed the match by hand), 'unmatched'
-- (needs a human to look at it), 'ignored' (an admin dismissed it --
-- e.g. an unrelated deposit that isn't an invoice payment at all).
--
-- Viewable by admins/owners only, not every member -- this is raw
-- incoming-payment data from a real bank account, broader in scope than
-- structured invoice records (which every member can already see), so
-- it gets the more cautious default. Confirming/ignoring a match is an
-- admin action too, same reasoning.
create table if not exists public.wise_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  wise_transaction_id text not null,
  amount numeric(12, 2) not null,
  currency text not null,
  reference text,
  transaction_date date not null,
  matched_invoice_id uuid references public.invoices(id) on delete set null,
  match_confidence text not null default 'unmatched' check (match_confidence in ('auto', 'manual', 'unmatched', 'ignored')),
  created_at timestamptz not null default now(),
  unique (org_id, wise_transaction_id)
);

alter table public.wise_transactions enable row level security;

drop policy if exists "org admins can view wise transactions" on public.wise_transactions;
create policy "org admins can view wise transactions"
  on public.wise_transactions for select
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org admins can update wise transactions" on public.wise_transactions;
create policy "org admins can update wise transactions"
  on public.wise_transactions for update
  to authenticated
  using (public.is_org_admin(org_id));
-- No insert policy for `authenticated` -- only the service-role sync
-- function creates these rows, from real Wise API data.

create index if not exists wise_transactions_org_id_idx on public.wise_transactions(org_id);
create index if not exists wise_transactions_matched_invoice_idx on public.wise_transactions(matched_invoice_id);
