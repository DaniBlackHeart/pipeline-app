-- Admin-gate invoices and recurring invoice templates end-to-end:
-- creating a brand-new one, AND editing an existing one (status, line
-- items, pausing/resuming a template), are now both admin/owner only.
-- Members can still view every invoice/template (unchanged) -- this is
-- read-only for them now, not "create-gated but editable" as an earlier
-- version of this file had it. Mirrors the existing task-creation gate
-- (schema_team.sql), just extended to cover updates too since invoices
-- are financial records, unlike tasks.
-- Safe to re-run: every policy is dropped and recreated.

drop policy if exists "org members can create invoices" on public.invoices;
drop policy if exists "org admins can create invoices" on public.invoices;
create policy "org admins can create invoices"
  on public.invoices for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists "org members can update invoices" on public.invoices;
drop policy if exists "org admins can update invoices" on public.invoices;
create policy "org admins can update invoices"
  on public.invoices for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org members can create invoice items" on public.invoice_items;
drop policy if exists "org admins can create invoice items" on public.invoice_items;
create policy "org admins can create invoice items"
  on public.invoice_items for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists "org members can update invoice items" on public.invoice_items;
drop policy if exists "org admins can update invoice items" on public.invoice_items;
create policy "org admins can update invoice items"
  on public.invoice_items for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org members can delete invoice items" on public.invoice_items;
drop policy if exists "org admins can delete invoice items" on public.invoice_items;
create policy "org admins can delete invoice items"
  on public.invoice_items for delete
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org members can create recurring templates" on public.recurring_invoice_templates;
drop policy if exists "org admins can create recurring templates" on public.recurring_invoice_templates;
create policy "org admins can create recurring templates"
  on public.recurring_invoice_templates for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists "org members can update recurring templates" on public.recurring_invoice_templates;
drop policy if exists "org admins can update recurring templates" on public.recurring_invoice_templates;
create policy "org admins can update recurring templates"
  on public.recurring_invoice_templates for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org members can create recurring items" on public.recurring_invoice_items;
drop policy if exists "org admins can create recurring items" on public.recurring_invoice_items;
create policy "org admins can create recurring items"
  on public.recurring_invoice_items for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists "org members can update recurring items" on public.recurring_invoice_items;
drop policy if exists "org admins can update recurring items" on public.recurring_invoice_items;
create policy "org admins can update recurring items"
  on public.recurring_invoice_items for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org members can delete recurring items" on public.recurring_invoice_items;
drop policy if exists "org admins can delete recurring items" on public.recurring_invoice_items;
create policy "org admins can delete recurring items"
  on public.recurring_invoice_items for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- generate_invoice_from_template() runs as security definer and bypasses
-- the invoices insert policy above internally, so it needs its own
-- authorization check tightened the same way -- otherwise a member could
-- still create a real invoice via "Generate now" even after the policy
-- change. The service-role/cron path (SETUP.md's automated digest) is
-- unaffected since it skips this check entirely, same as before.
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

  if auth.role() = 'authenticated' and not public.is_org_admin(tmpl.org_id) then
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
