-- Pipeline: client shareable view
-- Run this AFTER the other schema files.
--
-- Design: rather than writing RLS policies that grant the `anon` role
-- direct table access (easy to get subtly wrong and over-expose data),
-- the only public-facing surface is one narrow function that returns an
-- explicit, hand-picked subset of fields. The underlying tables' RLS is
-- completely untouched — anon still has zero direct access to them.

alter table public.projects
  add column if not exists public_token uuid not null default gen_random_uuid() unique;

create or replace function public.get_shared_project(share_token uuid)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result json;
  project_row record;
begin
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

-- Deliberately grant to `anon` — this is the one function unauthenticated
-- visitors are allowed to call, and it never returns anything beyond the
-- json shape defined above (no ids, no other projects, no internal notes).
grant execute on function public.get_shared_project(uuid) to anon;
grant execute on function public.get_shared_project(uuid) to authenticated;

-- Lets a signed-in org member invalidate a leaked/old link by rolling the
-- token, without needing direct UPDATE access to the projects table's
-- public_token from the client for every org member's row.
create or replace function public.regenerate_project_share_token(project_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
  new_token uuid;
begin
  select org_id into target_org_id from public.projects where id = project_id_param;

  if not found then
    raise exception 'Project not found';
  end if;

  if not public.is_org_member(target_org_id) then
    raise exception 'Not authorized for this project';
  end if;

  new_token := gen_random_uuid();
  update public.projects set public_token = new_token where id = project_id_param;

  return new_token;
end;
$$;

grant execute on function public.regenerate_project_share_token(uuid) to authenticated;
