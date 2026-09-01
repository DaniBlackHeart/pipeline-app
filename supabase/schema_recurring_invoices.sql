-- Pipeline: recurring invoices
-- Run this AFTER schema.sql, schema_invoicing.sql, schema_calendar.sql, schema_ticketing.sql.
-- Safe to re-run: every policy is dropped and recreated, tables use IF NOT EXISTS.

-- ============================================================
-- RECURRING INVOICE TEMPLATES
-- ============================================================
-- A template is not itself a billable invoice — it's the recurring
-- config (who, how often, what line items) that spawns real rows in
-- `invoices` each time it's run, manually or via the optional cron job
-- documented in SETUP.md.
create table if not exists public.recurring_invoice_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  client_name text not null,
  client_email text,
  currency text not null default 'PHP',
  recurrence_interval text not null check (recurrence_interval in ('weekly', 'monthly', 'quarterly', 'yearly')),
  due_days int not null default 14,
  notes text,
  next_run_date date not null default current_date,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recurring_invoice_templates enable row level security;

drop policy if exists "org members can view recurring templates" on public.recurring_invoice_templates;
create policy "org members can view recurring templates"
  on public.recurring_invoice_templates for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can create recurring templates" on public.recurring_invoice_templates;
create policy "org members can create recurring templates"
  on public.recurring_invoice_templates for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update recurring templates" on public.recurring_invoice_templates;
create policy "org members can update recurring templates"
  on public.recurring_invoice_templates for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org admins can delete recurring templates" on public.recurring_invoice_templates;
create policy "org admins can delete recurring templates"
  on public.recurring_invoice_templates for delete
  to authenticated
  using (public.is_org_admin(org_id));

create index if not exists recurring_templates_org_id_idx on public.recurring_invoice_templates(org_id);
create index if not exists recurring_templates_next_run_idx on public.recurring_invoice_templates(next_run_date) where active;

drop trigger if exists recurring_templates_set_updated_at on public.recurring_invoice_templates;
create trigger recurring_templates_set_updated_at before update on public.recurring_invoice_templates
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- RECURRING INVOICE LINE ITEMS (the template's line items)
-- ============================================================
create table if not exists public.recurring_invoice_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.recurring_invoice_templates(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  rate numeric(12, 2) not null default 0,
  position int not null default 0
);

alter table public.recurring_invoice_items enable row level security;

drop policy if exists "org members can view recurring items" on public.recurring_invoice_items;
create policy "org members can view recurring items"
  on public.recurring_invoice_items for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can create recurring items" on public.recurring_invoice_items;
create policy "org members can create recurring items"
  on public.recurring_invoice_items for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update recurring items" on public.recurring_invoice_items;
create policy "org members can update recurring items"
  on public.recurring_invoice_items for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can delete recurring items" on public.recurring_invoice_items;
create policy "org members can delete recurring items"
  on public.recurring_invoice_items for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists recurring_items_template_id_idx on public.recurring_invoice_items(template_id);


-- ============================================================
-- Track which real invoices came from a template
-- ============================================================
alter table public.invoices
  add column if not exists generated_from_template_id uuid references public.recurring_invoice_templates(id) on delete set null;


-- ============================================================
-- Generation function
-- ============================================================
-- Callable two ways:
--   1. By a signed-in org member from the app ("Generate now" button) —
--      authorization is enforced here via is_org_member, since this
--      function runs as security definer and bypasses RLS internally.
--   2. By the optional automated cron job (SETUP.md), authenticated with
--      the Supabase service role key — service-role calls carry
--      auth.role() = 'service_role' and skip the membership check below,
--      since a background job has no "current user" to check against.
create or replace function public.generate_invoice_from_template(template_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl record;
  new_invoice_id uuid;
begin
  select * into tmpl from public.recurring_invoice_templates where id = template_id_param;

  if not found then
    raise exception 'Recurring template not found';
  end if;

  if auth.role() = 'authenticated' and not public.is_org_member(tmpl.org_id) then
    raise exception 'Not authorized for this organization';
  end if;

  insert into public.invoices (
    org_id, project_id, client_name, client_email, currency,
    issue_date, due_date, notes, status, generated_from_template_id
  )
  values (
    tmpl.org_id, tmpl.project_id, tmpl.client_name, tmpl.client_email, tmpl.currency,
    current_date, current_date + tmpl.due_days, tmpl.notes, 'sent', tmpl.id
  )
  returning id into new_invoice_id;

  insert into public.invoice_items (invoice_id, org_id, description, quantity, rate, position)
  select new_invoice_id, tmpl.org_id, description, quantity, rate, position
  from public.recurring_invoice_items
  where template_id = template_id_param;

  update public.recurring_invoice_templates
  set
    next_run_date = case recurrence_interval
      when 'weekly' then next_run_date + interval '7 days'
      when 'monthly' then next_run_date + interval '1 month'
      when 'quarterly' then next_run_date + interval '3 months'
      when 'yearly' then next_run_date + interval '1 year'
    end,
    updated_at = now()
  where id = template_id_param;

  return new_invoice_id;
end;
$$;

grant execute on function public.generate_invoice_from_template(uuid) to authenticated;
