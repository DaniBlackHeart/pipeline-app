-- Pipeline: attachments (link-based — no file storage/upload, just a
-- labeled URL pointing at Drive, Frame.io, or wherever the real file lives)
-- Run this AFTER the other schema files.
-- Safe to re-run: every policy is dropped and recreated, tables use IF NOT EXISTS.

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Polymorphic parent (task or ticket) rather than two near-identical
  -- tables — Postgres has no native polymorphic FK, so integrity here is
  -- enforced at the application layer, not the database layer.
  parent_type text not null check (parent_type in ('task', 'ticket')),
  parent_id uuid not null,
  label text not null,
  url text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.attachments enable row level security;

drop policy if exists "org members can view attachments" on public.attachments;
create policy "org members can view attachments"
  on public.attachments for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can add attachments" on public.attachments;
create policy "org members can add attachments"
  on public.attachments for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can delete attachments" on public.attachments;
create policy "org members can delete attachments"
  on public.attachments for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists attachments_parent_idx on public.attachments(parent_type, parent_id);
create index if not exists attachments_org_id_idx on public.attachments(org_id);
