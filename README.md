# Pipeline

A full project management workspace: projects, tasks, invoicing (one-off and
recurring), calendar, internal ticketing, reporting, client sharing, file
attachments, email notifications, and team management — all on one
multi-tenant schema.

**This build:** all five original modules, plus five follow-on additions —
recurring invoices, a read-only client portal, link-based attachments, a
daily email digest, and team invites with admin-gated task creation and a
per-task activity log.

## Tech stack

- **Frontend:** React 19 + Vite + Tailwind CSS v4 + React Router
- **Backend:** Supabase (Postgres + Auth + Row Level Security)
- **Hosting:** built for Vercel or Netlify free tier
- **Installable:** PWA (manifest + service worker) — add to home screen on iOS/Android/desktop, no app store needed

## Design

Grounded in the subject: a video editor's own PM tool. Cool light "editing
suite" neutral background, tally-light accent colors (amber = in progress,
red = overdue/blocked, teal = done), Archivo Expanded / IBM Plex Sans / IBM
Plex Mono type. The signature element is the **Scrubber** — a timeline-style
progress bar with tick marks and a playhead, standing in for a plain
percentage bar.

## Local setup

See `SETUP.md`.

## Project structure

```
src/
  components/     Scrubber, TallyDot, PriorityBadge, AppShell,
                  NewProjectDialog, EventDialog, AttachmentsList,
                  TaskAttachmentsDialog
  context/        AuthContext (session, active org, auth actions)
  lib/            Supabase client, currency formatting, calendar helpers,
                  date-range presets, CSV export
  pages/          AuthPage, Dashboard, MyTasks, ProjectDetail,
                  Invoices, InvoiceForm, InvoiceDetail,
                  RecurringInvoices, RecurringInvoiceForm,
                  Settings, Calendar, Tickets, TicketForm, TicketDetail,
                  Reports, Team, ShareView (public, unauthenticated)
api/
  daily-digest.js         Vercel serverless function — Cron-triggered,
                          service-role only, never called from the frontend
  invite-member.js        Vercel serverless function — called from the Team
                          page, verifies the caller's own admin role itself
                          rather than trusting the client
supabase/
  schema.sql                    Multi-tenant core schema + RLS (orgs/projects/tasks)
  schema_invoicing.sql          Invoices, line items, Wise payment link setting
  schema_calendar.sql           Calendar events + RLS
  schema_ticketing.sql          Tickets + comment thread + RLS
  schema_recurring_invoices.sql Recurring templates + generation function
  schema_client_sharing.sql     Public read-only project view via token
  schema_attachments.sql        Link-based attachments on tasks/tickets
  schema_notifications.sql      Per-user digest preferences
  schema_team.sql               Email on profiles, admin-only task creation,
                                 task activity log
  schema_client_tickets.sql     Client-facing ticket submission function
vercel.json
  Cron schedule for the daily digest function
public/
  manifest.json, sw.js, icons/    PWA assets
```

## How reports work

- No new tables — Reports is a read-only lens over projects, tasks,
  invoices, and tickets, scoped to a date range (This month / Last month /
  This quarter / This year / All time / custom).
- **Financial summary** groups invoice totals by currency (never summed
  across currencies, since PHP + USD isn't a real number) — invoiced, paid,
  outstanding, and overdue for the period.
- **Ticket activity** shows filed vs. resolved counts for the period, what's
  still open right now, and average resolution time.
- **Project rollup** shows every active project's current completion
  (Scrubber again) alongside what got invoiced against it in the period —
  a snapshot of health plus period activity in one row.
- **Print / Save as PDF** for a clean handoff document; **Download CSV** on
  the invoices and project tables for spreadsheet work.

## How ticketing works

- **Team-side filing and triage is still internal-only** — the ticket list,
  assignment, comments, and status changes all live behind login, same as
  everything else. What's changed: clients can now *file* a ticket from
  their read-only project link (see "How client sharing works" below) —
  they can't see the ticket list, comment thread, or anyone else's tickets,
  only submit a new one.
- Type (bug/request/question/other) and priority (low/medium/high/urgent)
  are kept separate from status (open/in progress/resolved) — urgency
  doesn't change as a ticket moves through the workflow, so they're shown
  as two distinct visual elements instead of folded into one.
- Each ticket has a lightweight comment thread — anyone can post, but only
  the author can edit or delete their own comment, enforced at the database
  level (not just hidden in the UI).
- Tickets can optionally link to a project, same pattern as invoices and
  calendar events.

## How the calendar works

- **Self-contained, not synced with Google Calendar.** Wiring up real Google
  Calendar sync means an OAuth app registered in Google Cloud Console
  (client ID/secret, consent screen, token refresh handling) — a genuine
  chunk of extra setup that didn't fit this pass. Worth adding later if you
  want events to show up on your phone's native calendar too.
- The month grid merges three sources with nothing duplicated: standalone
  events you create, task due dates, and project due dates — each shown as
  a colored dot (amber = upcoming, red = overdue, teal = done/completed).
- Click any day to see its full agenda below the grid. Clicking a task or
  project item jumps to that project; clicking an event opens it for
  editing.
- Task/project due dates are read-only from the calendar (edit them from
  the project itself) — only standalone events are created/edited here.

## How invoicing works

- Every invoice belongs to your workspace and (optionally) links to a project.
- Line items are entered as description / qty / rate; the total recalculates
  automatically (via a database trigger, so it's always correct even if you
  edit items later).
- Invoice numbers are auto-generated per workspace: `INV-0001`, `INV-0002`,
  etc. (prefix editable in Settings).
- **Wise integration, honestly scoped:** Wise Business's invoicing and
  payment-link features live inside the Wise dashboard itself — there's no
  public API to auto-generate a fresh payment link per invoice on demand.
  The practical version of "generate invoice → send with payment link" that
  works within Wise's actual capabilities: grab your permanent Wise payment
  link once (Wise → Payments → "Your open link", it doesn't expire) and
  paste it into Settings. Every invoice you generate then automatically
  displays that link plus a note asking the client to enter the invoice
  number as their payment reference, so you can match payments manually.
- Status (draft/sent/paid/cancelled) is tracked per invoice; "overdue" is
  computed automatically in the UI when a sent invoice's due date has passed
  — no separate status to remember to set.

## How recurring invoices work

- Built for retainer clients — set up a template once (client, line items,
  cadence) instead of re-entering the same invoice every period.
- **"Generate now"** creates a real invoice + line items from the template
  and advances its next-run date — a normal in-app action, no extra
  infrastructure needed.
- **Full automation is optional**, not required: the same daily digest
  function (below) checks every template's next-run date and auto-generates
  anything due, so once that's deployed you don't have to remember at all.
  Pause a template any time without deleting it.

## How client sharing works

- Every project has a permanent, unguessable share link
  (`/share/<random-token>`) — copy it from the project page and send it to
  a client. No login for them, no account needed.
- The public page is deliberately narrow: project name, status, task
  progress (the Scrubber again), and only invoices that have actually been
  **sent or paid** — never drafts, which might be incomplete or not
  finalized yet.
- This is enforced at the database level, not just hidden in the UI: the
  only thing an anonymous visitor can call is one tightly-scoped function
  that returns exactly those fields. The underlying tables have zero direct
  public access, same RLS as everywhere else in the app.
- If a link ever leaks somewhere you didn't intend, **regenerate it** from
  the project page — the old link stops working immediately.
- **Clients can also file a ticket directly from that same page** — a
  small form (their name/email optional, a type, a short summary, details)
  that creates a real internal ticket, tagged **"Client"** so your team can
  tell it apart from ones filed internally. This uses the identical
  security pattern as the read-only view above: one narrow, tightly-scoped
  function is the *only* thing an anonymous visitor can call — it can
  create exactly one ticket, on the one project the link belongs to,
  always as an open/medium-priority ticket (a client can't set priority or
  assign it to someone; that's still your team's call). It also has a
  basic rate limit (5 submissions per project per 10 minutes) — simple
  spam-blunting, not sophisticated bot/abuse protection, worth knowing if
  this link ever gets shared somewhere more public than intended.

## How attachments work

- Link-based, not file upload — you paste a labeled URL (a Google Drive
  file, a Frame.io review link, wherever the actual media already lives)
  rather than uploading through the app. Matches how you already work, and
  avoids needing separate file storage/quota to manage.
- Available on both tasks and tickets, so a review link can sit right next
  to the work it's about instead of living in a separate message thread.

## How notifications work

- **Nothing is required to get the rest of the app working** — this is the
  one piece that needs actual deployment setup beyond Supabase + Vercel,
  because sending real email needs a real email service. See `SETUP.md`.
- Once deployed, a **daily digest** email goes out to each person who wants
  one, covering only what they've opted into: overdue invoices, tasks due
  today or overdue, an open-ticket count, and which recurring invoices got
  auto-generated that day.
- **Quiet by design** — if there's nothing to report for someone that day,
  they get no email at all. No daily "all clear!" noise.
- Preferences are per-person (Settings → Email notifications), not
  per-workspace — what you opt into doesn't affect what a teammate receives.
- The digest job doubles as the automation for recurring invoices (above):
  one daily run checks due templates and generates them, then emails
  whoever wants to know what happened.

## How My Tasks works

- One page, pulling every task assigned to you specifically, across every
  project in the current workspace — sorted by due date, overdue ones
  flagged the same way they are elsewhere in the app.
- Status can be changed right from this list (tap the dot to cycle
  todo → in progress → done), same as on a project page — no need to open
  the project just to mark something done.
- Each task links back to its project, for when you do want the full
  context.
- This reads the same `tasks` table everyone else's view does — nothing
  duplicated, no separate sync step. Switching workspaces (if you're ever
  in more than one) changes what shows up here too.

## How team management works

- **Inviting someone** (Team page, admin/owner only) tries the simple path
  first: if that email already has a Pipeline account, they're added to
  your workspace immediately, no email needed. Only if the email has no
  account yet does Supabase create one and send an invite email with a
  link to set a password.
- **The permission check happens twice, deliberately.** The UI hides the
  invite form from non-admins, but that's just convenience — the real
  enforcement is in `api/invite-member.js`, which independently verifies
  the caller's own session token and looks up their actual role in that
  workspace before doing anything. A regular member calling the endpoint
  directly (bypassing the UI) would still get rejected, because the check
  doesn't trust anything the client sends about its own permissions.
- **Task creation is now admin/owner-only.** Everything else about
  tasks — marking done, reassigning, changing due dates, deleting — stays
  open to every member. Only adding *new* tasks is gated, and it's enforced
  at the database level (RLS), not just hidden in the UI.
- **Assigning at creation, not just after.** Admins now pick who a task
  goes to right when they add it, instead of adding it unassigned and
  circling back.
- **The activity log is automatic, not something app code has to remember
  to write.** A database trigger on the `tasks` table logs every create,
  status change, reassignment, due-date change, and deletion — so it can't
  be silently skipped by a future code change, and it captures changes no
  matter what path they came through. It shows up at the bottom of each
  project's page, most recent first.
- **You can't accidentally lock yourself out.** The Team page won't let you
  change your own role or remove yourself, and won't let anyone demote or
  remove the last remaining owner of a workspace.

## What's next (optional, not built)

- Auto-reconciliation of Wise payments (would require Wise's real developer API and balance-polling logic — a genuine stretch goal, not a quick add)
- Google Calendar sync (would require OAuth app setup in Google Cloud Console)
- Real-time notifications for specific events (e.g. "a comment was just posted") — the current digest is daily, not instant; true real-time would mean Supabase Database Webhooks firing per event rather than one batched daily job
- File uploads for attachments (current version is link-only, by design — see "How attachments work")
- Extending the activity log beyond tasks to invoices, tickets, and projects (same trigger pattern, just not built yet)
