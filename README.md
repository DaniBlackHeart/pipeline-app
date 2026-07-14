# Pipeline

A project management workspace — the foundation of a bigger tool that will
eventually cover invoicing, calendar, ticketing, and reports on top of the
same schema and auth.

**This build (v1):** multi-tenant auth + projects + tasks.

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
  lib/            Supabase client
  pages/          AuthPage, Dashboard, ProjectDetail
supabase/
  schema.sql      Full multi-tenant schema + RLS policies
public/
  manifest.json, sw.js, icons/    PWA assets
```

## What's next (not in this build)

- Invoicing (draft/sent/paid tracking + Wise payment link embed)
- Calendar
- Internal ticketing
- Report generator
- Org invite flow (schema already supports multiple members per org — no invite UI yet, since v1 auto-creates one workspace per signup)
