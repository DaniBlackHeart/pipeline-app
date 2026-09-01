-- 2FA backup/recovery codes.
-- Safe to re-run: table uses IF NOT EXISTS, index uses IF NOT EXISTS,
-- RLS is enabled with zero policies (same pattern as
-- google_calendar_connections / wise_reconciliation_connections).
--
-- Worth understanding how this actually works before reading the code:
-- Supabase's own session model is the source of truth for whether a
-- session has reached aal2 ("fully authenticated, MFA satisfied") --
-- nothing outside Supabase's own auth.mfa.verify() can promote a session
-- to aal2. That means a backup code can't be "an alternate way to pass
-- the MFA challenge" the way a second TOTP factor could -- there's no
-- legitimate way to make Supabase's own session claim aal2 without a
-- real TOTP verification. What a valid backup code *can* do, and what
-- this is actually built to do: prove account ownership well enough to
-- remove the lost factor entirely (see api/mfa-recover.js), after which
-- the account no longer requires aal2 at all and a normal password
-- login works again. The person re-enables 2FA from Settings afterward
-- if they want it back on.
create table if not exists public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  salt text not null,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mfa_backup_codes enable row level security;
-- Intentionally no policies -- default-deny for anon/authenticated. Every
-- read/write goes through a service-role serverless function
-- (api/mfa-generate-backup-codes.js, api/mfa-backup-codes-status.js,
-- api/mfa-recover.js). The codes are hashed either way, but keeping this
-- consistent with how every other auth-adjacent table in this schema is
-- handled is simpler than reasoning about an exception.

create index if not exists mfa_backup_codes_user_id_idx on public.mfa_backup_codes(user_id);
