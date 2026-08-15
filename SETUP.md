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
24. Go to **Project Settings → API**. Copy:
    - **Project URL** → this is `VITE_SUPABASE_URL`
    - **anon public key** (may be labeled **"Publishable key"** in newer
      Supabase projects, formatted like `sb_publishable_...`) → this is
      `VITE_SUPABASE_ANON_KEY`
    - **service_role key** (may be labeled **"Secret key"** in newer
      projects, formatted like `sb_secret_...`) → this is needed for five
      optional server-side features: the daily digest (section 4),
      inviting teammates (section 5), Google Calendar sync (section 6),
      Wise auto-reconciliation (section 7), and 2FA backup-code recovery.
      Skip all five and you can skip this key entirely. If you use any of
      them, keep it aside for those sections. **Never** put it in
      `.env.example`, never prefix it `VITE_` (that would bundle it into
      client-side JS), never commit it anywhere.
25. (Optional, recommended for real use) Under **Authentication → Providers →
    Email**, you can turn off "Confirm email" while testing, or leave it on
    and confirm via the email Supabase sends.

### Cleaning up existing extra workspaces

Skip this if you haven't invited anyone yet, or if this is a brand-new
project — nothing to clean up. If you *have* already invited people before
running `schema_single_workspace_invites.sql` in step 15, some of them may
have ended up with an extra, unused personal workspace created under the
old behavior (landing on "No projects yet" until they manually switched
workspaces — exactly what happened during this app's own testing).

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
dashboard visit un-pauses it, data isn't deleted. There's no automated
backup on the free tier; export your data periodically (Table Editor → each
table → Export) if this ever holds real client data you can't afford to lose.

## 2. Local development

```bash
cd pipeline-app
npm install
cp .env.example .env
# paste your Supabase URL + anon key into .env
npm run dev
```

Visit the local URL Vite prints (usually `http://localhost:5173`).

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
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 17 above. This key
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
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 17 above.
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

## 8. Try it

1. Visit the deployed URL (or localhost), sign up with an email + password.
2. On signup, a personal workspace ("Your Name's Workspace") is created for
   you automatically — this is the multi-tenant org the schema is built
   around, so future team members or licensed workspaces slot into the same
   structure without a rebuild.
3. Click **+ New project** — this is its own page now (`/projects/new`),
   not a popup. Client name, start date, and due date are required; the
   three role slots (Graphics Designer, Project Manager, Developer) and
   the attachments section are both optional and can also be set later
   from the project's own page. Try adding a link attachment here before
   submitting — notice nothing actually uploads until you hit **Create
   project**, since there's no project id yet to attach it to. Once
   created you land straight on that project. Add a few tasks, click a
   task's status dot to cycle todo → in progress → done, watch the
   Scrubber move.
4. Go to **Settings**, paste in your Wise Business permanent payment link
   (grab it from Wise → Payments → "Your open link"). This is a one-time
   setup — every invoice you create from here on will show it automatically.
5. Go to **Invoices → New invoice** (admin/owner only — a non-admin won't
   see this button, and every invoice is read-only for them, status badge
   included, once you're logged in as one), fill in a client, their email
   (now required), pick whether it's for a project or a specific task
   (also required — you'll need at least one project or task created
   already), and a couple of line items, then save. Open it and hit
   **Print / Save as PDF** to see the client-facing version — a
   placeholder "PMA" brand mark instead of your workspace name, and the
   payment link embedded. If you deployed section 7, that invoice's number
   (e.g. "INV-0004") is exactly what auto-reconciliation looks for in a
   payment's reference text, so a real client payment referencing it
   correctly gets matched automatically.
6. Go to **Calendar** — your project and task due dates already show up
   automatically. Click a day and add a standalone event (a client call,
   a shoot day) to see it merge in alongside them. If you deployed section
   6, connect Google Calendar from Settings first, then create an event
   here and check it lands in your actual Google Calendar within a few
   moments (no page refresh needed) — then create one directly in Google
   Calendar and click **Sync now** back in Pipeline to pull it in.
7. Go to **Tickets → New ticket**, file something with a priority and type,
   then open it and post a comment to see the discussion thread.
8. Go to **Reports** — as an admin/owner you get everything you just
   created rolled up automatically, organized into three tabs (Financial
   summary / Ticket activity / Project rollup) plus a date-range picker
   that scopes the first two. In Project rollup, click **"Show tasks"** on
   a project to see its tasks grouped by status, each with a status badge,
   assignee(s), dates, and a notes count; check the **Standalone tasks**
   section below the project list too. Try **Print / Save as PDF**
   (includes all three tabs regardless of which is open) and **Download
   CSV** on the invoices, project, and task tables. Log in as a non-admin
   team member and check Reports again — they land straight on Project
   rollup scoped to their own tasks, with no tabs, date-range picker, or
   financial/ticket data shown at all.
9. Go to **Invoices → Recurring** (also admin/owner only — a non-admin can
   still see the list of templates, just none of the action buttons), set
   up a template for a retainer client, then hit **Generate now** to see
   it create a real invoice immediately — no need to wait for the digest job.
10. Open any project and hit **Copy share link**, then open that link in a
    private/incognito window to see exactly what a client would see (no
    login). Back in the project, **Regenerate link** to see the old one stop
    working.
11. Open a task, ticket, or project and add a link attachment — paste any
    URL into the input and click the link icon built into it (or press
    enter) — to see it show up as "File 1" in the list.
12. On that same task, ticket, or project, click the upload icon right
    next to the link input and pick a small file (a screenshot or PDF
    works well) — it should appear as "File 2" right below the link, with
    its file size shown. Click it to confirm it opens correctly (this
    generates a fresh signed URL each time, so it should work even a
    while after uploading). Delete "File 1" and confirm the upload
    renumbers down to "File 1" too — the numbering is always just
    position in the list.
13. If you deployed the digest job in section 4, run the `curl` test from
    step 8 there and confirm you get a response back. Same idea for the
    other two cron jobs if you deployed them — both endpoints below
    handle several things internally (see the "Vercel Hobby plan caps..."
    note in Project structure), but a bare `CRON_SECRET` request always
    hits the cron/all-connections path regardless: Google Calendar sync
    (section 6) — `curl -X POST https://your-app.vercel.app/api/google-calendar -H "Authorization: Bearer YOUR_CRON_SECRET"` —
    and Wise reconciliation (section 7) —
    `curl -X POST https://your-app.vercel.app/api/wise-reconcile -H "Authorization: Bearer YOUR_CRON_SECRET"`
    — both should return a JSON summary rather than an error.
14. Go to **Team** — as the workspace's first (and so far only) member,
    you're the Owner, so you'll see the invite form. If you deployed
    section 5, try inviting a second email (even one of your own alt
    addresses) to see the whole flow end to end — once they set a
    password and log in, they should land directly in your workspace, with
    no separate empty one of their own and no workspace switcher cluttering
    the header (it only appears once there's genuinely more than one
    option to choose from).
15. Back on a project, notice the "Add a task" input only appears for
    admins/owners now — everyone else sees a note instead, though they can
    still update status, assignee, and due date on existing tasks. Change a
    task's status or assignee, then scroll to the **Activity** section at
    the bottom of the project page to see it logged automatically.
16. Assign a task to yourself (or have it already assigned from an earlier
    step), then click **My Tasks** in the nav — it should show up there
    too, regardless of which project it's in.
17. Click any task's title anywhere in the app — it now opens its own
    page. Under **Assigned members**, you'll see three fixed rows —
    Graphics Designer, Project Manager, Developer — each with its own
    "choose a member" dropdown; pick someone for one or two of them, post
    a note, and — on a task that has no project — fill in client
    name/website directly on the task. As an admin, try **"+ New task"**
    on My Tasks and leave the project dropdown on "No project
    (standalone)" to see that flow end to end — notice start date is
    already filled in with today, and the same three role slots are right
    there before hitting Create, no follow-up trip to the task's own page
    required. Same three slots show up on a project's own "Add a task"
    row once you start typing a title.
18. Open a project's client share link in a private/incognito window (same
    one from earlier) and scroll to **"Have something to raise?"** — submit
    a test ticket. Back in the main app's **Tickets** page, it should show
    up tagged **Client**, with the submitter's name/email visible on the
    ticket's detail page if they gave one.
19. To see the notification bell live: open the app in two browser windows
    logged in as two different members of the same workspace (or use the
    teammate you invited earlier). In one window, assign a task to the
    other person, or comment on a ticket they're assigned to. Watch the
    bell in their window — it should update within a second or two, no
    refresh needed. Click a notification to jump to what it's about.
20. To see the unified activity log: change an invoice's status (draft →
    sent) or a ticket's priority, then go back to that project's page and
    scroll to **Activity** — you should see the invoice/ticket change
    listed right alongside the task changes from earlier, each tagged with
    what kind of thing it was, all in one combined timeline. Open a ticket
    or invoice directly and its own **Activity** section shows just that
    one thing's history.
21. Go to **Settings** and click **Enable two-factor authentication** —
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
22. On that same challenge screen, click **"Lost your device? Use a
    backup code"** and enter one of the codes you saved. You should land
    back in the app with a notice that 2FA was turned off — check
    Settings to confirm it shows the "Enable two-factor authentication"
    button again rather than "on," meaning the reset actually took (this
    is the one part of this whole setup process built without being able
    to test it against a live call beforehand — genuinely worth
    confirming it works, not just skimming past).

## Known limitations to know about

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
- **The simple single-assignee dropdown and the task page's three fixed
  Assigned Members role slots are two separate things, not kept in
  sync.** Assigning someone via the quick dropdown (in a project's task
  row, or at task creation) doesn't automatically fill one of the three
  role slots, and vice versa. Think of the dropdown as "who's the main
  owner" and the three slots as "who's actually working on it, in what
  capacity" — related, but intentionally not the same field.
- **An assignees row from before the three-role redesign, with a role
  label outside Graphics Designer/Project Manager/Developer (or blank),
  won't show up in Assigned Members anymore.** Applies to both
  `task_assignees` and `project_assignees` — the row itself isn't
  deleted, it's just not one of the three slots the UI displays, so it's
  effectively hidden. Only matters for tasks/projects assigned before
  this change; new assignments always use one of the three.
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
  Worth actually testing (see Try It, step 22) rather than assuming it
  works.
- **Still no "admin resets a teammate's 2FA" button on Team.** Backup
  codes cover the normal "lost my phone" case; if someone loses both
  their authenticator *and* their saved codes, the fix is still the
  workspace owner going into the Supabase dashboard directly
  (Authentication → Users → that person → remove their MFA factor).
- **Vercel's Hobby plan caps a deployment at 12 serverless functions
  total** — a real limit that already caused one failed deploy once
  Google Calendar, Wise reconciliation, and 2FA backup codes were all
  built, each as several small files. Fixed by consolidating each
  integration into one file per group (`api/google-calendar.js`,
  `api/wise-reconcile.js`, `api/mfa.js`), dispatched internally by
  method + an `action` field rather than one file per operation — down
  to 5 functions total, with headroom. Worth keeping in mind for
  whatever gets added next: prefer extending one of the existing
  consolidated files (or a new one with the same internal-dispatch
  pattern) over always reaching for a brand-new `api/*.js` file per
  small operation.

## Where to check for errors after launch

Supabase → your project → **Logs** (covers auth + database). Vercel →
your project → **Logs** tab (covers frontend build/runtime issues). No
dedicated error tracker (e.g. Sentry) wired in yet — worth adding before
this holds real client work day to day.
