-- Pipeline: invoicing module
-- Run this AFTER schema.sql, in the Supabase SQL editor.

-- ============================================================
-- 1. Org-level payment settings
-- ============================================================
-- Wise's payment-link + invoice features live inside the Wise Business
-- dashboard itself (no public API to auto-generate a fresh link per
-- invoice). The practical integration: store your one permanent Wise
-- payment link here once, and every generated invoice embeds it +
-- the invoice number as the payment reference.
alter table public.organizations
  add column if not exists wise_payment_link text,
  add column if not exists invoice_prefix text not null default 'INV';


-- ============================================================
-- 2. INVOICES
-- ============================================================
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  invoice_number text not null,
  client_name text not null,
  client_email text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'cancelled')),
  currency text not null default 'PHP',
  issue_date date not null default current_date,
  due_date date,
  notes text,
  total_amount numeric(12, 2) not null default 0,
  paid_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, invoice_number)
);

alter table public.invoices enable row level security;

create policy "org members can view invoices"
  on public.invoices for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "org members can create invoices"
  on public.invoices for insert
  to authenticated
  with check (public.is_org_member(org_id));

create policy "org members can update invoices"
  on public.invoices for update
  to authenticated
  using (public.is_org_member(org_id));

create policy "org admins can delete invoices"
  on public.invoices for delete
  to authenticated
  using (public.is_org_admin(org_id));

create index if not exists invoices_org_id_idx on public.invoices(org_id);
create index if not exists invoices_project_id_idx on public.invoices(project_id);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- 3. INVOICE ITEMS (line items)
-- ============================================================
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  rate numeric(12, 2) not null default 0,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.invoice_items enable row level security;

create policy "org members can view invoice items"
  on public.invoice_items for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "org members can create invoice items"
  on public.invoice_items for insert
  to authenticated
  with check (public.is_org_member(org_id));

create policy "org members can update invoice items"
  on public.invoice_items for update
  to authenticated
  using (public.is_org_member(org_id));

create policy "org members can delete invoice items"
  on public.invoice_items for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);


-- ============================================================
-- 4. Keep invoices.total_amount in sync with its line items
-- ============================================================
create or replace function public.recalc_invoice_total()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_invoice_id uuid;
begin
  target_invoice_id := coalesce(new.invoice_id, old.invoice_id);

  update public.invoices
  set total_amount = coalesce((
    select sum(quantity * rate) from public.invoice_items where invoice_id = target_invoice_id
  ), 0)
  where id = target_invoice_id;

  return null;
end;
$$;

drop trigger if exists invoice_items_recalc_total on public.invoice_items;
create trigger invoice_items_recalc_total
  after insert or update or delete on public.invoice_items
  for each row execute procedure public.recalc_invoice_total();


-- ============================================================
-- 5. Auto-generate invoice_number per org (e.g. INV-0001) when left blank
-- ============================================================
create or replace function public.set_invoice_number()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  org_prefix text;
  next_seq int;
begin
  if new.invoice_number is not null and new.invoice_number <> '' then
    return new;
  end if;

  select invoice_prefix into org_prefix from public.organizations where id = new.org_id;
  org_prefix := coalesce(org_prefix, 'INV');

  select coalesce(max(
    nullif(regexp_replace(invoice_number, '^' || org_prefix || '-', ''), invoice_number)::int
  ), 0) + 1
  into next_seq
  from public.invoices
  where org_id = new.org_id and invoice_number ~ ('^' || org_prefix || '-[0-9]+$');

  new.invoice_number := org_prefix || '-' || lpad(next_seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists invoices_set_number on public.invoices;
create trigger invoices_set_number
  before insert on public.invoices
  for each row execute procedure public.set_invoice_number();
