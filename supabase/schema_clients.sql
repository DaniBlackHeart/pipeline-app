-- Pipeline: clients as a first-class entity
-- Run this AFTER schema_project_requirements.sql, schema_invoice_requirements.sql,
-- schema_recurring_invoices.sql, schema_attachments.sql, and schema_activity_log.sql.
-- Safe to re-run: every policy/trigger is dropped and recreated, columns/indexes
-- use IF NOT EXISTS, and the one-time backfill in step 4 only ever fills in rows
-- that don't already have a client_id -- running it again after the first time
-- finds nothing left to do.
--
-- Before this file, "client" was free text repeated on three different tables:
-- projects.client_name / client_website, tasks.client_name / client_website
-- (standalone tasks only), and invoices.client_name / client_email -- no shared
-- record anywhere, so there was no way to ask "everything tied to this client."
--
-- This file adds a real `clients` table and a nullable client_id foreign key on
-- projects, tasks, invoices, and recurring_invoice_templates, then backfills
-- client records from whatever client_name text already exists so existing data
-- shows up linked immediately. The free-text columns themselves are left
-- untouched -- they still satisfy the existing NOT NULL/mandatory-link rules on
-- projects and invoices, and still work as a per-record label independent of
-- the client_id relationship.

-- ============================================================
-- STEP 1 -- the clients table
-- ============================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  company text,
  website text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;

drop policy if exists "org members can view clients" on public.clients;
create policy "org members can view clients"
  on public.clients for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can add clients" on public.clients;
create policy "org members can add clients"
  on public.clients for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update clients" on public.clients;
create policy "org members can update clients"
  on public.clients for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can delete clients" on public.clients;
create policy "org members can delete clients"
  on public.clients for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists clients_org_id_idx on public.clients(org_id);

-- One client per distinct name per org (case/whitespace-insensitive). This is
-- what makes the backfill in step 4 safely re-runnable, and it's also a
-- reasonable rule going forward -- two client rows named "Acme" in the same
-- workspace are far more likely to be a typo than two real distinct clients.
-- If that's ever genuinely needed, the workaround is a distinguishing suffix
-- ("Acme (NY)" vs "Acme (Chicago)") -- documented in README.md.
create unique index if not exists clients_org_name_unique_idx
  on public.clients (org_id, lower(trim(name)));

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at before update on public.clients
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- STEP 2 -- link projects, tasks, invoices, and recurring invoice
-- templates to a client. Nullable and purely additive -- none of the
-- existing client_name/client_email/client_website columns or their
-- mandatory-field constraints are touched.
-- ============================================================
alter table public.projects add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists projects_client_id_idx on public.projects(client_id);

alter table public.tasks add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists tasks_client_id_idx on public.tasks(client_id);

alter table public.invoices add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists invoices_client_id_idx on public.invoices(client_id);

alter table public.recurring_invoice_templates add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists recurring_invoice_templates_client_id_idx on public.recurring_invoice_templates(client_id);

-- Carry client_id through when a template generates a real invoice, same
-- treatment schema_invoice_requirements.sql gave task_id.
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
    org_id, project_id, task_id, client_id, client_name, client_email, currency,
    issue_date, due_date, notes, status, generated_from_template_id
  )
  values (
    tmpl.org_id, tmpl.project_id, tmpl.task_id, tmpl.client_id, tmpl.client_name, tmpl.client_email, tmpl.currency,
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


-- ============================================================
-- STEP 3 -- files on a client, reusing the existing polymorphic
-- attachments table (same pattern as schema_project_attachments.sql).
-- ============================================================
alter table public.attachments drop constraint if exists attachments_parent_type_check;
alter table public.attachments add constraint attachments_parent_type_check
  check (parent_type in ('task', 'ticket', 'project', 'client'));


-- ============================================================
-- STEP 4 -- backfill. Creates one client record per distinct client_name
-- already found across projects/tasks/invoices/recurring_invoice_templates
-- (grouped per org, case/whitespace-insensitive), carrying over a website
-- if any of those rows happened to have one, then links every matching
-- existing row to it. Guarded so re-running finds nothing left to do:
-- client creation skips names that already have a client row (via the
-- unique index above), and every UPDATE only touches rows still missing
-- a client_id.
-- ============================================================
with existing_names as (
  select org_id, client_name, client_website as website from public.projects where client_name is not null and trim(client_name) <> ''
  union all
  select org_id, client_name, client_website as website from public.tasks where client_name is not null and trim(client_name) <> ''
  union all
  select org_id, client_name, null::text as website from public.invoices where client_name is not null and trim(client_name) <> ''
  union all
  select org_id, client_name, null::text as website from public.recurring_invoice_templates where client_name is not null and trim(client_name) <> ''
),
grouped as (
  select
    org_id,
    lower(trim(client_name)) as norm_name,
    (array_agg(client_name order by length(client_name), client_name))[1] as display_name,
    (array_agg(website) filter (where website is not null and trim(website) <> ''))[1] as sample_website
  from existing_names
  group by org_id, lower(trim(client_name))
)
insert into public.clients (org_id, name, website)
select g.org_id, g.display_name, g.sample_website
from grouped g
where not exists (
  select 1 from public.clients c
  where c.org_id = g.org_id and lower(trim(c.name)) = g.norm_name
)
on conflict (org_id, lower(trim(name))) do nothing;

update public.projects p
set client_id = c.id
from public.clients c
where p.client_id is null
  and p.client_name is not null
  and p.org_id = c.org_id
  and lower(trim(p.client_name)) = lower(trim(c.name));

update public.tasks t
set client_id = c.id
from public.clients c
where t.client_id is null
  and t.client_name is not null
  and t.org_id = c.org_id
  and lower(trim(t.client_name)) = lower(trim(c.name));

update public.invoices i
set client_id = c.id
from public.clients c
where i.client_id is null
  and i.client_name is not null
  and i.org_id = c.org_id
  and lower(trim(i.client_name)) = lower(trim(c.name));

update public.recurring_invoice_templates r
set client_id = c.id
from public.clients c
where r.client_id is null
  and r.client_name is not null
  and r.org_id = c.org_id
  and lower(trim(r.client_name)) = lower(trim(c.name));


-- ============================================================
-- STEP 5 -- unified activity log support, added last on purpose so the
-- one-time backfill above doesn't spam the feed with hundreds of "Added
-- client" entries for pre-existing data -- only future creates/deletes
-- get logged.
-- ============================================================
alter table public.activity_log drop constraint if exists activity_log_entity_type_check;
alter table public.activity_log add constraint activity_log_entity_type_check
  check (entity_type in ('task', 'ticket', 'invoice', 'project', 'client'));

create or replace function public.log_client_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (org_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (new.org_id, 'client', new.id, new.name, actor, 'created', 'Added client');
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.activity_log (org_id, entity_type, entity_id, entity_title, actor_id, action, detail)
    values (old.org_id, 'client', old.id, old.name, actor, 'deleted', 'Deleted client');
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists clients_log_activity on public.clients;
create trigger clients_log_activity
  after insert or delete on public.clients
  for each row execute procedure public.log_client_activity();
