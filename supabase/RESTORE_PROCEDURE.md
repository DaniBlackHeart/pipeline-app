# Pipeline — Backup Restore Procedure

Companion to `schema_backups.sql` and `api/backup-export.js`. This is the
documented restore procedure the 13-layer architecture audit tracked as a
"before licensing" gap ("Availability & Recovery — one real gap remains").

**Status: documented and scripted, not yet live-tested.** Every step
below is accurate to how the export and schema actually work today, and
`scripts/restore-backup.js` is real, runnable code — but neither has been
run end-to-end against a real Supabase project standing in for a disaster.
Treat the first real run of this (ideally a deliberate dry run against a
scratch project, not an actual emergency) as the actual test. If a field
name or table shape has drifted since this was written, that dry run is
where you'd find out.

## What's being restored

`api/backup-export.js` runs once a day (Vercel Cron) and writes one JSON
file — every real data table, one key per table — to the private
`backups` Storage bucket. The last 14 days are kept; older files are
pruned automatically. Two tables are skipped entirely (`rate_limit_events`,
`error_log` — operational only, zero disaster-recovery value), and four
tables have specific columns stripped before export because they hold
live credentials:

- `google_calendar_connections` — `refresh_token`, `access_token`
- `wise_reconciliation_connections` — `api_token`
- `stripe_connections` — `secret_key`, `webhook_secret`
- `mfa_backup_codes` — `salt`, `code_hash`

Restoring from a backup means those four tables come back with everything
*except* the secrets themselves (who was connected, when, whether Wise's
eligibility check passed — all still there). The people affected have to
reconnect Google Calendar / Wise / Stripe, and every user has to
regenerate their 2FA backup codes, afterward. That's a deliberate
trade-off, not an oversight — see the comment at the top of
`api/backup-export.js`.

## RPO / RTO

**RPO (Recovery Point Objective): up to ~24 hours.** The export runs once
a day (Vercel Hobby's cron ceiling). In the worst case — data lost right
before the next scheduled run — everything written since the previous
day's export is gone. This is real, not a paid-tier PITR promise: if you
need a smaller RPO than "up to a day," that's the paid Supabase tier item
already tracked separately in the architecture status doc, not something
this daily export can close.

**RTO (Recovery Time Objective): realistically half a day to a full day
for a solo operator's first real restore**, most of it manual: downloading
the file, standing up a target database with the current schema applied
(if the original project is gone, not just its data), running the restore
script, then working through the reconnect-credentials checklist below
across however many orgs were affected. A second or third restore, once
you've done it once, is realistically 1–2 hours of actual work — running
a script and clicking through a few reconnect flows — but don't plan
around that number until you've done it at least once for real.

Both numbers are honest estimates for the current setup (solo operator,
free-tier Supabase, no dry run performed yet), not measured facts. Update
this section with a real number the first time you actually do a dry run.

## Restore steps

### 1. Decide the scope

- **Single org's data corrupted/deleted, everything else fine:** you
  likely don't want a full restore — extract just that org's rows from
  the backup JSON and insert those, or fix the specific bad rows by hand.
  `scripts/restore-backup.js` restores everything in the file; for a
  single-org restore, filter the JSON first (`org_id` on nearly every
  table) or ask Claude/an LLM to write that filter for you against the
  specific backup file.
- **Whole database lost or corrupted (the real disaster case):** follow
  the full procedure below.

### 2. Get the backup file

Supabase Dashboard → Storage → `backups` bucket → download the most
recent `pipeline-backup-YYYY-MM-DD.json` (or an older one, if you need a
point before whatever went wrong — up to 14 days back).

### 3. Stand up the schema (only if the project itself is gone)

If the original Supabase project still exists and just lost data, skip to
step 4 — the schema is already there. If you're restoring into a fresh
project (the original project itself was deleted or is unrecoverable):

1. Create a new Supabase project.
2. Run every `supabase/schema_*.sql` file through the SQL editor, in the
   same order SETUP.md section 1 lists them (they're all written to be
   safely re-runnable, so order mostly matters for the same reason it did
   the first time — a table needs to exist before another one can
   reference it).
3. Update `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` (Vercel env vars) to point at the new
   project.

### 4. Run the restore script

```
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  node scripts/restore-backup.js path/to/pipeline-backup-YYYY-MM-DD.json --dry-run
```

Check the dry-run output — table names and row counts, in the order
they'll be restored. If that looks right, drop `--dry-run` and run it for
real. It upserts (not a bare insert), so it's safe to re-run if it fails
partway through — already-restored rows are simply updated in place, not
duplicated.

### 5. Manual follow-up (every restore, no way around this part)

- Reconnect Google Calendar for every user who had a connection (Settings
  → Google Calendar). They'll see it as disconnected; the row exists but
  the tokens don't.
- Reconnect Wise for every org that had it connected (Settings → Wise
  auto-reconciliation) — same reasoning, the API token wasn't in the
  backup.
- Reconnect Stripe for every org that had it connected (Settings →
  Stripe payments) — secret key and webhook signing secret both need to
  be re-entered, and the webhook needs to be re-registered against
  Stripe's dashboard if the project URL changed.
- Every user with 2FA enabled needs to generate a fresh set of backup
  codes (Settings → Two-factor authentication) — the old codes' hashes
  didn't survive the export on purpose.
- Spot-check RLS is actually enabled on a few tables (`select relrowsecurity
  from pg_class where relname = 'tasks';` should return `t`) — it lives in
  the schema files, not the data, so a schema-only restore (step 3) should
  already have it, but confirm rather than assume, especially the first
  time.
- Tell anyone affected what happened and what they need to redo (the four
  reconnect/regenerate items above) — they'll notice Google
  Calendar/Wise/Stripe silently stopped working before they read this
  file.

### 6. Verify

- Log in as a real user, confirm projects/tasks/invoices for a couple of
  known orgs look right (spot-check row counts against what the dry-run
  printed).
- Confirm the daily backup cron is still scheduled and pointed at the
  (possibly new) project — Vercel Cron config lives in `vercel.json` and
  doesn't need to change, but the `CRON_SECRET` and Supabase env vars do
  if this was a fresh-project restore.
