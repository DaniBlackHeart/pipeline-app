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
  components/     Scrubber, TallyDot, PriorityBadge, AppShell, icons,
                  EventDialog, AttachmentsList,
                  TaskAttachmentsDialog, NotificationBell, ActivityLog
  context/        AuthContext (session, active org, auth actions)
  lib/            Supabase client, currency formatting, calendar helpers,
                  date-range presets, CSV export, role suggestions,
                  file/attachment helpers, Google Calendar client helpers,
                  Wise reconciliation client helpers
  pages/          AuthPage, Dashboard, NewProject, MyTasks, ProjectDetail,
                  TaskDetail, Invoices, InvoiceForm, InvoiceDetail,
                  RecurringInvoices, RecurringInvoiceForm,
                  Settings, Calendar, Tickets, TicketForm, TicketDetail,
                  Reports, Team, ShareView (public, unauthenticated)
api/
  Vercel Hobby plan caps a deployment at 12 serverless functions total —
  each endpoint below that handles more than one operation is
  consolidated into one file on purpose, dispatched internally by HTTP
  method + an `action` field in the request body, specifically to leave
  headroom under that cap rather than one file per operation.
  daily-digest.js         Cron-triggered, service-role only, never called
                          from the frontend
  invite-member.js        Called from the Team page, verifies the
                          caller's own admin role itself rather than
                          trusting the client
  google-calendar.js      Google Calendar two-way sync (status/exchange/
                          disconnect/push/sync all in one file) — see
                          "How the calendar works" below
  wise-reconcile.js       Wise auto-reconciliation (status/connect/
                          disconnect/sync all in one file) — see "How
                          invoicing works" below
  mfa.js                  2FA backup-code recovery (status/generate/
                          recover all in one file) — see "How two-factor
                          authentication works" below
  _authHelpers.js, _googleAuth.js, _wiseAuth.js, _mfaBackupCodes.js
                          Shared helpers, not routes themselves (leading
                          underscore excludes them from Vercel's route
                          discovery)
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
  schema_realtime_notifications.sql  Notification bell: table, triggers, realtime publication
  schema_file_uploads.sql       Storage bucket + RLS, file-kind attachments
  schema_activity_log.sql       Unified activity log (tasks, tickets, invoices,
                                 projects), migrates existing task history
  schema_single_workspace_invites.sql  Invited users never get their own
                                        extra workspace
  schema_invoice_requirements.sql      Mandatory client email + mandatory
                                        project-or-task link on invoices
                                        and recurring templates
  schema_project_requirements.sql      Mandatory client/due/start date,
                                        multi-assignee support on projects
  schema_task_detail.sql        Standalone tasks, multi-assignee, task
                                 notes, task-to-task links, task-linked invoices
  schema_invoice_admin_gate.sql Invoices/recurring templates read-only for
                                 members, full access for admins/owners
  schema_project_attachments.sql  Extends attachments to work on projects
  schema_google_calendar_sync.sql  Google Calendar connections + per-person
                                    event id mappings (service-role only)
  schema_wise_reconciliation.sql  Wise API connections (service-role only)
                                   + pulled transactions with invoice matching
  schema_mfa_backup_codes.sql   2FA backup/recovery codes, salted and hashed
                                 (service-role only)
cleanup_redundant_workspaces.sql
  ONE-TIME, manually-reviewed cleanup — not part of the standard schema-file
  sequence. See its own header before running.
vercel.json
  Cron schedule for the daily digest, Google Calendar sync, and Wise
  reconciliation functions
public/
  manifest.json, sw.js, icons/    PWA assets
```

## How projects work

- **Created on its own page** (`/projects/new`), not a modal — same pattern
  as invoices and tickets. Landing on the new project's own page afterward,
  not back on the project list.
- **Client name, start date, and due date are all mandatory** — a project
  can't be created without them. Enforced at the database level, not just
  the form, same as the invoice requirements below.
- **Assigned members is the same three fixed role slots used on tasks** —
  Graphics Designer, Project Manager, Developer, each with its own "choose
  a member" dropdown, no free-text role field. Identical on the creation
  page and on a project's own page afterward; picking a new person for a
  role replaces whoever was there, same behavior as the task version.
  Adding someone notifies them, same as everywhere else people get added
  to something in this app.
- **Attachments too, on both the creation page and afterward** — links or
  file uploads, same as tasks and tickets already had. See "How
  attachments work" below for how the creation-page version handles not
  having a project id yet.
- These rules only apply to *new* projects and only going forward — see
  `schema_project_requirements.sql`'s own header for how existing projects
  (which may predate mandatory client/due dates) are handled without
  breaking anything already in your database.

## How reports work

- No new tables — Reports is a read-only lens over projects, tasks,
  invoices, and tickets.
- **Admins/owners get three tabs** — Financial summary, Ticket activity,
  Project rollup — shown one at a time on screen, plus a date-range picker
  (This month / Last month / This quarter / This year / All time / custom)
  that scopes the Financial summary and Ticket activity numbers. **Print /
  Save as PDF** always includes all three tabs regardless of which one is
  open; the tabs are just a browsing convenience, not a way to leave
  something out of the PDF.
- **Team members (non-admins) only ever see the Project rollup** — no
  Financial summary tab, no Ticket activity tab, and no date-range picker
  (the picker only ever affected those other two, so showing it would just
  be a control that does nothing for a member view). The page header reads
  "Tasks assigned to you" instead of a date range.
- **Financial summary** groups invoice totals by currency (never summed
  across currencies, since PHP + USD isn't a real number) — invoiced, paid,
  outstanding, and overdue for the period.
- **Ticket activity** shows filed vs. resolved counts for the period, what's
  still open right now, and average resolution time.
- **Project rollup** shows every active project's current completion
  (Scrubber again) alongside what got invoiced against it in the period,
  **plus a "Show tasks" drill-down** revealing that project's tasks
  grouped into To do / In progress / Completed. Each task row shows an
  explicit status badge, its assignee(s), start/due dates, and a notes
  count — the task title links straight to its own page for the full
  notes thread and everything else. **Standalone tasks** (not tied to any
  project) get their own section with the same treatment.
- **Team members only see their own tasks in the drill-down** — the
  project's overall progress bar still reflects everyone's work (so it
  doesn't look wrong), but the task list underneath is filtered to tasks
  assigned to that person, either as the primary assignee or via the
  richer multi-assignee list. Admins/owners see everyone's tasks.
  **Worth being precise about what this is and isn't:** this is a
  relevance filter for the report view, not a data-privacy boundary — the
  underlying task data is already visible to any org member who opens the
  project directly (same as everywhere else in the app; RLS here is
  org-wide, not per-assignee, and the Financial summary/Ticket activity
  data is still fetched behind the scenes for a non-admin, just not
  rendered). It just keeps the report focused on what's relevant to
  whoever's looking at it.
- **Print / Save as PDF** for a clean handoff document; **Download CSV** on
  the invoices, project, and task tables for spreadsheet work (visible to
  whichever tabs/sections that role can see).

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

- The month grid merges three sources with nothing duplicated: standalone
  events you create, task due dates, and project due dates — each shown as
  a colored dot (amber = upcoming, red = overdue, teal = done/completed).
- Click any day to see its full agenda below the grid. Clicking a task or
  project item jumps to that project; clicking an event opens it for
  editing.
- Task/project due dates are read-only from the calendar (edit them from
  the project itself) — only standalone events are created/edited here,
  and only standalone events sync with Google (below) — due dates stay a
  Pipeline-only concept.
- **Two-way Google Calendar sync, honestly scoped.** Each person connects
  their *own* Google account from Settings — this isn't an org-wide
  connection, so a workspace with three people could have zero, one, two,
  or three of them actually synced at any given time. Full setup
  (registering an OAuth app in Google Cloud Console) is in `SETUP.md`
  section 6, since it needs real steps on Google's side, not just an env
  var.
  - **Pipeline → Google is immediate.** Create, edit, or delete a
    standalone event, and it pushes out to *every* connected person's
    Google Calendar within moments — not just the acting person's; a
    shared team calendar should look the same everywhere. Whoever made
    the change doesn't need to be connected themselves for this to work.
  - **Google → Pipeline is not instant**, deliberately — it happens when
    a connected person opens the Calendar page (a pull once per visit) or
    hits **Sync now**, plus a once-a-day cron job as a backstop. Real
    real-time would need Google's push-notification webhooks, which is a
    meaningfully bigger addition than this first version; polling more
    than once a day isn't even possible on Vercel's free tier (cron jobs
    are capped at once daily there). New events created directly in
    Google Calendar do get pulled in as real Pipeline events, same as
    anything else.
  - **Deletion is asymmetric, on purpose.** Deleting an event in Pipeline
    pushes a real delete to every connected Google Calendar. Deleting it
    directly in *Google* Calendar only removes that one person's sync
    link — the shared Pipeline event stays. Editing in Google *does*
    still update the shared Pipeline event for everyone; only deletion
    works this way, specifically so one person cleaning up their own
    Google Calendar can't silently remove something the rest of the team
    still needs.
  - **Conflicts are last-write-wins**, no field-level merge — reasonable
    for how rarely a small team would edit the exact same event on both
    sides at once, but worth knowing.
  - Syncs against each person's **primary** Google Calendar only (no
    picker for a different one), covering roughly 6 months back to 12
    months forward from whichever moment their first sync ran.
  - **The Google side needs its OAuth consent screen moved to Production
    status** to avoid a real Google policy: apps left in Testing status
    have every connected account's access silently expire every 7 days.
    Moving to Production doesn't require Google's full verification
    process for an app this size — see `SETUP.md` for the exact steps.

## How invoicing works

- **Invoices are read-only for regular members; admins/owners have full
  control** — every member can see the list, open any invoice, and print
  it, but creating a new one, editing an existing one (status, line
  items), and deleting are all admin/owner only. Enforced via RLS on
  `invoices` and `invoice_items`, not just hidden buttons, so it holds for
  API access too. A non-admin viewing an invoice sees its status as a
  plain badge instead of the editable dropdown.
- **Every invoice must link to exactly one of a project or a task** — never
  both, never neither. A project-wide invoice covers everything under that
  project; a task-linked invoice is for one specific piece of work,
  including a standalone task that isn't part of any project at all.
  Client email is required too, the same way client name always was —
  every invoice needs someone to actually reach at the other end.
  Enforced at the database level, not just the form, so this holds even
  for API access or a future integration, not only what the UI allows.
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
  number as their payment reference, so you can match payments manually —
  or automatically, if the account qualifies, see below.
- **Wise auto-reconciliation — real, but genuinely restricted to accounts
  in certain countries.** Settings has a separate, admin-only, workspace-
  wide card for this (org-scoped, unlike Google Calendar's personal
  connection — a Wise Business account belongs to the company, not one
  person). Paste a Wise personal API token there and, for eligible
  accounts, a daily background sync (plus an on-demand "Reconcile now")
  reads incoming transactions and auto-marks an invoice paid when a
  payment's reference contains that invoice's number and the amount
  matches exactly. Anything less certain — ambiguous reference, amount
  mismatch, no reference at all — lands in an "Unmatched Wise
  transactions" panel on the Invoices page for a human to confirm or
  dismiss by hand, rather than being guessed at.
  - **The restriction, plainly:** Wise's own personal-API-token system
    only allows reading balance statements (the thing this needs) for
    accounts based in the **US, Canada, Australia, New Zealand,
    Singapore, or Malaysia** — a limit on Wise's side, not something this
    feature can work around. Connecting an account outside that list
    still saves the token, but the connect step probes the API right
    away and shows an honest message if the account isn't eligible,
    rather than silently connecting and never finding anything.
  - **Built generically per-org on purpose**, even though it won't do
    anything for every workspace — Pipeline is multi-tenant, and whether
    this works depends entirely on which country a given org's own Wise
    account is registered in, nothing to do with the app itself.
  - **Untested against a live eligible account**, worth being upfront
    about — built carefully against Wise's documented API behavior, but
    without an actual eligible Wise Business account to connect during
    development, there's a real chance a field name or response shape in
    `api/_wiseAuth.js` needs a small adjustment the first time someone
    with a qualifying account actually tries it. Treat this as "ready to
    try, not yet proven," not "definitely works."
- Status (draft/sent/paid/cancelled) is tracked per invoice; "overdue" is
  computed automatically in the UI when a sent invoice's due date has passed
  — no separate status to remember to set.
- **Printed/PDF invoices show a placeholder brand mark ("PMA"), not the
  workspace name** — a stand-in until a real logo exists; swap the JSX in
  `InvoiceDetail.jsx` (or wire up an uploaded logo) whenever that's ready.
  Printing also now suppresses the browser's own header/footer (today's
  date/time, the page URL, page count) via `@page { margin: 0 }` — this is
  a strong convention in Chromium browsers, not a hard guarantee, so it's
  worth confirming on your own setup before relying on it for anything
  client-facing. If it ever does show up, unchecking "Headers and footers"
  in the print dialog's more settings removes it for certain.

## How recurring invoices work

- Built for retainer clients — set up a template once (client, line items,
  cadence) instead of re-entering the same invoice every period.
- **Same read-only rule as regular invoices:** any member can view every
  template, but creating a new one, editing an existing one (line items,
  pause/resume), and running "Generate now" are all admin/owner only —
  Generate now included, since it ultimately creates a real invoice row.
  Enforced at the RLS/RPC level, same as invoices.
- **Same requirements as a regular invoice:** a template needs a client
  email and a link to exactly one of a project or a task, same as above —
  otherwise a generated invoice would violate those rules the moment it's
  created, silently breaking that template's auto-generation.
- **"Generate now"** creates a real invoice + line items from the template
  and advances its next-run date — a normal in-app action, no extra
  infrastructure needed.
- **Duplicate-generation guard:** the database locks the template row
  during generation and rejects a second call for the same template
  within 5 minutes of the last one. This covers the daily cron and a
  manual "Generate now" click landing close together, or two admins
  triggering it at nearly the same time — either way, the second call
  gets a clear error instead of silently creating a duplicate invoice.
  The button itself is also disabled while a request is in flight, so a
  same-tab double-click was never possible to begin with.
- **Full automation is optional**, not required: the same daily digest
  function (below) checks every template's next-run date and auto-generates
  anything due, so once that's deployed you don't have to remember at all.
  This path runs with the Supabase service role and is unaffected by the
  admin-only rule above (a background job has no "current user" to check
  against). Pause a template any time without deleting it.

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

Two ways to attach something, for two different situations:

- **Links** — paste a URL (Google Drive, Frame.io, wherever the real file
  already lives). Best for anything already living elsewhere, and
  essential for large files — see the size limit below.
- **File uploads** — actual files stored inside the app, via Supabase
  Storage. Best for smaller reference material you want to just live here:
  screenshots, PDFs, short documents, contracts.
- **No custom label field.** Each attachment just displays as "File N"
  (its position in the list — deleting one renumbers the rest so there's
  never a gap) followed by the link itself or the uploaded filename. The
  add row is a single line: paste a link and hit the link icon built into
  the input (or press enter), or click the upload icon right next to it
  to pick a file — no separate "Add link" button, no upload row below.
- **25 MB per file, enforced twice** — checked client-side before the
  upload even starts, and enforced again at the storage bucket level
  server-side, so the limit holds even if someone bypasses the app's own
  UI. This is deliberately not a video-hosting limit; keep using links for
  video masters and anything large. Supabase's free tier includes a
  limited total storage quota shared across the whole project — worth
  checking your current plan's number before uploading a lot of files.
- **Private, not public.** The storage bucket itself has no public URLs —
  every file view/download goes through a short-lived signed link
  generated on the spot (good for about a minute), and storage access is
  governed by the same org-membership check used everywhere else in the
  app, just applied to file paths instead of table rows. A file uploaded
  under one workspace is invisible to every other workspace, same
  guarantee as everything else here.
- Available on tasks, tickets, and projects — a reference file or review
  link can sit right next to the work it's about instead of living in a
  separate message thread.
- **The New Project page has its own attachments section too**, but
  necessarily works a little differently since there's no project id to
  attach anything to until the project actually exists: links just sit in
  the form's local state, and picked files aren't uploaded yet at all
  (held as-is in memory) — everything actually hits Storage and gets its
  real attachments row only once "Create project" succeeds. Same visual
  design either way (File 1/File 2 numbering, the same icons), and if a
  file upload happens to fail at that point, the project itself is still
  created fine — just re-add that one from the project's own page after.

## How notifications work

Two separate systems, covering two separate situations: the **bell** for
when you're actively using the app, the **daily digest** for when you're
not.

### The notification bell (real-time)

- Appears in the header the moment there's something relevant: someone
  assigns you a task, comments on a ticket you're assigned to or filed, or
  a client submits a new ticket (admins/owners only, for that last one).
- **Genuinely live** — built on Supabase Realtime, not polling. A comment
  posted while you're looking at the app shows up in the bell within a
  second or two, no refresh needed.
- Click a notification to jump straight to what it's about (the project a
  task lives in, or the ticket itself) and mark it read in the same click;
  "Mark all read" clears the rest.
- Written entirely by database triggers, same pattern as the task activity
  log — nothing in the app's own code decides when to notify someone, so
  it can't be silently skipped by a future change to how tasks or comments
  get created.
- Scoped to whichever workspace is currently active, same as everything
  else in the app — switching workspaces changes what the bell shows too.

### The daily digest (email)

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
- **"Assigned to you" means either way a task can be assigned** — the
  simple primary assignee, or being added to the richer multi-assignee
  list (with a role label) on the task's own page. The two are tracked
  independently; this page checks both, so a task you're only in via the
  richer list still shows up here.
- Status can be changed right from this list (tap the dot to cycle
  todo → in progress → done), same as on a project page — no need to open
  the project just to mark something done.
- Each task links back to its own detail page (see below), and shows which
  project it belongs to, or "Standalone" if it doesn't belong to one.
- This reads the same `tasks` table everyone else's view does — nothing
  duplicated, no separate sync step. Switching workspaces (if you're ever
  in more than one) changes what shows up here too.
- Admins/owners see a **"+ New task"** button here — this is where a
  standalone task (not tied to any project) gets created; project-linked
  tasks are still created from that project's own page as before. The
  form sets **start date to today by default** (editable, in case you're
  logging something that actually started earlier) and includes the same
  three fixed **Assigned Members** role slots described below — so a task
  can go out fully staffed without a follow-up trip to its own page.

## How the task detail page works

Every task is now its own page (click any task title anywhere in the app),
not just an editable row. What's there:

- **Project & client info.** If the task belongs to a project, this shows
  the project's own client name, client website, and description,
  inherited automatically. If it's standalone, these become editable
  fields directly on the task — a genuinely separate task with its own
  client info, for work that isn't tied to any specific client project.
- **Start date, alongside the existing due date.** Both project-linked and
  standalone tasks get a start date the moment they're created (defaults
  to that day, editable) — see "How My Tasks works" above.
- **Assigned members — three fixed role slots (Graphics Designer, Project
  Manager, Developer), one "choose a member" dropdown each.** This is
  separate from the simple single-assignee dropdown used in project task
  rows and My Tasks (that stays the quick way to set *one* primary
  person) — think of that dropdown as "who's the main owner" and this
  section as "who's actually working on it, in what capacity." The role
  names themselves aren't editable here; only who fills each one is. Both
  task-creation forms have the identical three slots built in, so a task
  can go out fully staffed without a follow-up trip to its own page.
- **Attachments** — the same link/file-upload system already used
  elsewhere, just shown inline on the page instead of behind a dialog.
- **Invoices** — shows any invoice tied specifically to this task, plus
  any invoice tied to the whole project it belongs to (each labeled which
  is which), with status (draft/sent/paid/cancelled, overdue computed the
  same way as everywhere else) and amount. An invoice can now be linked to
  one specific task instead of only ever the whole project — useful for
  billing a single deliverable separately from the rest of the project.
- **Related tasks** — manually linked, and deliberately not limited to
  the same project; you can connect a task to another one anywhere in the
  workspace. Linking is symmetric (link A to B and B shows the connection
  back to A automatically) and search-based — type part of a title to
  find and link it.
- **Notes** — a forum-style thread (each note shows who wrote it and
  when, oldest first), separate from the task activity log below. Only
  the author can edit or delete their own note, enforced at the database
  level, same pattern as ticket comments.
- **Activity log** — the same unified log used everywhere else in the
  app, filtered to just this task's own history (status changes, due/start
  date changes, and the assigned-members list changing).
- **Notifications piggyback on the existing system** — adding someone to
  a task's assigned-members list, or posting a note, notifies them the
  same way task assignment and ticket comments already do (bell +
  optional daily digest).

## How profiles (names + nicknames) work

- **Every profile has a `full_name` and an optional `nickname`.**
  `full_name` defaults to the person's email at signup (see
  `handle_new_user()` in schema.sql) until they set a real one — which is
  exactly why freshly invited teammates showed up as their raw email
  address everywhere until this was built.
- **One shared resolution rule, used everywhere a name is displayed:**
  `getDisplayName()` in `src/lib/displayName.js` returns nickname if set,
  else full name, else email. Every place in the app that shows a
  person's name — the header menu, Team roster, assignee dropdowns, task/
  ticket comments, the activity log — calls this same function. There's
  no separate "casual name" vs. "formal name" convention; it's the same
  resolved name everywhere, deliberately, to keep it simple.
- **Editing your own name/nickname lives in Settings, at the top, above
  the admin-gated cards.** It's personal, not a workspace setting — every
  member can edit their own regardless of role — same pattern as the
  email notification preferences already there. Saving calls
  `refreshProfile()` on `AuthContext`, so the header updates immediately
  without a page reload.
- **The Team roster shows full name as a secondary line under the
  resolved display name, but only when a nickname is actually set and
  differs from it** — otherwise there'd be nothing to gain by repeating
  the same string twice.
- **The top-right header is now a dropdown, not a bare Log out button.**
  Click your name → Team, Settings, Log out, plus a small "signed in as
  {email}" line at the top for reference (since the raw email no longer
  sits in the header bar on its own). No external dependency — it's a
  small self-contained menu with outside-click and Escape-to-close
  handled directly.

## How theming (light/dark/system) works

- **Three explicit choices, not just a media query.** "System" follows the
  OS, but "Light" and "Dark" are real overrides in either direction — so
  someone on a dark-OS can still pick light for this app specifically, and
  vice versa. That's why this isn't just a `prefers-color-scheme` CSS
  media query on its own; `ThemeContext` (`src/context/ThemeContext.jsx`)
  tracks the explicit choice plus live OS state separately, and resolves
  the two into what's actually applied.
- **Applied via a `data-theme="dark"` attribute on `<html>`**, not a CSS
  class, checked by every dark override in `index.css`. No dark
  overrides needed in individual components — the whole app already read
  its colors from CSS custom properties (`--bg`, `--panel`, `--ink`, the
  `--tally-*` accents) rather than hardcoded values, so redefining those
  variables under `[data-theme="dark"]` was enough to theme everything at
  once.
- **Stored in `localStorage` (`pipeline-theme`), not the profile.** This
  is a per-browser display preference, not data that needs to sync across
  devices or be visible to teammates — doesn't belong in the database. A
  synchronous script in `index.html`'s `<head>` reads it and sets the
  attribute before React even loads, so there's no flash of the wrong
  theme on page load. If someone's in a private-browsing mode where
  `localStorage` throws, this fails quietly to "system" rather than
  breaking the page.
- **The picker lives in the name dropdown (top-right corner), not
  Settings** — deliberately, alongside Team/Settings/Log out, so it's one
  click from anywhere rather than a trip to a settings page for something
  people tend to toggle on a whim. Same reasoning as Google Calendar's
  personal connect button living in the header's reach, not buried.
- **Printing always forces light**, regardless of which theme is active
  on screen — every theme variable gets reset to its light value inside
  `@media print`. Necessary, not optional: without it, printing while
  dark mode is active would force the page background to white (the
  existing print fix from early in this project) while leaving text at
  its dark-mode near-white color — invisible on the printed page. Caught
  this while building the feature, not after.
- **Colors were contrast-checked against WCAG AA for actual text pairs**
  (ink/ink-muted against bg/panel, each tally accent against its own
  -soft variant) — all comfortably pass. Loosely calibrated the
  panel/border elevation differences against GitHub's own dark theme
  rather than chasing a literal 3:1 there, since strict non-text contrast
  on adjacent near-black surfaces produces a washed-out result that isn't
  actually how any real dark UI looks (GitHub's own border-vs-canvas is
  roughly 1.5:1, not 3:1).
- **Native `<select>` dropdowns needed an explicit fix, separate from
  everything else.** `color-scheme: dark` alone wasn't enough to theme
  the opened options popup (a known cross-browser quirk, not specific to
  this app) — it fell back to a plain white popup with washed-out text.
  `select, option { background-color: var(--panel); color: var(--ink); }`
  in index.css fixes it directly, since Chrome and Firefox both respect
  explicit background/color on `<option>` even when `color-scheme` alone
  doesn't fully theme the native popup.

## How team management works

- **The model this supports: one client, one workspace, one admin.** If
  you ever license or sell this app, whoever signs up becomes the sole
  owner of their own workspace — that's what a normal self-service signup
  still does. Everyone *they* invite only ever lands inside that one
  workspace, never with a stray workspace of their own. This is enforced
  at the trigger level, not just a UI convention. A normal signup (no
  invite involved) is unaffected and still gets a workspace automatically.
- **The signal for "this account was invited" is a flag this app sets
  itself, not a Supabase-internal field.** The first version of this fix
  (`schema_single_workspace_invites.sql`) checked `auth.users.invited_at`,
  on the documented assumption that Supabase's `inviteUserByEmail()`
  always sets it. Confirmed against a real invite that it doesn't
  reliably — a genuinely invited teammate still got a stray personal
  workspace. `schema_fix_invite_workspace_signal.sql` corrects this:
  `api/invite-member.js` now sets an explicit `pipeline_invited: true`
  flag in the new account's own metadata at creation time, and the
  trigger checks that (keeping the old `invited_at` check as a harmless
  fallback). Anyone invited before this fix went live may still have a
  stray workspace sitting around — see SETUP.md's "Cleaning up existing
  extra workspaces."
- **The workspace switcher only shows up when there's actually more than
  one to choose from.** With the fix above, a normal invited teammate will
  only ever belong to one workspace, so the switcher stays out of their
  way entirely rather than presenting a meaningless choice of one.
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
- **Task Assigned Members is three fixed role slots, not a free-form
  list.** Graphics Designer, Project Manager, Developer (defined once in
  `src/lib/roles.js`) always show up as plain text on the left, each with
  its own "choose a member" dropdown on the right — on the task's own
  page, and in both places a task gets created (My Tasks, a project's
  inline add-task row). No free text, no Add/Remove — picking a new
  person for a role replaces whoever was there; clearing back to "Choose
  a member…" unassigns it. A pre-existing assignment with a role label
  outside these three (or blank) won't show up here anymore — the row is
  still in the database, just not surfaced in this section.
- **Project Assigned members now matches the task version exactly** —
  same three fixed role slots, same "choose a member" dropdown per role,
  on both the project creation page and a project's own page. No more
  free-text "Role (optional)" field or `<datalist>` suggestions anywhere
  in the app — the last of that was removed along with this change.
- **Task creation is now admin/owner-only.** Everything else about
  tasks — marking done, reassigning, changing due dates, deleting — stays
  open to every member. Only adding *new* tasks is gated, and it's enforced
  at the database level (RLS), not just hidden in the UI.
- **Assigning at creation, not just after.** Admins now pick who a task
  goes to right when they add it, instead of adding it unassigned and
  circling back.
- **You can't accidentally lock yourself out.** The Team page won't let you
  change your own role or remove yourself, and won't let anyone demote or
  remove the last remaining owner of a workspace.

## How password requirements work

- **Same policy for both entry points, owner and member alike.** Owner
  signup (`AuthPage.jsx`, `handleSubmit`) and the shared invite/reset
  "set password" screen (`handleSetPassword`) both call the same
  `evaluatePassword()` from `src/lib/passwordStrength.js` — one place
  defines the rule, both forms enforce it identically.
- **The bar: at least 10 characters, not a known-common password, no
  simple repeated or sequential run** (`aaaaaaaaaa`, `1234567890`,
  `abcdefghij`), and **not your own name or email embedded in it.** These
  four are hard blocks — the form won't submit until all four pass.
- **Deliberately doesn't force a mix of symbols/numbers/case.** Current
  guidance (NIST 800-63B) favors length over composition rules — a long
  passphrase is both stronger and easier to actually remember than a short
  password with a forced `!` tacked on. The live strength meter still
  rewards variety and extra length visually, just doesn't require it.
- **The live meter (`PasswordStrengthMeter.jsx`) is feedback, not a second
  gate** — it shows a 4-segment bar plus a running checklist as you type,
  using the same `evaluatePassword()` call, so what you see while typing
  and what actually blocks submission never disagree.
- **This is a client-side guardrail, not the real security boundary.**
  Someone could call Supabase's signup API directly and skip the React
  form entirely. The actual enforcement point is Supabase's own
  server-side password policy (Authentication → Providers → Email →
  Password Requirements) — see Setup section 1, step 28. Set that to
  match (minimum length 10) before licensing this to anyone else.

## How two-factor authentication works

- **Built entirely on Supabase's own MFA support** — no new schema, no
  third-party service. `auth.mfa.enroll()` for a QR code and manual-entry
  secret, `challengeAndVerify()` to confirm it and (later) to log in.
- **Personal, opt-in, per person** — Settings has an "Enable two-factor
  authentication" card, same section as the notification preferences
  above it. Turning it on only affects your own login; nothing about a
  workspace or its other members changes.
- **Sign-in itself never fails or blocks because of MFA** — that's not how
  Supabase's model works. `signInWithPassword` succeeds and issues a real
  session either way; if that account has MFA enrolled, the session comes
  back at a lower "assurance level" (aal1) until the second factor is
  verified, and the app is responsible for noticing that and gating on
  it. `AuthContext` checks this on every auth event and exposes
  `needsMfaChallenge`; `AuthPage` shows the 6-digit code screen when it's
  true instead of the normal redirect into the app.
- **This gates the app's own UI, not the database directly.** Every
  protected route checks `needsMfaChallenge` (not just the login form —
  navigating straight to a URL with a pending challenge redirects back to
  it too), so nothing in the app itself is reachable without completing
  MFA. What this *doesn't* do: independently re-check aal2 inside RLS
  policies table-by-table. For a small team's internal tool, the honest
  read is that this protects against someone getting into Pipeline
  through its own login screen with just a stolen or guessed password —
  it isn't a defense against someone who's already obtained a valid
  session token going around the UI entirely and querying Supabase
  directly. Worth knowing, not something that needed solving for what
  this is.
- **Recovery, for real, via backup codes — but worth understanding how it
  actually works under the hood.** Supabase doesn't provide backup codes
  natively, so these are built on top: 10 single-use codes, generated
  automatically right after enrolling (shown once, save-them-now
  warning), regeneratable anytime from Settings. Here's the part worth
  being precise about: a backup code can't act as a substitute for a real
  TOTP check, because promoting a session to aal2 is something only
  Supabase's own `auth.mfa.verify()` can do — nothing outside it has that
  power. So instead of pretending to "pass" the challenge, entering a
  valid backup code at login (via "Lost your device? Use a backup code")
  **removes the lost authenticator entirely** through the Supabase Admin
  API, which doesn't care what assurance level the caller's own session
  is at. That makes the account stop requiring aal2 at all, so a normal
  password login works immediately afterward. Re-enabling 2FA (and
  getting a fresh set of codes) is a separate, deliberate step from
  Settings once back in — using a backup code is a full reset, not a
  one-time bypass that leaves the old authenticator still configured.
- **The backup-code recovery logic (in `api/mfa.js`) uses
  Supabase's Admin API to remove the factor — built against their
  documented conventions but not verified against a live call during
  development**, same honest caveat as the Wise integration. If the
  admin user endpoint's response shape or the delete-factor path differs
  even slightly from what's documented, that file is the first place to
  check.
- **Still no "admin resets a teammate's 2FA" button in Team** — backup
  codes cover the normal "lost my phone" case, but if someone loses both
  their authenticator *and* their saved codes, the practical fix is still
  the workspace owner going into the Supabase dashboard directly
  (Authentication → Users → that person → remove their MFA factor).

## How the activity log works

- **One unified log, not four separate ones.** Tasks, tickets, invoices,
  and projects all write to the same `activity_log` table — so a
  project's activity feed shows its own status changes interleaved with
  everything that happened on its tasks, tickets, and invoices, in one
  combined timeline, sorted by time. A ticket's or invoice's own detail
  page shows just that one thing's history, filtered down.
- **Automatic, not something app code has to remember to do.** Every entry
  is written by a database trigger on the relevant table (create, status
  change, reassignment, deletion) — so it can't be silently skipped by a
  future code change, and it captures changes no matter what path they
  came through, including ones made directly via the API.
- **Live, like the notification bell.** Uses the same Supabase Realtime
  publication — a status change made in one browser tab shows up in
  another tab's activity feed within a second or two, no refresh needed.
- **What gets logged, per entity:**
  - *Tasks*: created, status/assignee/due-date/title changes, deleted.
  - *Tickets*: created, status/priority/assignee changes, deleted.
    Comments aren't logged separately here — the ticket's own Discussion
    thread already is that record.
  - *Invoices*: created, status changes (draft → sent → paid → cancelled),
    deleted. Line-item edits aren't logged individually — logging every
    quantity/rate tweak would drown out the status changes that actually
    matter.
  - *Projects*: created, status changes, deleted (there's no delete button
    in the UI today, so that branch is currently unreachable through the
    app — included anyway so it's already correct if that ever gets added).
- **Existing task history was preserved, not reset.** This log replaces an
  earlier task-only version; its data was carried over rather than
  starting the log from zero.

## What's next (optional, not built)

- Browser push notifications when the app is closed entirely (the bell only shows what's already installed and open — a native push notification, even with the app closed, would need VAPID keys and push subscription storage, a bigger addition than fit this pass)
- A general "browse all tasks" page. My Tasks only shows what's assigned to *you* specifically — a standalone task assigned to someone else (or not assigned to anyone yet) has no page that lists it for everyone to find, the way a project's own task list works for project-linked tasks. Worth building if standalone tasks get used a lot.
