# Pipeline

A project management workspace — the foundation of a bigger tool that will
eventually cover invoicing, calendar, ticketing, and reports on top of the
same schema and auth.

**This build:** multi-tenant auth + projects + tasks + invoicing.

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
  components/     Scrubber, TallyDot, AppShell, NewProjectDialog
  context/        AuthContext (session, active org, auth actions)
  lib/            Supabase client, currency formatting
  pages/          AuthPage, Dashboard, ProjectDetail,
                  Invoices, InvoiceForm, InvoiceDetail, Settings
supabase/
  schema.sql              Multi-tenant core schema + RLS (orgs/projects/tasks)
  schema_invoicing.sql    Invoices, line items, Wise payment link setting
public/
  manifest.json, sw.js, icons/    PWA assets
```

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

## What's next (not in this build)

- Calendar
- Internal ticketing
- Report generator
- Org invite flow (schema already supports multiple members per org — no invite UI yet, since v1 auto-creates one workspace per signup)
- Auto-reconciliation of Wise payments (would require Wise's real developer API and balance-polling logic — a genuine stretch goal, not a quick add)
