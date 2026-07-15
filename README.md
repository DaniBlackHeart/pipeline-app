# Pipeline

A full project management workspace: projects, tasks, invoicing, calendar,
internal ticketing, and reporting, all on one multi-tenant schema.

**This build:** all five modules — projects/tasks, invoicing, calendar, ticketing, and reports.

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
                  NewProjectDialog, EventDialog
  context/        AuthContext (session, active org, auth actions)
  lib/            Supabase client, currency formatting, calendar helpers,
                  date-range presets, CSV export
  pages/          AuthPage, Dashboard, ProjectDetail,
                  Invoices, InvoiceForm, InvoiceDetail, Settings,
                  Calendar, Tickets, TicketForm, TicketDetail, Reports
supabase/
  schema.sql              Multi-tenant core schema + RLS (orgs/projects/tasks)
  schema_invoicing.sql    Invoices, line items, Wise payment link setting
  schema_calendar.sql     Calendar events + RLS
  schema_ticketing.sql    Tickets + comment thread + RLS
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

- **Internal only** — no client-facing submission portal, per what we
  scoped at the start. Anyone on the team can file, triage, and comment.
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

## What's next (optional, not built)

- Org invite flow (schema already supports multiple members per org — no invite UI yet, since v1 auto-creates one workspace per signup)
- Auto-reconciliation of Wise payments (would require Wise's real developer API and balance-polling logic — a genuine stretch goal, not a quick add)
- Google Calendar sync (would require OAuth app setup in Google Cloud Console)
- Client-facing ticket submission (current scope is internal-team-only, by design)
- Scheduled/emailed reports (current version is generated on demand in the browser)
