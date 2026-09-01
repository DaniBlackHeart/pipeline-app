-- Pipeline: rate limiting for the public project-share view
-- Run this AFTER schema_client_sharing.sql and schema_rate_limits.sql.
-- Safe to re-run: replaces get_shared_project() in place via CREATE OR
-- REPLACE, same as the original.
--
-- get_shared_project() is called directly from the browser via an anon
-- RPC call -- unlike invite/OAuth/MFA, there's no api/*.js function
-- sitting in front of it, so it never got the same rate-limit guard
-- those did (flagged in the 13-layer audit as the one remaining gap).
-- Reuses the same rate_limit_events table schema_rate_limits.sql already
-- created, rather than inventing a second tracking mechanism -- the
-- table is service-role-only by RLS, but this function runs as
-- security definer, so it can read/write it the same way
-- submit_client_ticket() already writes to `tickets` as anon.
--
-- 60 views per 10 minutes per share token -- deliberately generous. This
-- is a read-only endpoint that already returns a narrow field subset and
-- excludes draft invoices (see schema_client_sharing.sql), so the goal
-- here is blunting a scraping/hammering script, not protecting a
-- sensitive write path the way the other rate limits do. A client
-- refreshing the page repeatedly, or several people on a team viewing
-- the same link, should never realistically hit this.
--
-- Same semantics as api/_rateLimit.js's checkRateLimit(): only allowed
-- attempts get recorded, so once a scope is over the cap it stays
-- blocked until the window ages out rather than resetting on every hit.

create or replace function public.get_shared_project(share_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
  project_row record;
  recent_count int;
  rate_scope text;
begin
  rate_scope := 'share-view:' || share_token::text;

  select count(*) into recent_count
  from public.rate_limit_events
  where scope = rate_scope
    and created_at > now() - interval '10 minutes';

  if recent_count >= 60 then
    raise exception 'This link is being viewed too often right now. Please try again in a few minutes.';
  end if;

  insert into public.rate_limit_events (scope) values (rate_scope);

  select * into project_row from public.projects where public_token = share_token;

  if not found then
    return null;
  end if;

  select json_build_object(
    'project', json_build_object(
      'name', project_row.name,
      'client_name', project_row.client_name,
      'status', project_row.status,
      'due_date', project_row.due_date,
      'description', project_row.description
    ),
    'org_name', (select o.name from public.organizations o where o.id = project_row.org_id),
    'tasks', (
      select coalesce(json_agg(json_build_object('title', t.title, 'status', t.status) order by t.position), '[]'::json)
      from public.tasks t
      where t.project_id = project_row.id
    ),
    -- Only invoices that have actually been sent to the client — never
    -- drafts, which might be incomplete or not yet finalized.
    'invoices', (
      select coalesce(json_agg(json_build_object(
        'invoice_number', i.invoice_number,
        'status', i.status,
        'currency', i.currency,
        'total_amount', i.total_amount,
        'due_date', i.due_date
      ) order by i.issue_date desc), '[]'::json)
      from public.invoices i
      where i.project_id = project_row.id and i.status in ('sent', 'paid')
    )
  ) into result;

  return result;
end;
$$;

-- Note: the original function was marked `stable` (no writes). It now
-- inserts into rate_limit_events, so that attribute is deliberately
-- dropped here -- `stable` on a function that writes would be incorrect
-- and could affect how Postgres is allowed to cache/reuse results.

grant execute on function public.get_shared_project(uuid) to anon;
grant execute on function public.get_shared_project(uuid) to authenticated;
