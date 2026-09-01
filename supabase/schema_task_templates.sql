-- Pipeline: task templates
-- Safe to re-run.
--
-- A reusable, ordered list of tasks (title + suggested role + notes) that
-- can be applied to a project -- either right after creating one, or to
-- a project that already exists -- to bulk-add its whole task list in
-- one shot instead of typing each task in by hand every time a similar
-- project comes up.
--
-- Fully manageable per workspace, not a fixed built-in list: create,
-- rename, and delete templates, and add/edit/remove the tasks inside
-- one, all from the app. This file just creates the tables and seeds a
-- starter set of four templates (website building, website makeover,
-- video editing, system workflows) with a reasonable draft task list
-- each -- edit or delete anything in them from the Task Templates page,
-- they're normal editable data from the moment this runs, not baked
-- into the code.
--
-- Suggested role is deliberately free text, not limited to the three
-- QUICK_ROLES (Graphics Designer / Project Manager / Developer) used
-- elsewhere -- a video editing template legitimately wants "Video
-- Editor," not a forced fit into one of those three. It's a label
-- carried on the template item only; applying a template still means
-- picking a real person, same as everywhere else in the app.

-- ============================================================
-- 1. task_templates
-- ============================================================
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.task_templates enable row level security;

drop policy if exists "org members can view task templates" on public.task_templates;
create policy "org members can view task templates"
  on public.task_templates for select
  to authenticated
  using (public.is_org_member(org_id));

-- Managing templates (not applying them) is admin-gated, same reasoning
-- as task creation itself (schema_team.sql) -- templates shape how work
-- gets created workspace-wide, not a single person's own content.
drop policy if exists "org admins can create task templates" on public.task_templates;
create policy "org admins can create task templates"
  on public.task_templates for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists "org admins can update task templates" on public.task_templates;
create policy "org admins can update task templates"
  on public.task_templates for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org admins can delete task templates" on public.task_templates;
create policy "org admins can delete task templates"
  on public.task_templates for delete
  to authenticated
  using (public.is_org_admin(org_id));

drop trigger if exists task_templates_set_updated_at on public.task_templates;
create trigger task_templates_set_updated_at before update on public.task_templates
  for each row execute procedure public.set_updated_at();

create index if not exists task_templates_org_id_idx on public.task_templates(org_id);


-- ============================================================
-- 2. task_template_items -- the ordered task list inside a template
-- ============================================================
create table if not exists public.task_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  role_label text,
  description text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.task_template_items enable row level security;

drop policy if exists "org members can view task template items" on public.task_template_items;
create policy "org members can view task template items"
  on public.task_template_items for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "org admins can create task template items" on public.task_template_items;
create policy "org admins can create task template items"
  on public.task_template_items for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists "org admins can update task template items" on public.task_template_items;
create policy "org admins can update task template items"
  on public.task_template_items for update
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists "org admins can delete task template items" on public.task_template_items;
create policy "org admins can delete task template items"
  on public.task_template_items for delete
  to authenticated
  using (public.is_org_admin(org_id));

create index if not exists task_template_items_template_id_idx on public.task_template_items(template_id);
create index if not exists task_template_items_org_id_idx on public.task_template_items(org_id);


-- ============================================================
-- 3. Seed four starter templates for every existing org
-- ============================================================
-- One row per (org, template name) -- skipped for an org that already
-- has a template with that exact name, so this is safe to re-run and
-- won't duplicate anything or stomp on edits already made to a seeded
-- template. Does NOT retroactively seed orgs created after this file is
-- first run -- a brand-new workspace just starts with zero templates,
-- same as it starts with zero clients or projects, and can build its
-- own from scratch or have this file re-run for it later.
insert into public.task_templates (org_id, name, description, created_by)
select o.id, tpl.name, tpl.description, null
from public.organizations o
cross join (values
  ('Website Building', 'A new website from scratch, discovery through launch.'),
  ('Website Makeover', 'A redesign or refresh of an existing site.'),
  ('Video Editing', 'Raw footage through final delivery.'),
  ('System Workflows', 'Standing up or documenting an internal process or tool.')
) as tpl(name, description)
where not exists (
  select 1 from public.task_templates t
  where t.org_id = o.id and t.name = tpl.name
);

-- Item lists, one insert per template. Each only fires for a template
-- that has zero items yet, so this is also safe to re-run -- it seeds
-- once and never re-adds items to a template someone has since edited
-- (including one edited down to zero items on purpose).
insert into public.task_template_items (template_id, org_id, title, role_label, description, position)
select t.id, t.org_id, item.title, item.role_label, item.description, item.position
from public.task_templates t
cross join (values
  ('Discovery call / requirements gathering', 'Project Manager', null, 0),
  ('Sitemap & wireframes', 'Graphics Designer', null, 1),
  ('Design mockups', 'Graphics Designer', null, 2),
  ('Client review & feedback (mockups)', 'Project Manager', null, 3),
  ('Frontend development', 'Developer', null, 4),
  ('Backend / CMS setup', 'Developer', null, 5),
  ('Content population', 'Project Manager', null, 6),
  ('QA & cross-browser testing', 'Developer', null, 7),
  ('Client review & feedback (staging)', 'Project Manager', null, 8),
  ('Launch', 'Developer', null, 9),
  ('Post-launch check-in', 'Project Manager', null, 10)
) as item(title, role_label, description, position)
where t.name = 'Website Building'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, org_id, title, role_label, description, position)
select t.id, t.org_id, item.title, item.role_label, item.description, item.position
from public.task_templates t
cross join (values
  ('Audit existing site (design + tech)', 'Project Manager', null, 0),
  ('Define scope of changes', 'Project Manager', null, 1),
  ('Updated design mockups', 'Graphics Designer', null, 2),
  ('Client review & feedback (mockups)', 'Project Manager', null, 3),
  ('Implement redesign', 'Developer', null, 4),
  ('Content/copy updates', 'Project Manager', null, 5),
  ('QA & cross-browser testing', 'Developer', null, 6),
  ('Client review (staging)', 'Project Manager', null, 7),
  ('Launch', 'Developer', null, 8),
  ('Post-launch check-in', 'Project Manager', null, 9)
) as item(title, role_label, description, position)
where t.name = 'Website Makeover'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, org_id, title, role_label, description, position)
select t.id, t.org_id, item.title, item.role_label, item.description, item.position
from public.task_templates t
cross join (values
  ('Review raw footage & brief', 'Project Manager', null, 0),
  ('Rough cut', 'Video Editor', null, 1),
  ('Client review (rough cut)', 'Project Manager', null, 2),
  ('Color grading', 'Video Editor', null, 3),
  ('Sound design / audio mix', 'Video Editor', null, 4),
  ('Graphics & titles', 'Video Editor', null, 5),
  ('Final cut review', 'Project Manager', null, 6),
  ('Export & delivery', 'Video Editor', null, 7)
) as item(title, role_label, description, position)
where t.name = 'Video Editing'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, org_id, title, role_label, description, position)
select t.id, t.org_id, item.title, item.role_label, item.description, item.position
from public.task_templates t
cross join (values
  ('Kickoff & requirements gathering', 'Project Manager', null, 0),
  ('Map current process / pain points', 'Project Manager', null, 1),
  ('Design proposed workflow', 'Developer', null, 2),
  ('Build / configure', 'Developer', null, 3),
  ('Internal testing', 'Developer', null, 4),
  ('Documentation', 'Project Manager', null, 5),
  ('Team walkthrough / training', 'Project Manager', null, 6),
  ('Go-live', 'Developer', null, 7),
  ('Review & adjust', 'Project Manager', null, 8)
) as item(title, role_label, description, position)
where t.name = 'System Workflows'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);
