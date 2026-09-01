-- Pipeline: separate a client's brand guidelines from a task's own description
-- Safe to re-run.
--
-- Task description and brand guidelines were sharing a single
-- tasks.brand_guidelines column, which conflated two different things:
-- task-specific notes (what needs to happen on this one task) and a
-- client's brand identity (logo, colors, fonts -- mostly kept as actual
-- attached files, with this text field meant to hold notes alongside
-- them, e.g. "use the light logo variant" or the brand's hex codes).
--
-- Brand guidelines don't change from task to task, or usually even from
-- project to project -- they belong to the client, entered once. Any
-- project or standalone task under that client can already reach the
-- client's own page via the "view client" links already on those pages,
-- so there's no need to duplicate guidelines onto every task.

-- ============================================================
-- 1. Give clients their own brand guidelines field.
-- ============================================================
alter table public.clients add column if not exists brand_guidelines text;

-- ============================================================
-- 2. Rename the tasks column now that it's purely task-scoped notes.
--    Wrapped in an existence check so this is safe to re-run once the
--    rename has already happened.
-- ============================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'brand_guidelines'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'description'
  ) then
    alter table public.tasks rename column brand_guidelines to description;
  end if;
end $$;
