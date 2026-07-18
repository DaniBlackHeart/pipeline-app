# Setup

## 1. Supabase (backend)

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
10. Go to **Project Settings → API**. Copy:
    - **Project URL** → this is `VITE_SUPABASE_URL`
    - **anon public key** → this is `VITE_SUPABASE_ANON_KEY`
    - **service_role key** → keep this one aside for the optional digest
      setup in section 4 below. **Never** put it in `.env.example`, never
      prefix it `VITE_` (that would bundle it into client-side JS), never
      commit it anywhere.
11. (Optional, recommended for real use) Under **Authentication → Providers →
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
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase step 10 above. This key
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

## 5. Try it

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

## Known limitations to know about

- **No org invite UI yet.** The schema fully supports multiple members per
  workspace (`org_members` table, roles), but there's no "invite a teammate"
  screen yet — that's a small addition when you're ready for it, not a
  redesign.
- **No password reset flow wired into the UI.** Supabase Auth supports it
  (`resetPasswordForEmail`), it's just not built into this screen yet.
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
