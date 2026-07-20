-- Pipeline: file uploads for attachments
-- Run this AFTER schema.sql and schema_attachments.sql.
-- Safe to re-run: every policy is dropped and recreated, tables/buckets use
-- IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
-- This EXTENDS the existing link-based attachments system rather than
-- replacing it — the same `attachments` table now supports both a
-- `kind = 'link'` row (a labeled URL, as before) and a `kind = 'file'` row
-- (an actual uploaded file, stored in Supabase Storage). Use whichever
-- fits: links for anything that already lives on Drive/Frame.io/etc
-- (especially large video masters — see the file-size cap below), uploads
-- for smaller reference files you want to just live inside the app
-- (screenshots, PDFs, short documents).

-- ============================================================
-- 1. Extend the attachments table to support file-kind rows
-- ============================================================
alter table public.attachments alter column url drop not null;
alter table public.attachments
  add column if not exists kind text not null default 'link' check (kind in ('link', 'file')),
  add column if not exists storage_path text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text;

-- Every existing row is already a valid 'link' row (url set, storage_path
-- null) under the defaults above, so this constraint is safe to add even
-- with existing data — it just makes explicit what was already true, and
-- keeps any future direct insert honest about which kind it is.
alter table public.attachments drop constraint if exists attachments_kind_consistency;
alter table public.attachments add constraint attachments_kind_consistency check (
  (kind = 'link' and url is not null and storage_path is null)
  or
  (kind = 'file' and storage_path is not null and url is null)
);


-- ============================================================
-- 2. Storage bucket for uploaded files
-- ============================================================
-- Private, not public — a public bucket means anyone who ever gets a file
-- URL can access it forever, with no org check at all. Private means every
-- access (upload, view, delete) goes through the RLS policies below, and
-- viewing requires a short-lived signed URL generated on demand, not a
-- permanent link.
--
-- file_size_limit is a server-side backstop (25MB) — the app also checks
-- this client-side before even starting an upload, but this is what
-- actually stops a bypass. Kept deliberately small: this is for reference
-- files and documents, not video masters, given Supabase's free-tier
-- storage quota is shared across the whole project.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

-- Storage RLS is separate from table RLS — it lives on storage.objects,
-- not on public.attachments. Every uploaded file's path starts with
-- "{org_id}/...", so these policies reuse the same is_org_member() helper
-- used everywhere else, checking the org_id encoded in the path itself.
drop policy if exists "org members can upload attachment files" on storage.objects;
create policy "org members can upload attachment files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "org members can view attachment files" on storage.objects;
create policy "org members can view attachment files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "org members can delete attachment files" on storage.objects;
create policy "org members can delete attachment files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
