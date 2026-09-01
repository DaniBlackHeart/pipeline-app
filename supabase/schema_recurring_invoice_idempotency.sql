-- Pipeline: idempotency guard for recurring invoice generation
-- Run this AFTER schema_recurring_invoices.sql.
-- Safe to re-run: CREATE OR REPLACE FUNCTION is idempotent.
--
-- Fixes a real gap found in a 13-layer architecture audit:
-- generate_invoice_from_template() had no protection against being
-- invoked twice for the same billing cycle - e.g. the daily cron and a
-- manual "Generate Now" click landing within moments of each other, or
-- two admins in separate sessions clicking at nearly the same time.
-- The client already disables the button mid-request (see
-- RecurringInvoices.jsx), which rules out a same-tab double-click, but
-- nothing guarded against those other two cases at the database level.
--
-- Two fixes, both inside the same function:
--   1. `for update` locks the template row for the transaction's
--      duration, so two genuinely simultaneous calls serialize instead
--      of both reading the same next_run_date and racing to write it.
--   2. A short recency check: if an invoice was already generated from
--      this template within the last 5 minutes, the call is rejected
--      instead of silently creating a second invoice. Five minutes is
--      long enough to catch accidental near-simultaneous duplicate
--      calls, short enough not to block a genuinely deliberate second
--      generation later the same day.

create or replace function public.generate_invoice_from_template(template_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl record;
  new_invoice_id uuid;
  last_generated_at timestamptz;
begin
  -- Lock the template row for this transaction so a second, truly
  -- concurrent call waits for this one to finish rather than reading
  -- the same next_run_date and both proceeding.
  select * into tmpl from public.recurring_invoice_templates where id = template_id_param for update;

  if not found then
    raise exception 'Recurring template not found';
  end if;

  if auth.role() = 'authenticated' and not public.is_org_member(tmpl.org_id) then
    raise exception 'Not authorized for this organization';
  end if;

  -- Reject a second generation for this template if one already
  -- happened moments ago (covers cron-vs-manual overlap and
  -- multiple admins clicking "Generate now" at nearly the same time).
  select max(created_at) into last_generated_at
  from public.invoices
  where generated_from_template_id = template_id_param;

  if last_generated_at is not null and last_generated_at > now() - interval '5 minutes' then
    raise exception 'An invoice was already generated from this template a few minutes ago. Check Recurring Invoices before generating again.';
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
