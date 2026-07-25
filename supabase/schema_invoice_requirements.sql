-- Pipeline: invoice requirements — mandatory client email, mandatory link
-- Run this AFTER schema_task_detail.sql and schema_recurring_invoices.sql.
--
-- Three rules, enforced at the database level (not just the form), applied
-- consistently to BOTH real invoices and recurring invoice templates (a
-- template spawns real invoices via generate_invoice_from_template() —
-- without this, a template missing an email or a project/task link would
-- silently stop auto-generating once the invoices-table rules below were
-- added, since the generated row would fail the same constraints):
--   1. client_email can no longer be blank.
--   2. Every invoice/template must link to exactly one of {a project, a
--      task} — never neither (an orphaned invoice nobody can trace to any
--      work), and never both at once (which one is it actually for?).
--
-- IMPORTANT — READ BEFORE RUNNING: unlike most schema files in this
-- project, the ALTER statements below can fail if existing data doesn't
-- already satisfy these rules — e.g. an old invoice with no email, or one
-- created before task-linking existed that still has neither a project
-- nor a task (unlikely, since project-linking already existed, but worth
-- checking). This is safe either way: Postgres just refuses to apply a
-- constraint that existing data violates and tells you exactly which rule
-- failed — nothing gets silently corrupted or partially applied.
--
-- Run the preview queries below FIRST. If either returns any rows, fix
-- those specific invoices/templates in the app before running the ALTER
-- statements further down.

-- ============================================================
-- STEP 1 — PREVIEW. Run these first. If both return zero rows, every
-- existing invoice and template already satisfies the new rules and step
-- 2 will apply cleanly. If either returns rows, fix those specific
-- invoices/templates in the app first (open each one → Edit).
-- ============================================================
select id, invoice_number, client_name, client_email, project_id, task_id
from public.invoices
where
  client_email is null
  or (project_id is null and task_id is null)
  or (project_id is not null and task_id is not null);

select id, client_name, client_email, project_id
from public.recurring_invoice_templates
where client_email is null or project_id is null;
-- (no task_id check here yet — that column doesn't exist until step 2 adds it)


-- ============================================================
-- STEP 2 — the actual schema changes. Safe to run directly; if any
-- existing row still violates a rule, the specific ALTER below will fail
-- with a clear error instead of silently applying, and everything else in
-- this file that already succeeded stays in effect.
-- ============================================================
alter table public.invoices alter column client_email set not null;

alter table public.invoices drop constraint if exists invoices_must_link_to_one_check;
alter table public.invoices add constraint invoices_must_link_to_one_check
  check (
    (project_id is not null and task_id is null)
    or
    (project_id is null and task_id is not null)
  );

-- Recurring templates get the same task_id option invoices already have,
-- so a template can target a standalone task, not only ever a project.
alter table public.recurring_invoice_templates add column if not exists task_id uuid references public.tasks(id) on delete set null;

alter table public.recurring_invoice_templates alter column client_email set not null;

alter table public.recurring_invoice_templates drop constraint if exists recurring_templates_must_link_to_one_check;
alter table public.recurring_invoice_templates add constraint recurring_templates_must_link_to_one_check
  check (
    (project_id is not null and task_id is null)
    or
    (project_id is null and task_id is not null)
  );


-- ============================================================
-- STEP 3 — carry task_id through when a template generates a real invoice
-- (create-or-replace fully supersedes the version in schema_recurring_invoices.sql)
-- ============================================================
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
    org_id, project_id, task_id, client_name, client_email, currency,
    issue_date, due_date, notes, status, generated_from_template_id
  )
  values (
    tmpl.org_id, tmpl.project_id, tmpl.task_id, tmpl.client_name, tmpl.client_email, tmpl.currency,
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

