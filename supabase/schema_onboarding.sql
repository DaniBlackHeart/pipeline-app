-- Pipeline: first-time onboarding
-- Safe to re-run.
--
-- Adds a single nullable timestamp to profiles: null means "hasn't seen
-- (or skipped) the onboarding page yet," set means they have. No new
-- table -- this is a fact about a person, same tier as full_name/
-- nickname already living directly on profiles.
--
-- src/context/AuthContext.jsx computes `needsOnboarding` from this column
-- and ProtectedRoute (src/App.jsx) redirects to /welcome whenever it's
-- true, the same shape as the existing needsMfaChallenge gate. Finishing
-- OR explicitly skipping the onboarding page both set this column --
-- skipping still counts as "seen it," so nobody gets nagged with it
-- again just for choosing not to read it once. Anyone can always pull it
-- back up later from the account menu ("Take the tour") regardless of
-- whether this column is set.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_completed_at'
  ) then
    alter table public.profiles add column onboarding_completed_at timestamptz;

    -- Backfill, once: everyone who already has a profile row before this
    -- column existed has necessarily already been using Pipeline without
    -- ever seeing an onboarding page -- mark them as already onboarded so
    -- this migration doesn't retroactively force a first-time-user
    -- experience onto every existing account the moment it's deployed.
    -- This only runs inside the branch above, i.e. the one time the
    -- column is actually created. A later re-run of this file finds the
    -- column already exists, skips this whole block, and never touches
    -- onboarding_completed_at again -- so a genuinely new signup created
    -- between then and a later re-run correctly keeps a null value and
    -- still gets the real onboarding flow.
    update public.profiles set onboarding_completed_at = now() where onboarding_completed_at is null;
  end if;
end $$;
