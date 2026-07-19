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
11. Go to **Project Settings → API**. Copy:
    - **Project URL** → this is `VITE_SUPABASE_URL`
    - **anon public key** (may be labeled **"Publishable key"** in newer
      Supabase projects, formatted like `sb_publishable_...`) → this is
      `VITE_SUPABASE_ANON_KEY`
    - **service_role key** (may be labeled **"Secret key"** in newer
      projects, formatted like `sb_secret_...`) → this is needed for two
      optional server-side features: the daily digest (section 4) and
      inviting teammates (section 5). Skip both and you can skip this key
      entirely. If you use either, keep it aside for those sections.
      **Never** put it in `.env.example`, never prefix it `VITE_` (that
      would bundle it into client-side JS), never commit it anywhere.
12. (Optional, recommended for real use) Under **Authentication → Providers →
    Email**, you can turn off "Confirm email" while testing, or leave it on
    and confirm via the email Supabase sends.

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
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 11 above. This key
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
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 11 above.
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

## 6. Try it

1. Visit the deployed URL (or localhost), sign up with an email + password.
2. On signup, a personal workspace ("Your Name's Workspace") is created for
   you automatically — this is the multi-tenant org the schema is built
   around, so future team members or licensed workspaces slot into the same
   structure without a rebuild.
3. Create a project, add a few tasks, click a task's status dot to cycle
   todo → in progress → done, watch the Scrubber move.
4. Go to **Settings**, paste in your Wise Business permanent payment link
   (grab it from Wise → Payments → "Your open link"). This is a one-time
   setup — every invoice you create from here on will show it automatically.
5. Go to **Invoices → New invoice**, fill in a client and a couple of line
   items, save. Open it and hit **Print / Save as PDF** to see the client-facing
   version with the payment link embedded.
6. Go to **Calendar** — your project and task due dates already show up
   automatically. Click a day and add a standalone event (a client call,
   a shoot day) to see it merge in alongside them.
7. Go to **Tickets → New ticket**, file something with a priority and type,
   then open it and post a comment to see the discussion thread.
8. Go to **Reports** — everything you just created rolls up automatically.
   Switch the date range, then try **Print / Save as PDF** and **Download
   CSV** on the invoices table.
9. Go to **Invoices → Recurring**, set up a template for a retainer client,
   then hit **Generate now** to see it create a real invoice immediately —
   no need to wait for the digest job.
10. Open any project and hit **Copy share link**, then open that link in a
    private/incognito window to see exactly what a client would see (no
    login). Back in the project, **Regenerate link** to see the old one stop
    working.
11. Open a task or ticket and add a link attachment (paste any URL with a
    label) to see it show up inline.
12. If you deployed the digest job in section 4, run the `curl` test from
    step 8 there and confirm you get a response back.
13. Go to **Team** — as the workspace's first (and so far only) member,
    you're the owner, so you'll see the invite form. If you deployed
    section 5, try inviting a second email (even one of your own alt
    addresses) to see the whole flow end to end.
14. Back on a project, notice the "Add a task" input only appears for
    admins/owners now — everyone else sees a note instead, though they can
    still update status, assignee, and due date on existing tasks. Change a
    task's status or assignee, then scroll to the **Activity** section at
    the bottom of the project page to see it logged automatically.
15. Assign a task to yourself (or have it already assigned from an earlier
    step), then click **My Tasks** in the nav — it should show up there
    too, regardless of which project it's in.

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
- **The digest is daily, not real-time.** A comment posted on a ticket at
  9am won't reach anyone until that day's digest run. True real-time would
  mean Supabase Database Webhooks firing per event — a bigger addition than
  fit this pass.
- **Attachments are links, not uploads.** By design (see README) — if you
  ever want real file upload, that's a Supabase Storage bucket + RLS
  policies away, not a rebuild.
- **The activity log covers tasks only** — not invoices, tickets, or
  projects. Extending the same trigger pattern to those is straightforward
  if you want it later, just not built in this pass since it wasn't asked
  for yet.
- **No "assigned to me" view.** Assigning a task still only surfaces it
  within that one project's page — there's no dashboard or digest section
  yet that shows everything assigned to a specific person across all
  projects. Worth building if the team grows past a couple of people.
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

## Where to check for errors after launch

Supabase → your project → **Logs** (covers auth + database). Vercel →
your project → **Logs** tab (covers frontend build/runtime issues). No
dedicated error tracker (e.g. Sentry) wired in yet — worth adding before
this holds real client work day to day.
