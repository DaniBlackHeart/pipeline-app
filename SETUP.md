# Setup

## 1. Supabase (backend)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, go to **SQL Editor** → paste the full contents
   of `supabase/schema.sql` → Run. This creates all tables, RLS policies,
   and the triggers that auto-create a profile + personal workspace for
   every new signup.
3. Go to **Project Settings → API**. Copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon public key** → this is `VITE_SUPABASE_ANON_KEY`
4. (Optional, recommended for real use) Under **Authentication → Providers →
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
same two env vars, build command `npm run build`, publish directory `dist`.)

## 4. Try it

1. Visit the deployed URL (or localhost), sign up with an email + password.
2. On signup, a personal workspace ("Your Name's Workspace") is created for
   you automatically — this is the multi-tenant org the schema is built
   around, so future team members or licensed workspaces slot into the same
   structure without a rebuild.
3. Create a project, add a few tasks, click a task's status dot to cycle
   todo → in progress → done, watch the Scrubber move.

## Known limitations to know about (v1)

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
- **Mark-as-paid-style features aren't here yet** — this build stops at
  projects/tasks, per what we scoped for this pass.

## Where to check for errors after launch

Supabase → your project → **Logs** (covers auth + database). Vercel →
your project → **Logs** tab (covers frontend build/runtime issues). No
dedicated error tracker (e.g. Sentry) wired in yet — worth adding before
this holds real client work day to day.
