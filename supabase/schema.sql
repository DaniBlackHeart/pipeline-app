-- Pipeline: multi-tenant PM app schema
-- Run this in the Supabase SQL editor (or via `supabase db push` if using the CLI).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

-- ============================================================
-- 1. PROFILES  (one row per auth.users user, public-safe fields only)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone signed in can read profiles of people who share an org with them.
-- Kept simple for v1: any authenticated user can read any profile's name/avatar
-- (no sensitive data lives here). Writes are restricted to the profile owner.
drop policy if exists "profiles are readable by authenticated users" on public.profiles;
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 2. ORGANIZATIONS  (tenants/workspaces)
-- ============================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

-- Helper: is the current user a member of this org? (security definer avoids
-- infinite recursion when org_members' own RLS policy needs to check membership)
create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

drop policy if exists "members can view their orgs" on public.organizations;
create policy "members can view their orgs"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

drop policy if exists "authenticated users can create an org" on public.organizations;
create policy "authenticated users can create an org"
  on public.organizations for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "org admins can update their org" on public.organizations;
create policy "org admins can update their org"
  on public.organizations for update
  to authenticated
  using (public.is_org_admin(id));

drop policy if exists "members can view org membership list" on public.org_members;
create policy "members can view org membership list"
  on public.org_members for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org admins can add members" on public.org_members;
create policy "org admins can add members"
  on public.org_members for insert
  to authenticated
  with check (public.is_org_admin(org_id) or user_id = auth.uid());

drop policy if exists "org admins can update member roles" on public.org_members;
create policy "org admins can update member roles"
  on public.org_members for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org admins can remove members" on public.org_members;
create policy "org admins can remove members"
  on public.org_members for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- Auto-create a personal org for every new user, with them as owner.
-- Keeps v1 UX simple (no forced "create your workspace" step) while the
-- schema already supports multiple members / multiple orgs per user.
create or replace function public.handle_new_user_org()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  base_slug := regexp_replace(lower(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))), '[^a-z0-9]+', '-', 'g');
  final_slug := base_slug;

  while exists (select 1 from public.organizations where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (coalesce(new.raw_user_meta_data->>'full_name', new.email) || '''s Workspace', final_slug, new.id)
  returning id into new_org_id;

  insert into public.org_members (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_org on auth.users;
create trigger on_auth_user_created_org
  after insert on auth.users
  for each row execute procedure public.handle_new_user_org();


-- ============================================================
-- 3. PROJECTS
-- ============================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_name text,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  due_date date,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "org members can view projects" on public.projects;
create policy "org members can view projects"
  on public.projects for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can create projects" on public.projects;
create policy "org members can create projects"
  on public.projects for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update projects" on public.projects;
create policy "org members can update projects"
  on public.projects for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org admins can delete projects" on public.projects;
create policy "org admins can delete projects"
  on public.projects for delete
  to authenticated
  using (public.is_org_admin(org_id));

create index if not exists projects_org_id_idx on public.projects(org_id);


-- ============================================================
-- 4. TASKS
-- ============================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  assignee_id uuid references public.profiles(id),
  due_date date,
  position int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

drop policy if exists "org members can view tasks" on public.tasks;
create policy "org members can view tasks"
  on public.tasks for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can create tasks" on public.tasks;
create policy "org members can create tasks"
  on public.tasks for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "org members can update tasks" on public.tasks;
create policy "org members can update tasks"
  on public.tasks for update
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org members can delete tasks" on public.tasks;
create policy "org members can delete tasks"
  on public.tasks for delete
  to authenticated
  using (public.is_org_member(org_id));

create index if not exists tasks_project_id_idx on public.tasks(project_id);
create index if not exists tasks_org_id_idx on public.tasks(org_id);

-- Keep updated_at fresh on edit
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
  for each row execute procedure public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute procedure public.set_updated_at();
