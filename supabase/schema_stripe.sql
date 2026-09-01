-- Pipeline: Stripe payments + auto-reconciliation
-- Safe to re-run: tables use IF NOT EXISTS, columns use IF NOT EXISTS,
-- policies are dropped and recreated, indexes use IF NOT EXISTS.
--
-- Mirrors schema_wise_reconciliation.sql's shape closely -- the same
-- "service-role-only connection table + an admin-viewable events table"
-- split, for the same reason: a live Stripe secret key must never reach
-- a client-readable row, even one gated by RLS.
--
-- Meaningfully different from Wise in two ways:
--   1. Real-time via webhook instead of a daily poll -- Stripe pushes a
--      checkout.session.completed event the moment a payment succeeds,
--      rather than Pipeline having to go ask once a day.
--   2. Matching is exact, not fuzzy. Every Stripe payment link Pipeline
--      generates carries the Pipeline invoice id in its metadata, which
--      Stripe automatically copies onto the resulting Checkout Session --
--      so there's no reference-text-contains-the-invoice-number guessing
--      the way Wise's bank-transfer matching needs. The one case this
--      can't cover is a payment made through a Stripe Payment Link that
--      wasn't created by Pipeline (e.g. made by hand in the Stripe
--      Dashboard) -- that still lands in stripe_events as unmatched, for
--      a human to reconcile, same fallback Wise already has.

-- ============================================================
-- STRIPE CONNECTIONS
-- ============================================================
-- One row per org (each of Dani's client workspaces has its own separate
-- Stripe account, same reasoning as wise_reconciliation_connections).
-- Holds the live secret key AND the webhook signing secret, so this
-- table is NOT exposed to the client via RLS at all -- every read/write
-- goes through a service-role serverless function.
create table if not exists public.stripe_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade unique,
  secret_key text not null,
  webhook_secret text not null,
  last_verified_at timestamptz,
  last_error text,
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stripe_connections enable row level security;
-- Intentionally no policies -- default-deny for anon/authenticated. Only
-- the service role (which bypasses RLS) can touch this table.

drop trigger if exists stripe_connections_set_updated_at on public.stripe_connections;
create trigger stripe_connections_set_updated_at before update on public.stripe_connections
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- PER-INVOICE STRIPE PAYMENT LINK
-- ============================================================
-- Generated on demand from the invoice's own page (or regenerated if the
-- invoice total changes after a link already exists), then shown on the
-- invoice PDF as a plain link -- same as the Wise link, and for the same
-- reason: the PDF a client actually sees has no JavaScript, so this has
-- to be a real URL embedded ahead of time, not a "click to pay" button
-- that calls the API live. Amount/currency the link was generated for
-- are recorded alongside so the UI can tell a stale link (invoice edited
-- since) from a current one without another Stripe API call.
alter table public.invoices
  add column if not exists stripe_payment_link text,
  add column if not exists stripe_payment_link_id text,
  add column if not exists stripe_link_amount numeric(12, 2),
  add column if not exists stripe_link_currency text;

-- ============================================================
-- STRIPE EVENTS
-- ============================================================
-- Every checkout.session.completed (or .async_payment_succeeded) event
-- this org's webhook endpoint received, whether or not it could be
-- matched. Insert is deliberately keyed on the globally-unique Stripe
-- event id (not org-scoped) so a retried delivery -- Stripe retries
-- failed/timed-out deliveries automatically -- is a harmless duplicate
-- insert attempt, not a double-processed payment.
--
-- match_status: 'auto' (the session's metadata carried a Pipeline
-- invoice id that still existed and wasn't already paid -- marked paid
-- automatically), 'already_paid' (that invoice was marked paid some
-- other way before this event arrived -- logged, not reapplied),
-- 'unmatched' (no usable metadata at all, e.g. a payment made through a
-- Payment Link created by hand in the Stripe Dashboard rather than by
-- Pipeline -- needs a human to look at it, same as an unmatched Wise
-- transaction), 'manual' (an admin confirmed the match by hand from the
-- Unmatched Stripe events panel), 'ignored' (an admin dismissed it as
-- unrelated to any invoice). The last two only ever come from a client
-- update -- see the update policy below.
--
-- Viewable by admins/owners only, not every member -- same reasoning as
-- wise_transactions: this is raw incoming-payment data, a broader scope
-- than the structured invoice records every member can already see.
create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  stripe_event_id text not null unique,
  stripe_session_id text,
  amount numeric(12, 2),
  currency text,
  matched_invoice_id uuid references public.invoices(id) on delete set null,
  match_status text not null default 'unmatched' check (match_status in ('auto', 'already_paid', 'unmatched', 'manual', 'ignored')),
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

drop policy if exists "org admins can view stripe events" on public.stripe_events;
create policy "org admins can view stripe events"
  on public.stripe_events for select
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org admins can update stripe events" on public.stripe_events;
create policy "org admins can update stripe events"
  on public.stripe_events for update
  to authenticated
  using (public.is_org_admin(org_id));
-- No insert policy for `authenticated` -- only the service-role webhook
-- handler creates these rows, from a verified Stripe event.

create index if not exists stripe_events_org_id_idx on public.stripe_events(org_id);
create index if not exists stripe_events_matched_invoice_idx on public.stripe_events(matched_invoice_id);
