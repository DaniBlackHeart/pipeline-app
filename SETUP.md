# Setup

## 1. Supabase (backend)

All schema files are safe to run more than once — if one errors partway
through or you're not sure whether it already ran, just run it again.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, go to **SQL Editor** → paste the full contents
   of `supabase/schema.sql` → Run. This creates all tables, RLS policies,
   and the triggers that auto-create a profile + personal workspace for
   every new signup.
3. Back in the **SQL Editor**, paste and run `supabase/schema_invoicing.sql`
   too (adds invoices, line items, and the Wise payment-link setting).
4. Then paste and run `supabase/schema_calendar.sql` (adds standalone
   calendar events).
5. Then paste and run `supabase/schema_ticketing.sql` (adds tickets and
   the comment thread).
6. Then paste and run `supabase/schema_recurring_invoices.sql` (adds
   recurring invoice templates + the generation function).
7. Then paste and run `supabase/schema_client_sharing.sql` (adds the
   public share-link function for read-only client views).
8. Then paste and run `supabase/schema_attachments.sql` (adds link-based
   attachments for tasks and tickets).
9. Then paste and run `supabase/schema_notifications.sql` (adds per-person
   digest preferences).
10. Then paste and run `supabase/schema_team.sql` (adds email lookup for
    the team roster, admin-only task creation, and the task activity log).
11. Then paste and run `supabase/schema_client_tickets.sql` (lets clients
    file a ticket from their read-only project link).
12. Then paste and run `supabase/schema_realtime_notifications.sql` (adds
    the notification bell — a table, three triggers, and one line adding
    that table to Supabase's realtime broadcast). Nothing else to
    configure — unlike the digest and invites, this needs no extra
    account, API key, or deployment step. It works the moment the SQL runs.
13. Then paste and run `supabase/schema_file_uploads.sql` (adds a private
    storage bucket for file-upload attachments, plus the RLS policies that
    scope it by workspace). Also needs nothing beyond running the SQL —
    Supabase Storage is already part of every project.
14. Then paste and run `supabase/schema_activity_log.sql` (generalizes the
    task-only activity log into one covering tasks, tickets, invoices, and
    projects — and carries over the existing task history rather than
    resetting it). Also needs nothing beyond running the SQL.
15. Then paste and run `supabase/schema_single_workspace_invites.sql`
    (makes sure anyone you invite lands only in your workspace — never
    with an extra empty one of their own). If you've already invited
    someone before running this, see "Cleaning up existing extra
    workspaces" further down, after the main setup steps.
16. Then paste and run `supabase/schema_task_detail.sql` (adds standalone
    tasks, multiple assignees with role labels, task notes, manual
    task-to-task linking, and task-specific invoices). Also needs nothing
    beyond running the SQL.
17. Then open `supabase/schema_invoice_requirements.sql` and **read its
    header before running it** — this one's different from the others.
    Run the two preview `SELECT` queries at the top first; if either
    returns rows, fix those specific invoices/templates in the app first
    (open each one → Edit → fill in the missing email or pick a project/
    task). Only once both previews come back empty, run the rest of the
    file (the actual `ALTER TABLE` statements). This makes client email
    and a project-or-task link mandatory on every invoice and recurring
    template going forward.
18. Then open `supabase/schema_project_requirements.sql` — same
    preview-first caution as the invoice file above, but only for two of
    its columns. Run the single preview `SELECT` at the top; if it
    returns rows, fix those specific projects in the app first (fill in
    the missing client name and/or due date). The new `start_date` column
    doesn't need this — every existing project gets one automatically
    (backfilled from its creation date), so only client name and due date
    need manual review. Once the preview is clear, run the rest of the file.
19. Then paste and run `supabase/schema_invoice_admin_gate.sql` (makes
    invoices and recurring templates read-only for regular members —
    admins/owners keep full create/edit/delete access; viewing stays open
    to everyone). Needs nothing beyond running the SQL.
20. Then paste and run `supabase/schema_project_attachments.sql` (lets
    attachments work on projects too, not just tasks/tickets — no other
    setup needed, storage/RLS policies are already generic).
21. Then paste and run `supabase/schema_google_calendar_sync.sql` (two new
    tables for Google Calendar sync, both service-role-only — nothing to
    configure here yet, that's section 6 below, only needed if you want
    that feature at all).
22. Then paste and run `supabase/schema_wise_reconciliation.sql` (two new
    tables for Wise auto-reconciliation, same service-role-only pattern —
    nothing to configure here yet either, that's section 7 below).
23. Then paste and run `supabase/schema_mfa_backup_codes.sql` (one new
    table for 2FA backup-code recovery, same service-role-only pattern —
    no separate setup section for this one, it just works once this is
    run and the service role key below is in place).
24. Then paste and run `supabase/schema_fix_invite_workspace_signal.sql`
    (corrects the workspace-isolation trigger from step 15 — it turned out
    to rely on a Supabase-internal field, `invited_at`, that isn't
    reliably set by `inviteUserByEmail()` on current Supabase versions, so
    invited teammates were still getting a stray personal workspace
    despite step 15 having been run correctly). **If anyone was invited
    before you run this file**, re-run `cleanup_redundant_workspaces.sql`
    (see "Cleaning up existing extra workspaces" below) afterward to
    remove any stray workspace they already picked up — it's a general
    query, not tied to one specific person, so it'll safely catch anyone
    it applies to.
25. Then paste and run `supabase/schema_profile_nickname.sql` (adds an
    optional `nickname` column to profiles — no RLS changes needed, the
    existing "users can update their own profile" policy already covers
    it since it's row-level, not column-level).
26. Then paste and run `supabase/schema_recurring_invoice_idempotency.sql`
    (replaces the recurring-invoice generation function to add a
    duplicate-generation guard — locks the template row during
    generation and rejects a second call for the same template within
    5 minutes of the last one, so the daily cron and a manual "Generate
    now" click landing close together can't create two invoices for the
    same period).
27. Then paste and run `supabase/schema_rate_limits.sql` (a small shared
    table used to rate-limit two endpoints that had no limit before:
    inviting teammates, capped at 20 per workspace per hour, and Google
    Calendar's OAuth connect step, capped at 10 per person per 10
    minutes — see `api/_rateLimit.js`).
28. Then paste and run `supabase/schema_backups.sql` (adds
    `list_public_tables()`, a small helper the daily backup export uses
    to discover every table without a hardcoded list, plus a private
    `backups` Storage bucket for it to write to — see section 8 below).
29. Then paste and run `supabase/schema_error_log.sql` (a small table
    the admin dashboard's System Health tab reads from — see section 9
    below. Optional: skip it and that tab's "Recent server errors" list
    just stays empty, everything else on the page still works).
30. Then paste and run `supabase/schema_share_view_rate_limit.sql` (rate-limits
    the public project-share link's view RPC — 60 views per 10 minutes per
    share token — enforced inside the Postgres function itself since that
    RPC is called directly from the browser with no `api/*.js` function in
    front of it. **If you're applying this on an existing project, check
    whether you already ran this one** — it was written in an earlier
    session but missed being added to this numbered list until now, so it's
    easy to have the file without having actually run it.)
31. Then paste and run `supabase/schema_rls_performance_indexes.sql` (adds
    indexes on columns that RLS policies filter by but that had no index
    yet — most importantly `task_assignees.user_id` and
    `task_assignees.org_id`, which the My Tasks page and the Reports page's
    Project Rollup tab both query directly; without an index, either query
    forces a full scan of that whole table across every org, not just
    yours, and that scan gets slower as total row count grows. Safe and
    additive — adds indexes only, changes no policies or behavior.)
32. Then paste and run `supabase/schema_chat.sql` (adds team chat — see
    "How team chat works" below. Includes a security-definer function for
    starting direct messages and turns on Supabase Realtime for the new
    `chat_messages` table. Safe to re-run.)
33. Then paste and run `supabase/schema_chat_read_state.sql` (adds the
    unread-badge tracking for chat — a small table plus a function that
    counts unread messages per conversation, both scoped so each person
    only ever sees their own read state. Safe to re-run. Must run AFTER
    `schema_chat.sql`, since it references `chat_conversations` and
    `chat_messages`.)
34. Then paste and run `supabase/schema_chat_mentions.sql` (adds @mention
    tracking, extends the notifications type check to add `chat_mention`,
    and replaces `get_unread_chat_counts()` with a version that also
    returns a per-conversation mention count — see "How team chat works"
    below. Safe to re-run. Must run AFTER both `schema_chat.sql` and
    `schema_chat_read_state.sql`.)
35. Then paste and run `supabase/schema_clients.sql` (adds clients as a
    real entity — the new **Clients** page — plus a nullable `client_id`
    link on projects, tasks, invoices, and recurring invoice templates.
    Existing client names already on those records are automatically
    turned into client records and linked, per-workspace, matched
    case/whitespace-insensitively — see "How the Clients page works"
    below. Safe to re-run: re-running finds nothing left to backfill.)
36. Then paste and run `supabase/schema_billing_info.sql` (adds three
    nullable columns to `organizations` — biller name, company, address —
    edited from **Settings → Billing** and shown as the letterhead on
    every invoice PDF. No backfill, no constraints, nothing to preview
    first; every existing org just starts with these unset.)
37. Then paste and run `supabase/schema_stripe.sql` (adds two new tables —
    `stripe_connections` for the secret key + webhook signing secret,
    service-role only; `stripe_events` for incoming webhook payments,
    admin-readable — plus four nullable columns on `invoices` for the
    per-invoice payment link. No backfill, nothing to preview first;
    see "Optional: Stripe payments" below.)
38. Then paste and run `supabase/schema_client_brand_guidelines.sql` (adds
    a `brand_guidelines` text column to `clients` — see "How the Clients
    page works" below — and renames the old `tasks.brand_guidelines`
    column to `tasks.description` now that it's purely task-scoped notes.
    The rename preserves whatever's already typed into that field on
    existing tasks; nothing is migrated over to the new client field
    automatically. Safe to re-run: the rename only happens once.)
39. Then paste and run `supabase/schema_multi_role_assignees.sql` (lets one
    person hold more than one role on the same project or task — e.g. a
    solo freelancer doing the whole project alone. Replaces the old
    `project_assignees`/`task_assignees` primary key of `(project_id/
    task_id, user_id)` with a surrogate id plus a `(project_id/task_id,
    user_id, role_label)` uniqueness constraint. Existing assignment rows
    are preserved as-is — this only changes what's *allowed going
    forward*, nothing is deleted or altered. Safe to re-run.)
40. Then paste and run `supabase/schema_task_templates.sql` (adds
    `task_templates` and `task_template_items` — reusable task lists you
    can apply to a new or existing project instead of typing tasks in by
    hand each time — see "How task templates work" below. Seeds four
    starter templates per existing workspace: Website Building, Website
    Makeover, Video Editing, and System Workflows. These are a draft
    starting point, not a fixed list — edit, add to, or delete them
    freely from the Task Templates page afterward. Does not retroactively
    seed a workspace created after this file is first run; that workspace
    just starts with zero templates, same as it starts with zero clients.
    Safe to re-run.)
41. Then paste and run `supabase/schema_admin_mfa_reset.sql` (widens the
    notifications table's allowed types so a workspace owner/admin can
    reset a locked-out teammate's two-factor authentication from the Team
    page — see "How two-factor authentication works" below. No new table;
    this just lets `api/mfa.js` notify the affected person afterward. This
    file also fixes a real bug it uncovered: three earlier migrations had
    each widened the same constraint without including the type(s) the
    migration before them had added, so on a database with real usage this
    one can hit `ERROR: check constraint "notifications_type_check" ... is
    violated by some row` — if you see that, it means this file's list
    now includes every notification type actually in use; it's expected
    to succeed. Safe to re-run.)
42. Then paste and run `supabase/schema_notification_insert_resilience.sql`
    (the other half of that fix — every trigger that writes to
    `notifications` now catches its own insert failing instead of letting
    the exception roll back the actual action, e.g. adding a task note or
    assigning someone to a project. Before this, the same class of bug
    above could silently break those actions entirely, not just skip a
    notification. No schema change, just hardens seven existing trigger
    functions. Safe to re-run.)
43. Then paste and run `supabase/schema_onboarding.sql` (adds one nullable
    column, `profiles.onboarding_completed_at`, gating the first-time
    `/welcome` walkthrough every new signup sees — see "How onboarding
    works" below. Existing profile rows get backfilled as already-onboarded
    in the same run, so this won't force a first-time flow onto anyone
    already using Pipeline. Safe to re-run — the backfill only ever fires
    once, the run that actually adds the column.)
44. Then paste and run `supabase/schema_time_tracking.sql` (adds time
    tracking — a start/stop timer plus manual entries against a task, an
    org-wide default hourly rate overridable per project, and the
    plumbing an invoice uses to pull unbilled time in as a line item —
    see "How time tracking works" below. No new API key or serverless
    function needed; this one's entirely schema + RLS + client code.
    Safe to re-run.)
45. Go to **Project Settings → API**. Copy:
    - **Project URL** → this is `VITE_SUPABASE_URL`
    - **anon public key** (may be labeled **"Publishable key"** in newer
      Supabase projects, formatted like `sb_publishable_...`) → this is
      `VITE_SUPABASE_ANON_KEY`
    - **service_role key** (may be labeled **"Secret key"** in newer
      projects, formatted like `sb_secret_...`) → this is needed for eight
      optional server-side features: the daily digest (section 4),
      inviting teammates (section 5), Google Calendar sync (section 6),
      Wise auto-reconciliation (section 7), automated backups (section 8),
      the admin dashboard (section 9), Stripe payments (section 10), and
      2FA recovery (backup codes and admin-assisted reset both use it).
      Skip all eight and you can skip this key
      entirely. If you use any of them, keep it aside for those sections.
      **Never** put it in `.env.example`, never prefix it `VITE_` (that
      would bundle it into client-side JS), never commit it anywhere.
46. (Optional, recommended for real use) Under **Authentication → Providers →
    Email**, you can turn off "Confirm email" while testing, or leave it on
    and confirm via the email Supabase sends.
47. **Do this one before licensing to anyone else.** The app's own signup and
    set-password forms now enforce a real password policy (see "Password
    strength" under Known limitations), but that check runs in the browser —
    someone could still call Supabase's API directly with a weak password
    and bypass it. Close that gap in the same **Authentication → Providers →
    Email** screen, under **Password Requirements**: set **Minimum password
    length** to `10` (matches the app's own minimum, so both stay in sync).
    You can optionally also set the character-requirement dropdown to
    require a mix of letters and numbers, though the app deliberately
    doesn't force that client-side — long passwords without forced symbols
    tend to be both stronger and less likely to get reused elsewhere.
    "Prevent use of leaked passwords" (checks against HaveIBeenPwned) is
    also in this screen but is a Supabase **Pro plan** feature — not
    available on the free tier this project currently runs on.

### Cleaning up existing extra workspaces

Skip this if you haven't invited anyone yet, or if this is a brand-new
project — nothing to clean up. If you *have* already invited people before
running `schema_single_workspace_invites.sql` in step 15 **or**
`schema_fix_invite_workspace_signal.sql` in step 24, some of them may
have ended up with an extra, unused personal workspace (landing on "No
projects yet" until they manually switched workspaces). This one query
covers both cases — it doesn't check *why* a workspace is stray, just
whether it currently looks stray, so re-running it after step 24 safely
picks up anyone missed by the first fix too.

1. Open `supabase/cleanup_redundant_workspaces.sql`. Read its header first —
   this is the one file in this whole project that deletes data, so it's
   worth understanding before running any of it.
2. Run **only the SELECT query** (the first half of the file) in the SQL
   editor. Review the list it returns — every row should be someone you
   recognize who ended up with a leftover empty workspace, not anything
   you actually want to keep.
3. Only if that list looks right: find the commented-out `DELETE`
   statement lower in the same file, select just that block (not the
   file's explanatory comments), and run it deliberately.
4. The conditions in the query are deliberately conservative — a workspace
   only gets flagged if its *only* member is its own owner, that owner
   also belongs to at least one other real workspace, and it has zero
   projects/tickets/invoices/calendar events. A workspace anyone's actually
   used, even a little, is left alone.

**Free tier note:** the project pauses after 7 days with no activity — a
dashboard visit un-pauses it, data isn't deleted. Supabase's free tier still
has no point-in-time recovery, but this no longer means "no backup at all" —
section 8 below sets up a daily automated export instead of relying on
remembering to click through Table Editor.

## 2. Local development

```bash
cd pipeline-app
npm install
cp .env.example .env
# paste your Supabase URL + anon key into .env
npm run dev
```

Visit the local URL Vite prints (usually `http://localhost:5173`).

Every push and PR to `main` also runs a build+lint check automatically via
GitHub Actions (`.github/workflows/ci.yml`) — nothing to configure, it just
runs. See README, "How CI works" for what it does and doesn't cover.

## 3. Deploy (Vercel, free tier)

1. Push this folder to a new GitHub repo:
   ```bash
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com) → New Project → import the repo.
3. Vercel auto-detects Vite. Before deploying, add the two environment
   variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under
   **Settings → Environment Variables**.
4. Deploy. You'll get a `*.vercel.app` URL.

(Netlify works the same way — "Add new site → Import an existing project",
same two env vars, build command `npm run build`, publish directory `dist`.
Note: the optional daily digest below is Vercel-specific, since it uses
Vercel Cron Jobs.)

## 4. Optional: automated daily digest + recurring-invoice automation

Skip this entirely if you're fine generating recurring invoices manually
and don't need email reminders — everything else in the app works without
it. This wires up `api/daily-digest.js`, which does two things once a day:
emails people their digest, and auto-generates any recurring invoice that's
come due.

1. **Create a free Resend account** at resend.com — 3,000 emails/month,
   100/day, permanently free (not a trial).
2. **Verify a domain** under Resend → Domains. Free tier allows one. If you
   don't have a domain, Resend's shared test sender only delivers to the
   email address your Resend account is signed up with — fine for testing
   solo, not for a real team.
3. Grab your **Resend API key** (Resend → API Keys).
4. Generate a random secret for `CRON_SECRET` — anything 16+ characters
   works, e.g. run `openssl rand -hex 16` locally.
5. In Vercel → your project → Settings → Environment Variables, add:
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 45 above. This key
     bypasses every RLS policy in the database, so it must only live here,
     server-side. It's deliberately never referenced anywhere in `src/`
     (only `api/daily-digest.js` reads it) and deliberately never prefixed
     `VITE_`, so Vite has no way to accidentally bundle it into client-side
     code even by mistake.
   - `RESEND_API_KEY` — from step 3.
   - `CRON_SECRET` — from step 4. Vercel automatically sends this as a
     Bearer token when it invokes the cron job, and the function checks it
     before doing anything — so nobody else can trigger it by guessing the URL.
   - `DIGEST_FROM_EMAIL` (optional) — e.g. `Pipeline <reports@yourdomain.com>`
     once your domain is verified. Falls back to Resend's shared test
     sender if you skip this.
6. Redeploy (env var changes need a new deployment to take effect).
7. `vercel.json` already schedules the job for `0 22 * * *` (22:00 UTC
   daily = 6am in the Philippines). Vercel Cron is UTC-only, and Hobby
   accounts are capped at once a day with the actual run time only
   guaranteed within that hour — adjust the hour in `vercel.json` for your
   timezone, commit, and redeploy.
8. Test it manually before trusting the schedule:
   `curl -X POST https://your-app.vercel.app/api/daily-digest -H "Authorization: Bearer YOUR_CRON_SECRET"`
   A healthy response looks like
   `{"orgsProcessed":1,"invoicesGenerated":0,"emailsSent":0,"errors":[]}` —
   `emailsSent: 0` on a quiet day is correct, not broken (see README,
   "How notifications work").
9. Each person controls what they get (or whether they get anything at all)
   from Settings → Email notifications — defaults to everything on.

## 5. Optional: inviting teammates

Skip this if you're working solo — everything else in the app works
without it, and you can always add people manually later. This wires up
`api/invite-member.js`, called from the **Team** page when an admin invites
someone by email.

1. If you already set up `SUPABASE_SERVICE_ROLE_KEY` for the digest above,
   you're most of the way there — this reuses the same key.
2. In Vercel → your project → Settings → Environment Variables, add (if not
   already present from section 4):
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 45 above.
   - `SITE_URL` (optional) — e.g. `https://your-app.vercel.app`. Used to
     build the link in the invite email. If you skip this, it falls back
     to whatever domain the request came in on, which is usually correct.
3. Redeploy so the env vars take effect.
4. In Supabase → **Authentication → URL Configuration**, check **two
   separate settings** — missing either one causes the exact same symptom:
   the invite email arrives fine, but clicking it lands on a broken
   `localhost:3000` link instead of your real site (Supabase doesn't error
   when this is misconfigured; it just silently uses the wrong URL).
   - **Site URL** — often still set to its default of `http://localhost:3000`
     from when the project was first created. Change it to your real
     deployed URL, e.g. `https://your-app.vercel.app`.
   - **Redirect URLs** — add `https://your-app.vercel.app/login` to this
     allow-list too. Supabase only honors a custom `redirectTo` (which is
     what points the invite link at `/login` specifically) if that exact
     URL is present here; otherwise it silently falls back to the Site URL
     above instead, landing on the homepage rather than the login screen.
   - **Important:** this only affects invite emails sent *after* you fix
     it. If you already sent one before making this change, that specific
     email's link is baked with the old (wrong) URL — send that person a
     fresh invite from the Team page rather than trying to fix the old link.
5. Optional: customize the wording of the invite email itself under
   **Authentication → Email Templates → Invite user**.
6. From the **Team** page (any admin/owner), enter a teammate's email and
   role, then **Send invite**:
   - If that email already has a Pipeline account (from anywhere, any
     workspace), they're added to yours immediately — no email sent, since
     they don't need one.
   - If it's a new email, Supabase creates their account and sends them an
     invite email. Clicking it logs them in automatically and shows a
     **"Set your password"** screen (built specifically because Supabase's
     invite flow doesn't include one on its own) — once they set one,
     they'll see your workspace in their workspace switcher going forward.
7. **This only works once deployed to Vercel** (or another host running the
   `api/` function) — trying it against `npm run dev` locally will show a
   clear error explaining that, rather than failing silently.
8. **If someone's invite link ever broke** (e.g. it was sent before you'd
   corrected Site URL / Redirect URLs, so it pointed somewhere dead) —
   re-inviting them from the Team page won't fix it. Once their account
   exists at all, `invite-member.js` treats them as "already has an
   account" and just adds them, skipping the email entirely. The fix is the
   **"Forgot password?"** link on the login screen — it sends a fresh,
   correctly-addressed link regardless of how the account was originally
   created.

## 6. Optional: Google Calendar sync

Skip this if you don't need it — the Calendar page works fine without it,
this just adds two-way sync with each person's own Google Calendar. This
is the most involved optional feature to set up, since it needs a real
Google Cloud project on your end, not just an env var. Budget 15-30
minutes the first time.

**What it actually does, honestly scoped:** each person connects their
*own* Google account from Settings. From then on, creating, editing, or
deleting a Calendar event in Pipeline pushes that change out to *every*
connected person's Google Calendar within moments (whoever made the
change doesn't need to be connected themselves). The other direction —
Google → Pipeline — isn't instant the same way: it happens when a
connected person opens the Calendar page (a one-time pull each visit) or
hits **Sync now**, plus a once-a-day cron job as a backstop so changes
still land even if nobody opens the page for a while. Real two-way sync,
just not real-time in the Google→Pipeline direction — see "Known
limitations" for why (short version: Vercel's free tier caps cron jobs at
once a day, and proper real-time needs Google push-notification webhooks,
which is a bigger lift than this warranted for a first version).

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (top-left project dropdown → New Project) — any
   name, e.g. "Pipeline Calendar Sync". If you already have Google
   Workspace for your business, note that for step 3 below.
2. **APIs & Services → Library**, search **Google Calendar API**, click it,
   **Enable**.
3. **APIs & Services → OAuth consent screen** takes you to what Google now
   calls the **Google Auth Platform**. On a fresh project it shows "Google
   Auth Platform not configured yet" — click **Get started** and work
   through its 4-step wizard:
   - **App information**: an app name (e.g. "Pipeline") and a user support
     email (your own is fine) → Next.
   - **Audience**: **External**, unless you have Google Workspace and only
     your own organization will ever connect — then **Internal** avoids
     everything mentioned about test users and token expiry below
     entirely. Most people reading this should pick External. → Next.
   - **Contact information**: an email Google can reach you at about this
     project → Next.
   - **Finish**: agree to the Google API Services User Data Policy →
     **Continue** → **Create**.
   That creates the base configuration; three more things need setting up
   from the left-hand nav afterward:
   - **Audience** page → **Test users** → **Add users** → your own Google
     email and anyone else on the team who'll connect (External +
     Testing only). Without this, Google blocks the connection entirely
     for anyone not listed.
   - **Data Access** page → **Add or remove scopes** → add
     `.../auth/calendar` (full calendar access — needed for real two-way
     sync, not just reading) and `.../auth/userinfo.email` (so Settings
     can show which account is connected) → **Update** → **Save**.
   - **Clients** page is where the actual OAuth client gets created —
     that's step 4 next.
4. **Google Auth Platform → Clients → Create client**:
   - **Application type**: **Web application**.
   - **Authorized redirect URIs**, add both (yes, both, even if you only
     use one today):
     - `https://your-app.vercel.app/settings` (your real deployed URL)
     - `http://localhost:5173/settings` (for local dev, if you ever use
       `npm run dev` to test this feature — Vite's default port)
   - **Create**. Copy the **Client ID** and **Client Secret** it gives you.
5. In Vercel → your project → Settings → Environment Variables, add:
   - `VITE_GOOGLE_CLIENT_ID` — the Client ID from step 4. Public and
     client-side by design (same as the Supabase anon key) — this is why
     it's fine to also put a placeholder in `.env.example`.
   - `GOOGLE_CLIENT_SECRET` — the Client Secret from step 4. Server-only,
     same handling as the Supabase service role key: never `.env.example`,
     never `VITE_` prefixed, never committed anywhere.
   - `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` — if you didn't already
     set these up for the digest (section 4), do that now too; the sync
     endpoints reuse both.
6. Redeploy so the env vars take effect.
7. **About that "unverified app" warning:** while your OAuth consent
   screen is in Testing (or Production-but-unverified — see below), Google
   shows anyone connecting a scary-looking "Google hasn't verified this
   app" screen. That's expected and safe here — it's *your own* app. Click
   **Continue** (Google's wording for this has changed over time — it may
   show as "Advanced → Go to [your app name] (unsafe)" instead, same
   meaning either way) to proceed. Google shows this for any app that
   hasn't been through their formal verification process (a real security
   audit), which almost nobody needs for a small-team internal tool with a
   handful of users.
8. **The Testing-mode 7-day catch:** while the app stays in Testing status,
   Google expires everyone's refresh token after exactly 7 days, meaning
   the connection silently breaks and needs reconnecting on the same
   schedule. To avoid that, once you've confirmed it works, go to
   **Google Auth Platform → Audience** and change **Publishing status**
   from Testing to **In production**. For an app like this one — under 100
   users, not requesting Gmail/Drive-level scopes — that does *not*
   require Google's full verification/security-
   audit process; it just removes the 7-day cap and the 100-test-user
   limit, and connecting still shows the same "unverified app" click-
   through from step 7 above (a small, one-time inconvenience per person
   who connects, not a real blocker).
9. From **Settings**, click **Connect Google Calendar**, approve access,
   land back on Settings connected. Click **Sync now** to pull in whatever
   already exists on that Google Calendar.

## 7. Optional: Wise auto-reconciliation

Skip this if you don't need it — invoices work fine without it, just
requiring you to mark them paid by hand. This one's simpler to set up than
Google Calendar sync (no OAuth, no Google Cloud project), but it's worth
knowing upfront that it **only works for Wise accounts based in the US,
Canada, Australia, New Zealand, Singapore, or Malaysia** — a restriction
on Wise's own API, not something around here. If your Wise account isn't
in one of those countries, this section will still let you connect (and
tell you honestly that it won't find anything), but there's no path
around that restriction short of Wise changing their own policy.

**Also worth knowing:** this was built carefully against Wise's
documented API, but without an actual eligible account to test end-to-end
during development. Treat it as "ready to try, not yet proven" the first
time you connect a real qualifying account — see `api/_wiseAuth.js` if a
field name or response shape needs a small adjustment.

1. Log into your Wise account (Business account required — personal
   accounts can't generate API tokens at all) → **Your Account →
   Integrations and tools → API tokens** (exact wording may vary slightly
   depending on Wise's current dashboard layout).
2. Create a **personal API token**. Copy it — like the Supabase service
   role key, this is a real secret; don't paste it anywhere public, and
   don't put it in `.env.example`.
3. In Pipeline, go to **Settings** (as an admin/owner — this card doesn't
   show for regular members) and paste the token into the **Wise
   auto-reconciliation** card, click **Connect**.
4. Pipeline immediately tries a real API call to check whether this
   account's country supports it. If it does, you'll see "Connected —
   account confirmed eligible." If not, you'll see the honest explanation
   instead — the token is still saved either way, so nothing needs
   redoing if the account's status ever changes.
5. If eligible, click **Reconcile now** to pull the last 30 days of
   transactions and see it match against any open invoices. From then on,
   it also runs automatically once a day.

## 8. Optional: automated backups

Skip this if you're fine exporting data by hand occasionally — everything
else in the app works without it. This wires up `api/backup-export.js`,
which runs once a day and writes a full JSON export of every real data
table to a private Storage bucket, keeping the last 14 days and pruning
anything older automatically. It reuses `SUPABASE_SERVICE_ROLE_KEY` and
`CRON_SECRET` — if you already set those up for the digest (section 4),
Google Calendar sync (section 6), or Wise reconciliation (section 7),
there's nothing new to add here.

**Read this before relying on it:** this closes the "nothing is actually
backed up" gap, but it's an export, not a restore button — there is no
`api/backup-restore.js`. If you ever genuinely need to restore from one of
these files, `supabase/RESTORE_PROCEDURE.md` is the step-by-step runbook
(stated RPO/RTO included) and `scripts/restore-backup.js` actually runs
it — re-inserts every table's rows in the correct dependency order via
`SUPABASE_SERVICE_ROLE_KEY`, upserting so it's safe to re-run after a
partial failure. Run it with `--dry-run` first, always. Four tables —
`google_calendar_connections`, `wise_reconciliation_connections`,
`stripe_connections`, `mfa_backup_codes` — have their live credential
columns stripped out of every export on purpose (see README, "How
backups work"), so a restore would need Google Calendar/Wise/Stripe
reconnected and MFA backup codes regenerated afterward — the runbook
lists exactly who needs to redo what. That's the deliberate trade-off,
not a bug. One honest caveat: the restore procedure is documented and
scripted, but hasn't been run end-to-end against a real disaster yet —
see the status note at the top of `RESTORE_PROCEDURE.md`.

1. `vercel.json` already schedules the job for `0 3 * * *` (03:00 UTC
   daily, ahead of the other three crons) — adjust the hour if you want
   it to line up with a specific timezone, commit, and redeploy.
2. Test it manually before trusting the schedule:
   `curl -X POST https://your-app.vercel.app/api/backup-export -H "Authorization: Bearer YOUR_CRON_SECRET"`
   A healthy response looks like
   `{"file":"pipeline-backup-2026-08-21.json","tablesExported":27,"totalRows":143,"sizeBytes":58213,"errors":[]}`
   — a non-empty `errors` array means some tables failed to export (check
   Vercel's logs for the specific reason) but doesn't mean the whole run
   failed; whatever did succeed is still in the file.
3. Confirm the file actually landed: Supabase dashboard → **Storage** →
   **backups** bucket. You should see today's file. Nothing else needs
   doing — the bucket, the cron, and the rotation are all already wired up.

## 9. Optional: platform admin dashboard

Skip this if you don't need a cross-org view yet — everything else in the
app works without it. This wires up `/admin`, a platform-wide dashboard
(every organization at once) visible only to you, not to org
owners/admins. Mostly two env vars and a redeploy — one schema file
(`schema_error_log.sql`, step 29 above) is optional and only affects the
System Health tab's "Recent server errors" list; skip it and that list
just stays empty.

**Read this before setting it up:** it's genuinely two separate env vars
set to the *same* email address, not one. This is the same shape of
mistake that caused the whole Google Calendar `GOOGLE_CLIENT_ID` vs
`VITE_GOOGLE_CLIENT_ID` saga back in section 6 — a server-only var and a
`VITE_`-prefixed client var that happen to need identical values but are
genuinely different settings in Vercel's dashboard. Setting only one gets
you either "the Admin link never appears" (only the server one set) or
"the link appears but every action 403s" (only the client one set).

1. Make sure the code that adds this feature has actually been pushed to
   GitHub (`git push origin main` from the delivered folder) — Vercel
   only rebuilds when it sees a new commit. Easy to skip by accident if a
   session's delivery gets mixed up with unrelated Vercel dashboard work.
2. In Vercel → your project → Settings → Environment Variables, add
   **both**:
   ```
   VITE_PLATFORM_ADMIN_EMAIL=you@example.com
   PLATFORM_ADMIN_EMAIL=you@example.com
   ```
   (same email on both — whichever address you sign into Pipeline with.)
3. Redeploy (env var changes need a new deployment to take effect, same
   as every other `VITE_`-prefixed var — Vite bakes these in at build
   time).
4. Log in with that email, click your name in the top-right, and confirm
   an **Admin** link now shows up alongside Team/Settings. Click it.
5. You should land on four tabs: **Overview** (platform-wide totals + a
   per-org breakdown), **Organizations** (every org's roster, with role
   changes and member removal), **Usage** (attachment storage + invoice
   totals per org — not a billing view, see README), and **System
   health** (integration config status, latest backup age, connection
   counts, and a best-effort recent-errors list).
6. If the link doesn't show up: double-check `VITE_PLATFORM_ADMIN_EMAIL`
   matches the email you're actually logged in with (case doesn't
   matter, but typos do), that you redeployed after adding it, and that
   step 1's push actually happened — a global search for your own email
   inside the browser's loaded `.js` files (DevTools → Sources →
   Cmd/Ctrl+Shift+F) tells you for certain whether the var reached this
   build at all.
7. If the link shows up but the page errors on load: that's almost
   certainly `PLATFORM_ADMIN_EMAIL` (no `VITE_` prefix) missing or
   mismatched on the server side — check it's set and redeploy.
8. If you redeployed and it's *still* showing the old version with no
   errors at all: the app is a PWA with a service worker that caches the
   app shell — see "How the service worker works" below for how that's
   handled. If you're hitting this on a browser that visited the site
   *before* that fix shipped, its already-installed service worker won't
   self-update from bytes alone; DevTools → Application → Storage →
   **Clear site data**, then hard-reload, clears it out one time.

## 10. Optional: Stripe payments

Skip this if Wise (section 7) already covers how your clients pay, or if
you don't need auto-reconciliation at all — invoices work fine with
neither, just requiring you to mark them paid by hand. Unlike Wise's one
permanent reusable link, this generates a fresh, exact-amount Stripe
payment link per invoice, and matches payments back automatically the
moment Stripe tells Pipeline they succeeded — no daily poll, no reference-
text guessing.

**Also worth knowing:** this was built carefully against Stripe's
documented API and webhook-signing behavior, but without an actual live
account processing a real payment during development. Treat it as "ready
to try, not yet proven" the first time you connect a real account — see
`api/_stripeAuth.js` if a field name or response shape needs a small
adjustment.

1. Log into your Stripe Dashboard → **Developers → API keys**. Copy the
   **Secret key** (`sk_live_...` for real payments, `sk_test_...` while
   trying this out with Stripe's test mode) — like the Wise token and the
   Supabase service role key, this is a real secret; don't paste it
   anywhere public, and don't put it in `.env.example`.
2. In Pipeline, go to **Settings** (as an admin/owner — this card doesn't
   show for regular members) and find the **Stripe payments** card. Copy
   the webhook URL shown there (`/api/stripe?orgId=<your org id>`,
   already filled in).
3. Back in Stripe → **Developers → Webhooks → Add endpoint**, paste that
   URL, and select the `checkout.session.completed` event (add
   `checkout.session.async_payment_succeeded` too if you want delayed
   payment methods like bank debits covered — Stripe explains the
   difference on that same screen).
4. Stripe shows you a **signing secret** (`whsec_...`) for the endpoint
   you just created. Copy it.
5. Back in Pipeline's Settings, paste both the secret key and the webhook
   signing secret into the Stripe payments card, click **Connect**.
   Pipeline immediately makes a real API call to verify the secret key —
   a typo or wrong-account key is caught right here, not the first time
   someone tries to pay.
6. Open any invoice as an admin and click **Generate Stripe payment
   link**. The link appears on the invoice (and on its printed/PDF view)
   right away — try opening it to confirm it loads the correct amount in
   Stripe's own checkout page (use one of
   [Stripe's test card numbers](https://docs.stripe.com/testing) if
   you're still in test mode).
7. Pay it (or use a test card) and confirm the invoice flips to **paid**
   in Pipeline within a few seconds — that's the webhook round-trip
   working. If it doesn't, check Stripe → Developers → Webhooks → your
   endpoint → recent deliveries for the actual error Stripe received.
8. If a payment ever comes in through a Stripe Payment Link that wasn't
   generated by Pipeline (created by hand in the Stripe Dashboard, say),
   it'll show up in the **Unmatched Stripe events** panel on the Invoices
   page instead of auto-matching — pick the right invoice from the
   dropdown there and confirm, or dismiss it if it's unrelated.

## 11. Optional: Google sign-in

Skip this if email + password is enough — the login/signup form works
fine without it. This adds a **"Log in / Sign up with Google"** button to
the login page, using Supabase Auth's own built-in Google provider —
**not** the Google Calendar integration from section 6, and worth being
precise about the difference so the two don't get tangled together:

|                        | Section 6 (Calendar sync)                | This section (sign-in)              |
|------------------------|-------------------------------------------|--------------------------------------|
| What it's for          | Reading/writing *your* Google Calendar    | Proving who you are to log in        |
| Who handles the OAuth  | Pipeline's own code (`api/google-calendar.js`) | Supabase Auth, entirely       |
| Client ID/Secret live  | Your Vercel env vars                      | Supabase Dashboard only, never in this repo |
| Redirect URI           | `your-app.vercel.app/settings`            | `<project-ref>.supabase.co/auth/v1/callback` |

Because Supabase manages the whole exchange itself, there's **no new env
var, no new schema, and no new serverless function** — the button calls
`supabase.auth.signInWithOAuth({ provider: 'google' })` directly from the
browser and Supabase does the rest. Use a **separate** Google Cloud OAuth
client from section 6's — reusing the same one works technically (Google
allows multiple redirect URIs per client), but keeping them separate means
editing one integration's credentials can never accidentally break the
other.

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   same project as section 6 if you set that up already (or a fresh one —
   this doesn't need the Calendar API enabled at all). **APIs & Services →
   Credentials → Create Credentials → OAuth client ID**.
   - If this project has no OAuth consent screen yet, Google walks you
     through the same short wizard as section 6, step 3 — App information,
     Audience (**External**), Contact information, Finish. If section 6
     already set one up, this reuses it.
   - **Application type**: **Web application**. Name it something that
     tells the two apart later, e.g. "Pipeline Sign-In" (vs. "Pipeline
     Calendar Sync").
   - **Authorized redirect URIs** — add exactly one, Supabase's own
     callback URL, not your app's: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (find `<your-project-ref>` in your Supabase project's URL, or under
     **Project Settings → General**).
   - **Create**. Copy the **Client ID** and **Client Secret**.
2. In the Supabase dashboard: **Authentication → Sign In / Providers →
   Google**. Toggle it on, paste the Client ID and Client Secret from step
   1, **Save**. That's the only place these two values live — never add
   them to Vercel or `.env.example`.
3. No redeploy needed for the Supabase-side toggle, but if you haven't
   redeployed since adding the "Log in / Sign up with Google" button
   itself, push/redeploy now so it's actually on the page.
4. From the login page, click **Log in with Google**, approve access, and
   confirm you land back in Pipeline signed in. First time with a given
   Google account creates a brand-new Pipeline workspace for it, exactly
   like an ordinary email+password signup (same triggers, same /welcome
   walkthrough); a Google account whose email matches an existing,
   confirmed Pipeline account signs into that same existing account
   instead, via Supabase's own automatic account linking — you should
   **not** end up with two separate accounts for the same person.
5. Confirmed working: signing in with Google using an email that already
   has a Pipeline password account lands you back in that *same* account,
   not a new one — no separate steps needed to test this on your project,
   the default project settings already produce this behavior. (If your
   Supabase project has **"Enable manual linking"** turned on —
   Authentication → Sign In / Providers → the general auth settings, off
   by default — that disables automatic linking project-wide and this
   would create a second account instead; leave that setting off to keep
   the behavior described in #4.)

## 12. Optional: automatic overdue-invoice reminders

Skip this if you'd rather send reminders yourself — every overdue
invoice's page has a **"Send reminder"** button regardless of whether
this section is set up at all; that button works the moment `RESEND_API_KEY`
exists (see section 4), no extra config needed. This section is only for
the *automatic* daily version.

Reuses the exact same env vars as the daily digest in section 4
(`CRON_SECRET`, `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`) — if that's already
deployed, there's nothing new to add to Vercel here at all.

1. Confirm `schema_invoice_reminders.sql` has been run in the Supabase SQL
   editor (adds `organizations.auto_invoice_reminders`, off by default, and
   `invoices.last_reminder_sent_at`).
2. Confirm `vercel.json` includes the `/api/invoice-reminders` cron entry
   (already in this repo) and that section 4's three env vars are set in
   Vercel, then redeploy if you haven't already.
3. **Nothing gets emailed to any client automatically until an admin turns
   it on, per workspace** — go to **Settings**, find **Overdue invoice
   reminders**, and check **Automatically email clients about overdue
   invoices**.
4. Once on, the daily job sends one reminder as soon as a `sent` invoice's
   due date passes, then repeats every 7 days until the invoice is marked
   **Paid**. It reuses the invoice's own Stripe payment link if one was
   generated (section 10), or falls back to the workspace's Wise payment
   link (section 1) — same "Pay now" button either way.
5. Test without waiting for the cron: create an invoice, set its status to
   **Sent** with a due date in the past, then open it and click **Send
   reminder** — this always works immediately regardless of the org
   toggle, and confirms `RESEND_API_KEY` is actually configured correctly
   before trusting the automatic version to run silently overnight.
6. To test the actual cron path (not just the button) once at least one
   workspace has the Settings toggle on:
   `curl https://your-app.vercel.app/api/invoice-reminders -H "Authorization: Bearer YOUR_CRON_SECRET"`
   A healthy response looks like
   `{"orgsProcessed":1,"remindersSent":0,"errors":[]}` —
   `remindersSent: 0` is correct if nothing in that workspace is both
   overdue and past the 7-day reminder cadence yet, not broken.

## 13. Try it

1. Visit the deployed URL (or localhost), sign up with an email + password.
   Try a clearly fake domain first (e.g. `you@thisdomaindoesnotexist12345.com`)
   to confirm it's rejected before the account is created, then sign up
   for real with a real address — see "How email validation works" in
   README.md for exactly what this does and doesn't catch.
2. If you deployed section 11, go back to the login page (log out first)
   and confirm **Log in with Google** is there above the email/password
   form, on both the login and signup views. Try it with a Google account
   whose email you've never used with Pipeline before — it should create
   a brand-new workspace, same as step 1, and land you on `/welcome` too.
3. You should land on **/welcome** before anything else — a four-step
   walkthrough covering every module at a glance. Click through **Next**
   a couple of times, then **Skip for now** rather than finishing it, and
   confirm you land on the Dashboard either way. Log out and back in — you
   should go straight to the Dashboard this time, not back to `/welcome`
   (skipping counts as done). Then open the account menu (top-right) and
   click **Take the tour** to confirm you can always pull it back up
   on demand.
4. On signup, a personal workspace ("Your Name's Workspace") is created for
   you automatically — this is the multi-tenant org the schema is built
   around, so future team members or licensed workspaces slot into the same
   structure without a rebuild.
5. Click **+ New project** — this is its own page now (`/projects/new`),
   not a popup. A client, start date, and due date are required — the
   client field is a picker: choose **+ Add a new client…** to create one
   inline without leaving the page. The three role slots (Graphics
   Designer, Project Manager, Developer) and the attachments section are
   both optional and can also be set later from the project's own page.
   Try adding a link attachment here before submitting — notice nothing
   actually uploads until you hit **Create project**, since there's no
   project id yet to attach it to. Once created you land straight on that
   project. Add a few tasks, click a task's status dot to cycle todo → in
   progress → done, watch the Scrubber move. Back on the main Projects
   list, try the **All / Active / On hold / Completed / Archived** filter
   pills above the grid — set this project's status to Archived from its
   own page, confirm it disappears from **All**, then click the
   **Archived** pill to find it again.
6. Go to **Clients** in the top nav — the client you just created is
   there, with a count of 1 project and 0 tasks/invoices (those come in
   the next couple of steps). Click into it: rename it, add a company and
   website (both save on blur, same as other editable fields in this
   app), and add a file — same link-or-upload attachments component used
   on tasks/tickets/projects. Back on the project page, "View client"
   next to the client name jumps straight back here.
7. Go to **Settings**, paste in your Wise Business permanent payment link
   (grab it from Wise → Payments → "Your open link"). This is a one-time
   setup — every invoice you create from here on will show it automatically.
   While you're there, scroll to **Billing** and fill in your name,
   company, and address (all optional) — this becomes the letterhead on
   every invoice PDF, so it's worth setting before generating the one in
   the next step.
8. Go to **Invoices → New invoice** (admin/owner only — a non-admin won't
   see this button, and every invoice is read-only for them, status badge
   included, once you're logged in as one), pick the client you already
   created (or add another), fill in their email (now required), pick
   whether it's for a project or a specific task
   (also required — you'll need at least one project or task created
   already), and a couple of line items, then save. Open it and hit
   **Print / Save as PDF** to see the client-facing version — the invoice
   number/issue date/due date top-left, the billing info you just entered
   top-right, and the payment link embedded below. If you skipped Billing,
   that top-right spot falls back to your workspace's own name instead of
   sitting empty. If you deployed section 7, that invoice's number (e.g.
   "INV-0004") is exactly what auto-reconciliation looks for in a
   payment's reference text, so a real client payment referencing it
   correctly gets matched automatically.
9. Go to **Calendar** — your project and task due dates already show up
   automatically. Click a day and add a standalone event (a client call,
   a shoot day) to see it merge in alongside them. If you deployed section
   6, connect Google Calendar from Settings first, then create an event
   here and check it lands in your actual Google Calendar within a few
   moments (no page refresh needed) — then create one directly in Google
   Calendar and click **Sync now** back in Pipeline to pull it in.
10. Go to **Tickets → New ticket**, file something with a priority and type,
   then open it and post a comment to see the discussion thread.
11. Go to **Reports** — as an admin/owner you get everything you just
   created rolled up automatically, organized into four tabs (Financial
   summary / Ticket activity / Project rollup / Timeline) plus a
   date-range picker that scopes the first two (and doubles as Timeline's
   zoom control). In Project rollup, click **"Show tasks"** on a project
   to see its tasks grouped by status, each with a status badge,
   assignee(s), dates, and a notes count; check the **Standalone tasks**
   section below the project list too. Click the **Timeline** tab to see
   your project, tasks, ticket, and invoice all plotted on one shared
   date axis in four lanes — click any bar's label to jump to that
   item's own page, and switch the date-range picker to a different
   preset to watch the axis rescale. Try **Print / Save as PDF**
   (includes all four tabs regardless of which is open) and **Download
   CSV** on the invoices, project, and task tables. Log in as a non-admin
   team member and check Reports again — they land straight on Project
   rollup scoped to their own tasks, with no tabs, date-range picker, or
   financial/ticket/timeline data shown at all.
12. Go to **Invoices → Recurring** (also admin/owner only — a non-admin can
   still see the list of templates, just none of the action buttons), set
   up a template for a retainer client, then hit **Generate now** to see
   it create a real invoice immediately — no need to wait for the digest job.
   Hit **Generate now** again right away on the same template to confirm
   the duplicate-generation guard: you should get a clear error instead of
   a second invoice.
13. Open any project and hit **Copy share link**, then open that link in a
    private/incognito window to see exactly what a client would see (no
    login). Back in the project, **Regenerate link** to see the old one stop
    working.
14. Open a task, ticket, or project and add a link attachment — paste any
    URL into the input and click the link icon built into it (or press
    enter) — to see it show up as "File 1" in the list.
15. On that same task, ticket, or project, click the upload icon right
    next to the link input and pick a small file (a screenshot or PDF
    works well) — it should appear as "File 2" right below the link, with
    its file size shown. Click it to confirm it opens correctly (this
    generates a fresh signed URL each time, so it should work even a
    while after uploading). Delete "File 1" and confirm the upload
    renumbers down to "File 1" too — the numbering is always just
    position in the list.
16. If you deployed the digest job in section 4, run the `curl` test from
    step 8 there and confirm you get a response back. Same idea for the
    other three cron jobs if you deployed them — all four endpoints
    handle several things internally (see the "Vercel Hobby plan caps..."
    note in Project structure), but a bare `CRON_SECRET` request always
    hits the cron/all-connections path regardless: Google Calendar sync
    (section 6) — `curl -X POST https://your-app.vercel.app/api/google-calendar -H "Authorization: Bearer YOUR_CRON_SECRET"` —
    Wise reconciliation (section 7) —
    `curl -X POST https://your-app.vercel.app/api/wise-reconcile -H "Authorization: Bearer YOUR_CRON_SECRET"`
    — and the backup export (section 8) —
    `curl -X POST https://your-app.vercel.app/api/backup-export -H "Authorization: Bearer YOUR_CRON_SECRET"`
    — all three should return a JSON summary rather than an error; for the
    backup one specifically, also check Supabase → Storage → `backups`
    for today's file.
17. Go to **Team** — as the workspace's first (and so far only) member,
    you're the Owner, so you'll see the invite form. Try inviting a fake
    address on a nonexistent domain first (e.g.
    `nobody@thisdomaindoesnotexist12345.com`) and confirm you get a clear
    error instead of a "sent" message. If you deployed section 5, then try
    inviting a real second email (even one of your own alt addresses) to
    see the whole flow end to end — once they set a password and log in,
    they should land directly in your workspace, with no separate empty
    one of their own and no workspace switcher cluttering the header (it
    only appears once there's genuinely more than one option to choose
    from).
18. Back on a project, notice the "Add a task" input only appears for
    admins/owners now — everyone else sees a note instead, though they can
    still update status, assignee, and due date on existing tasks. Change a
    task's status or assignee, then scroll to the **Activity** section at
    the bottom of the project page to see it logged automatically.
19. Assign a task to yourself (or have it already assigned from an earlier
    step), then click **My Tasks** in the nav — it should show up there
    too, regardless of which project it's in.
20. Click any task's title anywhere in the app — it now opens its own
    page. Under **Assigned members**, you'll see three fixed rows —
    Graphics Designer, Project Manager, Developer — each with its own
    "choose a member" dropdown; pick someone for one or two of them.
    Click **"+ Add member"** below the three rows to add someone who
    doesn't fit those roles — type whatever you want in the free-text
    role box (or leave it blank) and pick them from the dropdown; try
    swapping the person on that row afterward, and removing it. Post a
    note, and — on a task that has no project — fill in client
    name/website directly on the task. As an admin, try **"+ New task"**
    on My Tasks and leave the project dropdown on "No project
    (standalone)" to see that flow end to end — notice start date is
    already filled in with today, and the same three role slots are right
    there before hitting Create, no follow-up trip to the task's own page
    required. Same three slots show up on a project's own "Add a task"
    row once you start typing a title.
21. Open a project's client share link in a private/incognito window (same
    one from earlier) and scroll to **"Have something to raise?"** — submit
    a test ticket. Back in the main app's **Tickets** page, it should show
    up tagged **Client**, with the submitter's name/email visible on the
    ticket's detail page if they gave one.
22. To see the notification bell live: open the app in two browser windows
    logged in as two different members of the same workspace (or use the
    teammate you invited earlier). In one window, assign a task to the
    other person, or comment on a ticket they're assigned to. Watch the
    bell in their window — it should update within a second or two, no
    refresh needed. Click a notification to jump to what it's about.
23. To see the unified activity log: change an invoice's status (draft →
    sent) or a ticket's priority, then go back to that project's page and
    scroll to **Activity** — you should see the invoice/ticket change
    listed right alongside the task changes from earlier, each tagged with
    what kind of thing it was, all in one combined timeline. Open a ticket
    or invoice directly and its own **Activity** section shows just that
    one thing's history.
24. Go to **Settings** and click **Enable two-factor authentication** —
    scan the QR code with an authenticator app (Google Authenticator,
    Authy, 1Password, etc.), enter the 6-digit code it shows to confirm.
    Right after, you'll see 10 backup codes shown once — save a couple
    somewhere for the next step, then check the acknowledgment box and
    click Done. Then **log out and log back in** with your password — you
    should now land on a "Enter your 6-digit code" screen before reaching
    the app, not straight through. Try navigating directly to a URL like
    `/settings` while that challenge is still outstanding (open a new tab
    and paste the URL, rather than clicking through the login form) to
    confirm it redirects back to the challenge instead of letting you in.
25. On that same challenge screen, click **"Lost your device? Use a
    backup code"** and enter one of the codes you saved. You should land
    back in the app with a notice that 2FA was turned off — check
    Settings to confirm it shows the "Enable two-factor authentication"
    button again rather than "on," meaning the reset actually took (this
    is the one part of this whole setup process built without being able
    to test it against a live call beforehand — genuinely worth
    confirming it works, not just skimming past).
26. Go to **Settings** → **Your profile** and set a full name and a
    nickname. Check the top-right corner immediately — it should update
    to show the nickname without a page reload. Then check **Team**: your
    row should show the nickname as the bold name, with your full name as
    a smaller line underneath it (since they're different). Clear the
    nickname and save again — Team should fall back to showing just the
    full name, no second line.
27. Invite a genuinely new email (one that's never touched this Pipeline
    project before) and have them click through to set their password.
    Once they're in, they should land directly in your workspace with no
    workspace switcher visible at all — if a switcher shows up, they
    picked up a stray second workspace and the fix in step 24 of section 1
    didn't take; re-check that it was actually run. A single invite like
    this should go through with no visible change — the new rate limit
    only blocks after 20 invites from the same workspace within an hour,
    so normal use never touches it.
28. Click your name in the top-right corner and try all three theme
    options. Dark should genuinely look like a dark theme, not just an
    inverted one — check a status badge (a task's TallyDot, an overdue
    invoice) still reads clearly, not washed out. Switch to "System,"
    then change your OS's own light/dark setting — the app should follow
    it live, no reload needed. Reload the page on Dark or Light (not
    System) — it should come back exactly as you left it with no flash of
    the wrong theme first. Last check: print a page (any page, `Ctrl/Cmd
    + P`) while dark mode is active — the print preview should be plain
    light/white, not dark.
29. Go to **Chat** in the top nav — a "General" channel should already be
    there (created automatically on first visit), along with every
    project already listed under Projects. Post a message in General.
    Open the app in a second browser (or an incognito window) as a
    different teammate in the same workspace and confirm it arrives
    live, no refresh needed. Click "+ New" under Direct messages, pick
    that teammate, and send a DM — then check it does NOT show up for a
    third teammate who isn't part of that conversation. Click a project
    to open its thread. Click "+ New" under Tasks, search for a task by
    title, and start its thread — confirm it now appears in the Tasks
    list for other org members too (not just you).
30. Test unread badges: as your second teammate account (still logged
    in from the previous step, on some other page — not the Chat page
    itself), have your main account send a new message into General.
    Confirm a badge appears both on the **Chat** link in the top nav and
    next to General in the sidebar once that teammate opens Chat.
    Click into General as that teammate — both badges should disappear
    immediately, before you'd expect a network round-trip to finish.
    Then, while still viewing General as that teammate, have your main
    account send another message — confirm no badge appears at all,
    since they're already looking at it live.
31. Test @mentions: as your main account, in General, type `@` followed
    by a few letters of your second teammate's name — a dropdown should
    appear filtered to matching org members. Pick them and send. As that
    teammate (on a different page, not Chat), confirm: a bell notification
    appears ("... mentioned you in General"); the Chat nav badge and
    General's sidebar badge both turn amber instead of the usual red;
    and clicking the bell notification opens Chat with General already
    selected, not just the Chat page in general. Open the message itself
    and confirm the `@Name` renders highlighted, not as plain text. Then
    send a message in General that types someone's name as plain text
    without picking them from the dropdown — confirm this does NOT
    generate a notification or an amber badge, since only an explicit
    pick counts as a real mention.
32. Open the account menu (top-right) and click **Task Templates** — the
    four starter templates (Website Building, Website Makeover, Video
    Editing, System Workflows) should already be there. Open one and add
    a task, edit an existing item's title/role/description, then remove
    one — all save immediately, no separate "save" step. Click **+ New
    template**, add a name and a task or two of your own. Then start a
    new project (**+ New project**) and, as an admin, expand **Start from
    a template**: pick one, notice the task list preview and a
    member-picker for each distinct role it uses, optionally assign
    someone, then create the project — its task list should already be
    populated in the template's order. Now open an existing project you
    made earlier and use **Apply a template** there too, to confirm the
    same picker works after the fact, appending onto whatever tasks that
    project already had. Log in as a non-admin and confirm Task Templates
    is still visible and lets you apply a template, but the create/edit/
    delete controls are gone.
33. On your second teammate account, turn on 2FA from Settings (same
    steps as step 24 above — **Enable two-factor authentication**, scan
    the QR code, confirm the 6-digit code). Then, as your main (admin)
    account, go to **Team** and find that teammate's row — click
    **Reset 2FA**, confirm with **Yes, reset**.
    Back on the teammate's account, confirm two things: a login now only
    asks for the password (no 6-digit code), and a bell notification
    explains that their 2FA was reset and by whom. Try clicking **Reset
    2FA** on a member who does NOT have 2FA enabled — confirm it tells you
    there was nothing to reset rather than erroring. Log in as a non-admin
    and confirm the **Reset 2FA** action isn't there on any row, including
    your own.
34. Worth confirming the notification-insert hardening actually holds:
    add a note to a task assigned to someone else, assign a teammate to a
    project, and (if you deployed team chat) @mention someone in a
    message — all three should work normally and produce a bell
    notification for the recipient. These are exactly the three actions
    that could have silently broken on a deployment that had already hit
    the constraint-mismatch bug schema_admin_mfa_reset.sql and
    schema_notification_insert_resilience.sql fix (steps 41-42 above) —
    worth a real check, not just trusting the migration succeeded.
35. Go to **Settings → Billing** and set a **Default hourly rate**, e.g.
    `25`. Open a task, click **Start timer** — confirm the elapsed count
    actually ticks up live. Click **Stop timer** and confirm an entry
    appears in the list below with a duration and a dollar total using
    the rate you just set. Log a second, manual entry (pick yesterday's
    date, type `1.5` hours) and confirm the task's total updates to
    include both. Open the project this task belongs to and confirm the
    same total (plus dollar amount) shows on the project page's own "Time
    logged" line. Then go create an invoice for that project (or task)
    and click **+ Add logged time** — confirm it adds one line item
    totaling both entries at the right rate, and that after saving the
    invoice, going back to the task shows both entries marked **(billed)**.
36. Press **Ctrl/Cmd+K** from anywhere in the app (or click the search
    button in the header) — confirm the search panel opens and auto-focuses
    the input. Type part of an existing project's name, a task's title, a
    client's name, and an invoice number — confirm each returns grouped
    results (Projects/Tasks/Clients/Invoices) and that clicking one
    navigates straight to that record. Press Escape and confirm it closes.
37. Open a project with a few tasks and check two or three of their row
    checkboxes — confirm a bulk action bar appears above the list showing
    "N selected." Use it to set a status and a due date across all of
    them at once, then confirm each row updated. Also try **Select all**,
    then **Clear**. Do the same on **My Tasks** and confirm it offers
    status/due date only (no assignee or delete controls there).
38. On a project's task list, click **Trash** on one task — confirm it
    disappears from the list. Open the account menu and click **Trash** —
    confirm the task shows up there with a "deleted" date. Click
    **Restore** and confirm it's back on the project page. Trash it again,
    then (as an admin) click **Delete permanently** and confirm the
    confirmation prompt, then that it's gone from Trash for good. Log in
    as a non-admin and confirm the **Delete permanently** button doesn't
    appear for them, only **Restore**.
39. Create an invoice with a real client email you can check, set its
    status to **Sent**, and give it a due date in the past — confirm the
    orange "This invoice is overdue" banner appears with a **Send
    reminder** button. Click it and confirm the client inbox actually
    receives the email (requires `RESEND_API_KEY` — see section 4/12).
    Then go to **Settings → Overdue invoice reminders**, turn on
    **Automatically email clients about overdue invoices**, and confirm
    it saves. Log in as a non-admin and confirm they see neither that
    Settings toggle nor the invoice page's **Send reminder** button.
40. Go to **Clients**, click **+ New client**, and fill in a name and an
    email this time, then save. Go to **Invoices → + New invoice** and
    pick that client from the **Client name** dropdown — confirm **Client
    email** fills in on its own and shows as plain text, not a box you can
    click into, with a link to the client's page underneath. Now pick (or
    add) a client with no email on file and confirm the field turns back
    into a normal editable box instead. Open the client you just created
    from the invoice form and confirm its email shows correctly there too.
41. Go to **Invoices → Recurring → + New recurring invoice** and confirm
    it now has the same **Client name** dropdown and auto-filling **Client
    email** as the regular New Invoice form (rather than two plain typed
    boxes). Pick a client with an email on file, save the template, then
    manually trigger `api/daily-digest.js` (section 4) or wait for its
    scheduled run — confirm the invoice it generates has the client
    correctly linked (its detail page shows a **View client** link).
42. First paste and run `supabase/schema_client_contact_info.sql` in the
    Supabase SQL editor (adds `phone` and `address` to `clients`). Then
    open any client's detail page and confirm the info card now shows
    Client name paired with Email, Company paired with Website, then Phone
    number and Address below that — fill in a phone number and an address,
    reload the page, and confirm both saved. Confirm Projects and Invoices
    now render side by side above Tasks, with Brand guidelines, Files, and
    Activity still below in that order.

## Known limitations to know about

- **No explicit "link your Google account" flow from inside Settings** —
  linking only happens implicitly, the moment someone signs in with
  Google using an email that matches an existing account. There's no
  button for an already-logged-in person to proactively attach Google to
  the account they're currently using.
- **The admin dashboard (`/admin`) isn't a billing view**, even though its
  Usage tab shows per-org numbers. Pipeline has no subscription/billing
  system of its own — building one is a separate, bigger feature (payment
  processor integration, plan tiers, etc.) if you ever need it.
- **The admin dashboard's role/removal actions bypass RLS entirely** (it
  runs on the service-role client, same as every other `api/*.js`
  function) — the only thing standing between "just you" and "any signed-in
  user" is the `PLATFORM_ADMIN_EMAIL` check in `api/admin.js`. Treat that
  env var with the same care as `SUPABASE_SERVICE_ROLE_KEY` itself.
- **Login lockout can itself be triggered deliberately by someone who
  knows a target's email** — it locks the account, not the attacker, after
  10 failed attempts in 15 minutes. This is an inherent trade-off of any
  account-level lockout, not a bug; see "How login lockout works" in the
  README for the reasoning and why the threshold is set where it is.
- **Chat has no editing, deleting, read receipts, or search yet** — v1
  covers sending/receiving live messages, unread badges, and @mentions in
  four conversation shapes (General, projects, tasks, DMs), and
  deliberately stops there. See "How team chat works" in the README.
- **Time tracking has no cross-project report, and no admin correction of
  someone else's hours** — the task and project pages both show a running
  total, but there's nothing in Reports yet for "hours this week across
  every project," and a mistaken entry has to be fixed or deleted by the
  person who logged it (an admin can delete it outright, not edit it).
  Also worth knowing: deleting a "Logged time" line item from an invoice
  doesn't automatically release the underlying entries back to unbilled —
  use "Mark unbilled" on the task's own entry list for that. See "How
  time tracking works" in the README.
- **Trashed tasks are never auto-purged.** "Delete" moves a task to Trash
  (`/trash`, in the name dropdown) rather than removing it, and it stays
  there indefinitely until someone restores it or an admin permanently
  deletes it — there's no scheduled cleanup job. A scheduled purge (e.g.
  after 30 days) is a reasonable later addition, not built ahead of need.
  See "How task trash (soft delete) works" in the README.
- **Automatic overdue-invoice reminders send a plain reminder, not the
  invoice itself.** No PDF attachment, and the cadence (once, then every
  7 days) isn't configurable per workspace or per invoice yet — it's one
  fixed schedule for everyone who opts in. See "How client-facing
  overdue-invoice reminders work" in the README, and section 12 here for
  setup.
- **The mention-notification realtime subscription isn't org-scoped at
  the database level** (`chat_message_mentions` has no `org_id` column to
  filter on) — it filters only on `mentioned_user_id`, so someone who
  belongs to more than one organization gets a harmless extra unread-count
  refresh if they're mentioned in a different org than the one currently
  open, rather than that mention being silently missed. Wasteful, not
  incorrect, and irrelevant for a single-org setup.
- **A project/task chat thread's `insert` policy trusts the org_id you
  send it, same as every other multi-tenant table in this app** — it
  doesn't independently verify that the project or task ID you're
  attaching a thread to actually belongs to that org. In practice the
  app's own code always sends the correct pairing, so this would only
  matter if someone crafted a raw API call by hand, and even then it
  can't leak data across orgs (the RLS check still gates on the row's own
  stored `org_id`, not the project's real one) — just a theoretical
  dangling reference, not a data-isolation gap. Flagging it for
  completeness rather than treating it as urgent.
- **I could not visually test on an actual phone/browser in this
  environment** (no display available where this was built) — the layout
  uses responsive Tailwind classes throughout and should hold up, but give
  it a real look on your phone before you rely on it day-to-day, especially
  the task row on narrow screens.
- **Mark-as-paid is manual.** There's no automated bank-reconciliation —
  you check Wise, then flip the invoice's status yourself. See the README
  for why that's the honest scope given how Wise's API actually works.
- **Invoices still aren't emailed automatically** — recurring invoices
  auto-*generate*, but you still print/save and send the PDF yourself. The
  daily digest notifies you that one was generated; it doesn't send the
  invoice itself to the client.
- **You need at least one project or task created before you can create an
  invoice at all**, now that a link is mandatory. If your workspace is
  completely empty, create a project or a standalone task first.
- **Suppressing the browser's print header/footer (date/time, URL, page
  count) via `@page { margin: 0 }` is a strong Chromium convention, not a
  guarantee** — confirm it actually disappears on your own browser/OS
  before handing a printed invoice to a client. If it ever shows up,
  unchecking "Headers and footers" in the print dialog's more settings
  removes it for certain.
- **No editing client name, start date, or due date after a project is
  created** through a dedicated form field yet — these show on the project
  page but aren't independently editable there the way status is. Worth
  adding if you find yourself needing to correct one after the fact.
- **Reports' per-member task filtering is a relevance view, not a security
  boundary.** A non-admin's Report page shows only their own tasks in the
  drill-down, but the underlying task data is still visible to any org
  member who opens the project directly — same org-wide RLS as everywhere
  else in the app. Don't rely on this to keep task details private between
  team members; it isn't designed to.
- **Reports' Timeline tab is a static picture, not a scheduling tool.**
  No drag-to-reschedule, no resize, no dependency arrows between items —
  it's a read-only Gantt-style view built from plain CSS bars, not a
  charting library. Zooming in/out is done via the same date-range preset
  picker the other tabs use, not a dedicated Gantt control. Worth
  revisiting if scheduling (rather than just visualizing) becomes a real
  need.
- **The email digest is still daily, not instant** — if you're not actively
  in the app, a comment posted at 9am still won't reach your inbox until
  that day's digest run. The notification bell (above) closes this gap
  *while you're using the app*, but there's no instant email/push
  equivalent for when you're away from it entirely.
- **The bell only fires for task assignment, ticket comments, and client
  ticket submissions** — not every possible event (invoice status changes,
  project status changes, calendar events, etc.). Extending it to more
  event types reuses the exact same pattern (a trigger + an insert into
  `notifications`), just not built for every table yet.
- **The bell requires the tab to be open to receive live updates** — it's
  not a background/push notification. If the tab is closed, notifications
  still get written to the database (you'll see them next time you open
  the app), but nothing pings you while it's closed. True background push
  would need a service worker wired up for push notifications specifically
  (VAPID keys, a subscription table) — a real addition, not implied by
  having a PWA already.
- **File uploads are capped at 25MB and have no preview.** Clicking one
  opens it in a new tab (image, PDF, whatever the browser knows how to
  show) — there's no thumbnail or inline preview in the attachment list
  itself. For anything bigger than 25MB (video masters especially), keep
  using a link — that cap is enforced on the server too, not just
  suggested client-side.
- **No virus/malware scanning on uploaded files.** Supabase Storage
  doesn't scan file contents, and this app doesn't add a scanning layer on
  top. Fine for a small internal team and known clients; worth knowing if
  this link is ever passed somewhere less trusted.
- **Deleting a file-type attachment is best-effort on the storage side.**
  The database row always gets removed; the underlying file in storage
  gets a delete attempt too, but if that specific call fails (network
  blip, etc.) the row still disappears from the UI while a few KB sit
  unused in storage. Not visible or harmful, just worth knowing it's not
  a guaranteed atomic operation.
- **Client ticket submission has only basic spam protection** — a simple
  cap of 5 submissions per project per 10 minutes, enforced in the
  database. No CAPTCHA, no IP tracking. Fine for normal client use; if a
  share link ever ends up somewhere public and gets hit by a bot, this
  slows it down but doesn't stop it outright — regenerate the link if that
  ever happens.
- **The activity log doesn't log everything about everything.** Deliberate
  scope boundaries, not oversights: ticket comments aren't logged as
  activity (the Discussion thread already is that record), invoice
  line-item edits aren't logged individually (only the invoice's own
  status changes are — logging every quantity/rate tweak would drown out
  what actually matters), and there's no "created project" branch reachable
  through the UI's delete action since projects can't currently be deleted
  from the app at all.
- **The old task-only activity log table (`task_activity_log`) still
  exists in the database** after running `schema_activity_log.sql` — its
  history was copied into the new unified `activity_log` table, not moved,
  so the original rows are still there too. Harmless (nothing reads from
  it anymore), just not cleaned up automatically, since dropping a table
  outright felt riskier than leaving a small amount of now-unused data
  behind.
- **No page lists every task in the workspace.** My Tasks only shows
  what's assigned to *you*; a standalone task assigned to someone else (or
  not assigned to anyone yet) has nowhere that lists it for everyone to
  browse, unlike a project's own task list. Worth building if standalone
  tasks get used a lot.
- **The simple single-assignee dropdown and the task/project page's
  Assigned Members section are two separate things, not kept in sync.**
  Assigning someone via the quick dropdown (in a project's task row, or
  at task/project creation) doesn't automatically fill one of the three
  fixed role slots or add a free-form row, and vice versa. Think of the
  dropdown as "who's the main owner" and Assigned Members as "who's
  actually working on it, in what capacity" — related, but intentionally
  not the same field.
- **Deleting a task also deletes its notes, its multi-assignee list, and
  its links to other related tasks** (all cascade with the task). Any
  invoice linked to that task is *not* deleted — it just becomes unlinked,
  same philosophy as project-linked invoices.
- **Inviting an existing user doesn't check if they're already active
  elsewhere.** If you invite someone who already has a Pipeline account
  (say, from their own separate use of the app), they're added to your
  workspace immediately with no confirmation step on their end — by design,
  matching how being added to a Slack workspace or Google Doc usually works,
  but worth knowing since there's no "accept invite" click required.
- **The digest function is unauthenticated except for the CRON_SECRET
  check.** That's intentional and sufficient for how Vercel Cron calls it,
  but don't expose `CRON_SECRET` anywhere public (client code, a public
  repo's committed `.env`, etc.) — anyone with it could trigger the job
  on demand, though they still couldn't read or change any data through it.
- **Google Calendar sync pulls are not real-time in the Google → Pipeline
  direction.** Pushes (Pipeline → Google) happen immediately. Pulls happen
  when a connected person opens the Calendar page or clicks "Sync now",
  plus a once-a-day cron backstop — Vercel's free tier caps cron jobs at
  once a day, and true real-time would need Google push-notification
  webhooks (a bigger addition than this first version). If nobody with a
  connection opens Pipeline for a day or two, Google-side changes just
  wait until someone does, or until the next cron run.
- **Google Calendar sync syncs against "primary" only** — each person's
  main Google Calendar, not a calendar they pick. No UI for choosing a
  different one yet.
- **Deleting an event in Google Calendar doesn't delete it in Pipeline —
  on purpose.** It only removes that one person's sync link, since the
  calendar is shared across the team and one person tidying their own
  Google Calendar shouldn't be able to silently remove something everyone
  else still needs. Editing an event in Google *does* update the shared
  Pipeline event for everyone, though — only deletion is asymmetric.
  Deleting for real still has to happen in Pipeline, which does push that
  delete out to every connected Google Calendar.
- **Conflicting edits use last-write-wins, no merge.** If the same event
  gets edited in Pipeline and in Google before the next sync catches up,
  whichever write lands last is what sticks — there's no field-level merge
  or conflict warning. Reasonable for how small a team would realistically
  collide on the exact same event at the exact same moment, but worth
  knowing.
- **Google's own sync window covers 6 months back to 12 months forward**
  from whenever the first full sync ran for a given connection — events
  further out than that in either direction won't be pulled in. Fine for
  active project work, not meant for archiving years of calendar history.
- **The OAuth consent screen's Testing status expires everyone's
  connection every 7 days** until you switch Publishing status to
  Production (see setup section 6, step 8) — not a bug, a real Google
  policy for unverified apps. Easy to miss if you only test it once and
  move on.
- **Wise auto-reconciliation only works for accounts based in the US,
  Canada, Australia, New Zealand, Singapore, or Malaysia** — a real
  restriction on Wise's own personal-API-token system, not something
  built around it here. Connecting from anywhere else still saves the
  token and says so honestly, but there's no functional path around it
  short of Wise changing their own policy.
- **Wise reconciliation requires a Business account** — personal Wise
  accounts can't generate an API token at all, so there's nothing to
  connect until that's upgraded (separately from the country
  restriction above, which still applies after upgrading).
- **Untested against a live eligible Wise account.** Built carefully
  against Wise's documented API, but there was no actual qualifying
  account available to connect and verify end-to-end during development
  — unlike Google Calendar sync, which was. Treat the first real
  connection from an eligible account as the actual test; a field name
  or response shape in `api/_wiseAuth.js` may need a small fix.
- **Matching is deliberately conservative, not exhaustive.** Auto-match
  requires the invoice number to appear in the payment's reference text
  AND the amount/currency to match exactly — a payment with a slightly
  different amount (a bank fee taken out, a partial payment) or no
  reference at all won't auto-match, and shows up in the "Unmatched Wise
  transactions" panel on Invoices for a human to confirm instead. This is
  intentional: guessing wrong on financial reconciliation is a real
  mistake, not a cosmetic one.
- **Wise sync only looks at incoming (CREDIT) transactions** — outgoing
  payments, fees, and currency conversions on the connected balance are
  never touched or reconciled against anything.
- **Two-factor authentication gates the app's own login and every
  protected route, not the database directly.** RLS policies don't
  independently re-check assurance level (aal2) — the honest read is
  this protects against someone getting in through Pipeline's login
  screen with just a stolen or guessed password, not against someone who
  already has a valid session token going around the UI entirely.
- **A backup code doesn't "pass" the MFA challenge — it removes the
  authenticator entirely.** Only Supabase's own `auth.mfa.verify()` can
  promote a session to aal2, so a valid backup code instead uses the
  Admin API to delete the lost factor, which makes the account stop
  requiring aal2 at all. Using a code is a full 2FA reset, not a
  one-time bypass — the person logs in with just their password
  afterward and re-enables 2FA (getting a fresh set of codes) from
  Settings if they want it back on, separately.
- **`api/mfa.js`'s recovery logic uses Supabase's Admin API to remove a factor —
  built against their documented conventions but not verified against a
  live call during development**, same caveat as the Wise integration.
  Worth actually testing (see Try It, step 23) rather than assuming it
  works.
- **Admin-assisted 2FA reset (Team page) shares the same untested-live
  caveat as the item above it** — it also goes through `api/mfa.js` and
  Supabase's Admin API to remove a factor, just triggered by an admin
  instead of a backup code. Worth testing the same way (see Try It, step
  31).
- **Vercel's Hobby plan caps a deployment at 12 serverless functions
  total** — a real limit that already caused one failed deploy once
  Google Calendar, Wise reconciliation, and 2FA backup codes were all
  built, each as several small files. Fixed by consolidating each
  integration into one file per group (`api/google-calendar.js`,
  `api/wise-reconcile.js`, `api/mfa.js`), dispatched internally by
  method + an `action` field rather than one file per operation. The
  repo actually ships **9 deployed functions** today (`admin.js`,
  `auth-lockout.js`, `backup-export.js`, `daily-digest.js`,
  `google-calendar.js`, `invite-member.js`, `mfa.js`, `stripe.js`,
  `wise-reconcile.js` — the `_`-prefixed files in `api/` are shared
  helpers, not deployed routes), so headroom under the cap is down to
  3, not the 7 an earlier "5 functions" note implied. Check the real
  count before adding a 10th standalone `api/*.js` file: prefer
  extending one of the existing consolidated files (or a new one with
  the same internal-dispatch pattern) over always reaching for a
  brand-new file per small operation.
- **The three Google Fonts are loaded from Google's CDN, not
  self-hosted** — an OWASP ZAP scan flagged the missing `integrity`
  attribute on that `<link>` tag (Medium). Google's font CSS API
  deliberately varies its response per browser `User-Agent`, which is
  exactly why a fixed SRI hash isn't reliable for it (Google's own
  guidance is not to add one) — the actual fix is self-hosting the font
  files instead, removing the Google Fonts CDN dependency and its two
  CSP exceptions entirely. Not done yet: needs a visual check before
  shipping (font rendering/hinting can differ subtly between Google's
  serve-time-optimized files and a self-hosted static copy) that wasn't
  possible in the environment this fix pass ran in.
- **`legal/PRIVACY_POLICY.md` and `legal/TERMS_OF_SERVICE.md` are
  starting drafts, not live documents.** They accurately describe what
  the app actually does today (real data collected, real third parties,
  real retention periods) rather than generic boilerplate, but neither
  has had a real legal review, neither is linked from the app (no footer
  link, no signup-flow acceptance), and both have `[bracketed]` fields
  still needing real values (your contact info, your Supabase region,
  your jurisdiction). Treat them as a head start for a lawyer, not a
  finished before-licensing item.
- **Stripe and Wise credentials are stored as plain `text` columns**
  (`stripe_connections.secret_key`/`webhook_secret`,
  `wise_reconciliation_connections.api_token`), not encrypted at rest.
  RLS already default-denies both tables to `anon`/`authenticated`, so
  this isn't reachable through the app today — it only matters if a
  service-role key leaks or a future bug reaches these tables directly.
  Tracked as a before-licensing item: Supabase Vault (`pgsodium`) can
  encrypt these columns transparently without changing how the app
  reads them.
- **Password strength** — signup and the invite/reset "set password" form
  both now require at least 10 characters, reject known-common passwords
  and simple repeated/sequential runs, and block using your own name or
  email as the password (`src/lib/passwordStrength.js`). This is
  client-side, which means it's a UX guardrail, not the real security
  boundary — someone could still call Supabase's signup API directly with
  a weak password. **Setup section 1, step 47** closes that gap by setting
  the same minimum length on Supabase's own side, which is enforced
  server-side and can't be bypassed. Do that step before licensing this to
  anyone else. "Leaked password" checking (against HaveIBeenPwned) exists
  on Supabase's side too, but only on the Pro plan — not available on the
  free tier this currently runs on.
- **No "change your password while logged in" flow yet.** Signup sets one,
  and "Forgot password" resets one via email — but there's no Settings
  page field for an already-logged-in person to change their current
  password without going through the email-reset flow. Worth adding if
  that friction becomes annoying.
- **Existing accounts don't get their name backfilled automatically.**
  Anyone who was already a member before this feature existed still shows
  as their raw email until they visit Settings once and fill in their own
  name — nothing retroactively renames people. Worth mentioning to
  existing teammates the first time they log in after this ships.
- **No profile photos/avatars** — text only (name/nickname). A visual
  identifier would be a reasonable follow-up if the roster grows past a
  handful of people and email/initials stop being enough to tell people
  apart at a glance.
- **An admin can't set someone else's name on their behalf.** Each person
  edits their own full name/nickname in their own Settings — there's no
  "edit teammate's display name" control on the Team page, even for
  owners/admins.
- **Theme choice is per-browser, not per-account.** It's stored in
  `localStorage`, not the profile — switching computers or clearing site
  data resets it to "System." This was a deliberate choice, not an
  oversight: it's a display preference, not something that needs to sync
  across devices or be visible to teammates, so it didn't belong in the
  database.

## Where to check for errors after launch

Supabase → your project → **Logs** (covers auth + database). Vercel →
your project → **Logs** tab (covers frontend build/runtime issues). No
dedicated error tracker (e.g. Sentry) wired in yet — worth adding before
this holds real client work day to day.
