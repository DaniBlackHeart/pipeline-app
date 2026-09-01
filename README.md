# Pipeline

A full project management workspace: projects, tasks, time tracking,
invoicing (one-off and recurring), calendar, internal ticketing, reporting,
client sharing, file attachments, email notifications, and team management
— all on one multi-tenant schema.

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
                  Wise reconciliation client helpers, time tracking helpers
                  (rate resolution, timer start/stop, unbilled lookups),
                  useFocusTrap (keyboard focus trap shared by both modal
                  dialogs)
  pages/          AuthPage, Onboarding, Dashboard, NewProject, MyTasks,
                  ProjectDetail, TaskDetail, Invoices, InvoiceForm,
                  InvoiceDetail, RecurringInvoices, RecurringInvoiceForm,
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
  mfa.js                  2FA backup-code recovery + admin-assisted reset
                          (status/generate/recover/admin-reset all in one
                          file) — see "How two-factor authentication
                          works" below
  stripe.js               Stripe payments + auto-reconciliation (status/
                          connect/disconnect/generate-link/webhook all in
                          one file) — see "How invoicing works" below
  backup-export.js        Cron-triggered, service-role only — daily data
                          export to private Storage, see "How backups
                          work" below
  admin.js                Platform-wide admin dashboard (overview/health/
                          set-role, cross-org, gated by platform-admin
                          not org-admin) — see "How the admin dashboard
                          works" below
  auth-lockout.js         Per-account login failure counter PLUS the
                          pre-signup email-deliverability check
                          ('validate-email' action) — public/
                          unauthenticated by necessity, consolidated to
                          stay under the function cap — see "How login
                          lockout works" and "How email validation works"
                          below
  _authHelpers.js, _googleAuth.js, _wiseAuth.js, _stripeAuth.js,
  _mfaBackupCodes.js, _rateLimit.js, _emailValidation.js
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
  schema_recurring_invoice_idempotency.sql  Duplicate-generation guard on
                                              recurring invoice generation
  schema_rate_limits.sql        Shared rate-limit table (invites, Google
                                 OAuth connect attempts)
  schema_backups.sql            Table-discovery helper + private Storage
                                 bucket for the daily backup export
  RESTORE_PROCEDURE.md          Documented restore steps + stated RPO/RTO
                                 for that backup, see "How backups work"
  schema_billing_info.sql       Biller name/company/address on organizations,
                                 shown as the invoice PDF letterhead
  schema_profile_nickname.sql   Nickname alongside full name on profiles
  schema_rls_performance_indexes.sql  Indexes matching every RLS policy's
                                       org_id filter, for query performance
                                       at scale
  schema_chat.sql               Team chat: org channel, project/task
                                 threads, direct messages
  schema_chat_read_state.sql    Chat unread tracking (Slack/Messenger-style
                                 badges)
  schema_chat_mentions.sql      Chat @mentions
  schema_stripe.sql             Stripe payments + auto-reconciliation
                                 (service-role only)
  schema_client_brand_guidelines.sql  Brand guidelines field on clients;
                                       renames tasks.brand_guidelines to
                                       tasks.description
  schema_multi_role_assignees.sql  Lets one person hold more than one role
                                    on the same project or task
  schema_task_templates.sql     Reusable per-workspace task lists
                                 (task_templates + task_template_items),
                                 seeded with four starter templates
  schema_admin_mfa_reset.sql    Widens notifications.type so an admin-
                                 assisted 2FA reset can notify whoever it
                                 affects (no new table — see api/mfa.js);
                                 also fixes 3 earlier migrations' constraint
                                 widening silently dropping each other's types
  schema_notification_insert_resilience.sql  Makes every notifications
                                              insert (7 trigger functions)
                                              best-effort, so a bad type
                                              can never again fail the
                                              action it's attached to
  schema_onboarding.sql         Adds profiles.onboarding_completed_at —
                                 gates the first-time /welcome walkthrough,
                                 see "How onboarding works" below
  schema_time_tracking.sql      Time entries (timer + manual), org default
                                 + per-project hourly rate, RLS — see "How
                                 time tracking works" below
cleanup_redundant_workspaces.sql
  ONE-TIME, manually-reviewed cleanup — not part of the standard schema-file
  sequence. See its own header before running.
.github/workflows/
  ci.yml                  Build + lint on every push/PR — see "How CI
                           works" below
vercel.json
  Cron schedule for the daily digest, Google Calendar sync, Wise
  reconciliation, and backup export functions
public/
  manifest.json, sw.js, icons/    PWA assets
scripts/
  stamp-sw.js              Runs on every build, see "How the service
                            worker works" below
  strip-comments.js        Runs on every build, strips theme-init.js's
                            comments from the shipped copy, see "How
                            security headers work" below
  restore-backup.js        Runs a real backup file through
                            supabase/RESTORE_PROCEDURE.md's restore steps
legal/
  PRIVACY_POLICY.md, TERMS_OF_SERVICE.md    Starting drafts, not live —
                                             not lawyer-reviewed, not
                                             linked from the app yet
```

## How projects work

- **Created on its own page** (`/projects/new`), not a modal — same pattern
  as invoices and tickets. Landing on the new project's own page afterward,
  not back on the project list.
- **Client name, start date, and due date are all mandatory** — a project
  can't be created without them. Enforced at the database level, not just
  the form, same as the invoice requirements below.
- **Assigned members starts with the same three fixed role slots used on
  tasks** — Graphics Designer, Project Manager, Developer, each with its
  own "choose a member" dropdown, no free-text role field. Identical on
  the creation page and on a project's own page afterward. Adding someone
  notifies them, same as everywhere else people get added to something in
  this app.
  - **A project's own page (not the creation form) also has "+ Add
    member"** for anyone who doesn't fit those three canned roles —
    each click adds a row with a free-text role textbox and a member
    dropdown. A row stays a local draft (nothing written yet) until a
    member is actually picked; each saved row can have its role text
    edited (saves on blur), its person swapped, or be removed entirely.
    Shared with the task detail page via one `AssignedMembers` component
    (`src/components/AssignedMembers.jsx`).
  - **One person can hold more than one role on the same project or
    task at once** — every fixed slot, a mix of fixed slots and
    free-form rows, whatever's needed. Useful when one person (a solo
    freelancer, say) is doing the entire project alone rather than
    splitting it across a team. `project_assignees`/`task_assignees` key
    on `(project_id/task_id, user_id, role_label)` — one row per person
    *per role*, not one row per person overall, so a second role for the
    same person is just another row instead of something that has to
    displace their first one. The only thing still blocked is a literal
    duplicate: the same person in the exact same role twice. This used to
    key on `(project_id/task_id, user_id)` alone, which meant a second
    role for the same person had to *move* them there and clear the
    first — see `schema_multi_role_assignees.sql` for the migration.
- **Attachments too, on both the creation page and afterward** — links or
  file uploads, same as tasks and tickets already had. See "How
  attachments work" below for how the creation-page version handles not
  having a project id yet.
- **Description is editable after creation**, unlike most other project
  fields (client, start date, due date — still creation-time only). Its
  own card on the project page, same textarea as the creation form, with
  a Save button disabled until the text actually changes. Not admin-gated
  — like status and the client share link, any org member can edit it,
  since the `projects` RLS update policy is member-level, not admin-only.
- **Invoices linked to the project, shown below the task list.** This
  includes both invoices tied to the project directly and invoices tied to
  one of its individual tasks (a project's DB row and its tasks' rows never
  both carry the same invoice — see "How the task detail page works" —
  so the project page pulls in both to show the full picture). Each row
  is labeled "for the project" or "for &lt;task title&gt;" and links to the
  invoice itself.
- These rules only apply to *new* projects and only going forward — see
  `schema_project_requirements.sql`'s own header for how existing projects
  (which may predate mandatory client/due dates) are handled without
  breaking anything already in your database.
- **The main Projects list has a status filter** — All / Active / On hold /
  Completed / Archived pills above the grid, same pattern as the Tickets and
  Invoices list filters. Setting a project's status to Archived (from its own
  page) previously made it vanish from the list with no way back short of a
  direct link or the database — it still exists and its data is untouched,
  it just wasn't reachable from the UI. "All" excludes archived projects by
  default; the "Archived" pill is the only place to see them.

## How the Clients page works

- **A client is now a real record** (`/clients`, between My Tasks and
  Calendar in the top nav) — name, company, website, plus everything tied
  to them: linked projects, linked tasks, linked invoices, and files.
  Before this, "client" was just free text typed separately on each
  project, standalone task, and invoice, with no way to ask "show me
  everything for this client."
- **Every place that used to be a free-text client name field is now a
  picker** — choose an existing client from the dropdown, or "+ Add a new
  client…" right there without leaving the form (New Project, a standalone
  task's client section, and the invoice form all use the same picker).
  Picking a client still fills in the plain-text `client_name` column
  those tables already had, so nothing about their existing mandatory
  fields changed — the picker just replaces typing that text by hand with
  choosing (or creating) a real client record at the same time.
- **A task counts as linked to a client two ways**: directly, for a
  standalone task whose own client picker was set, or indirectly, for any
  task under one of that client's linked projects. The client page shows
  both, deduplicated.
- **Brand guidelines live on the client, not on individual tasks.** A
  free-text field (hex codes, font names, tone — anything text-shaped)
  with its own Save button, same editable-card pattern as a project's
  description. Not admin-gated, same reasoning as elsewhere: the
  `clients` RLS update policy is member-level. Actual brand assets (logo
  files, etc.) go in Files below instead, since those are usually files
  rather than text. This used to live per-task (`tasks.brand_guidelines`,
  shown only for standalone tasks) — since guidelines don't change from
  task to task, or usually even project to project, they're entered once
  here and reached from any of the client's projects or tasks via the
  "view client" link already on those pages, rather than duplicated
  everywhere. Existing per-task data wasn't migrated — the column was
  simply renamed to `tasks.description` and repurposed as pure
  task-scoped notes (see "How the task detail page works" above), so
  anything typed into that field before this change is still there, just
  now read as task notes rather than brand guidance.
- **Files use the same attachments system as everything else** — links or
  uploads, see "How attachments work" below.
- **Existing data gets linked automatically the first time you run
  `schema_clients.sql`** — it groups the client names already sitting on
  your projects/tasks/invoices/recurring templates (matched
  case/whitespace-insensitively, *within* each workspace — the same name
  in two different workspaces never gets merged), creates one client
  record per distinct name, and links every matching row to it. Re-running
  the file afterward is a no-op; it only ever fills in rows still missing
  a link.
- **Client names are unique per workspace** (case/whitespace-insensitive)
  — this is what makes the automatic linking above safe to re-run, and in
  practice two client rows named "Acme" in the same workspace are far more
  likely to be a typo than two genuinely different clients. If you
  actually do have two distinct clients that would otherwise collide,
  give one a distinguishing suffix (`Acme (NY)` / `Acme (Chicago)`).
- **Deleting a client doesn't touch anything it's linked to** — the
  project/task/invoice rows themselves are untouched, only the link
  (`client_id`) is cleared (`ON DELETE SET NULL`); each one's own
  `client_name` text, set at the time it was linked, stays exactly as it
  was.
- Client create/delete shows up in the unified activity log, same as
  every other entity — see "How the activity log works" below. Deliberately
  *not* logged for the one-time automatic backfill above, so upgrading
  doesn't flood the feed with history for data that already existed.

## How reports work

- No new tables — Reports is a read-only lens over projects, tasks,
  invoices, and tickets.
- **Admins/owners get four tabs** — Financial summary, Ticket activity,
  Project rollup, Timeline — shown one at a time on screen, plus a
  date-range picker (This month / Last month / This quarter / This year /
  All time / custom) that scopes the Financial summary and Ticket activity
  numbers, and also doubles as the Timeline tab's zoom control (see
  below). **Print / Save as PDF** always includes all four tabs regardless
  of which one is open; the tabs are just a browsing convenience, not a
  way to leave something out of the PDF.
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
- **Timeline** is a custom-built Gantt-style chart (no charting library —
  plain CSS bars scaled as percentages of the selected date range, in
  `src/components/GanttChart.jsx`) showing projects, tasks, tickets, and
  invoices together on one shared date axis, grouped into four lanes.
  Each bar links straight to that item's own page, and its color reuses
  the same status colors as everywhere else (`TallyDot`'s status map,
  now exported so both components share one source of truth). A bar's
  span is: project/task start date to due date; ticket filed date to
  resolved date (or to today if still open); invoice issue date to due
  date. A task with only one of start/due date set gets drawn as a
  single-day sliver rather than being skipped; a task with neither is
  left out, since there's nothing to place on the axis.
  - **No drag, resize, or dependency arrows** — it's a read-only picture
    of what's scheduled when, not a scheduling tool. The existing
    date-range preset picker above the tabs *is* the zoom control: pick
    "This month" for a tight view or "All time" for the full picture
    (bounds then come from the earliest/latest item date instead of the
    picker, since "all time" has no fixed edges of its own).
  - Admin/owner-only, same as Financial summary and Ticket activity,
    since it surfaces invoice data.
- **Print / Save as PDF** for a clean handoff document; **Download CSV** on
  the invoices, project, and task tables for spreadsheet work (visible to
  whichever tabs/sections that role can see). Timeline doesn't have its
  own CSV export — the same underlying data is already covered by the
  other tabs' exports.

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
- **The new/edit event dialog traps keyboard focus** (`src/lib/useFocusTrap.js`,
  shared with the task attachments dialog) — Tab/Shift+Tab cycle within
  the dialog's own controls instead of escaping into the page behind the
  dimmed overlay, on top of the `role="dialog"`/`aria-modal`/initial-focus/
  Escape-to-close handling both dialogs already had. Fixed as part of the
  layer-architecture-audit's accessibility item — see the architecture
  status doc.
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
  - **Connection attempts are rate-limited per person: 10 per 10
    minutes.** Covers a real reconnect-after-hiccup with room to spare,
    while blocking a scripted loop from hammering Google's token
    endpoint with repeated codes — see `api/_rateLimit.js`.

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
- **Stripe payments — a second option alongside Wise, with real
  auto-reconciliation of its own.** Not every client wants to pay through
  Wise, so Settings has a second, separate, admin-only, workspace-wide
  "Stripe payments" card: paste your Stripe secret key and a webhook
  signing secret, and every invoice gets its own on-demand "Generate
  Stripe payment link" button. Unlike the Wise link (one static permanent
  link reused on every invoice), each Stripe link is created fresh for
  that invoice's exact total, so it can't be paid for the wrong amount —
  and if an invoice total changes after a link already exists, the old
  link is deactivated and a new one generated in its place.
  - **Setup is two things from your Stripe Dashboard**, not one: the
    secret key (Developers → API keys), and a webhook signing secret from
    registering `/api/stripe?orgId=<your org id>` — shown right in the
    Settings card, ready to copy — as an endpoint listening for
    `checkout.session.completed` (Developers → Webhooks). Both get pasted
    into Settings and saved together; the secret key is verified against
    a real Stripe endpoint before saving, so a typo or wrong-account key
    is caught immediately instead of failing silently later.
  - **Reconciliation is real-time and exact, not a daily guess.** Every
    Stripe link Pipeline generates carries the Pipeline invoice id in its
    metadata, which Stripe automatically copies onto the resulting
    Checkout Session. The moment a client pays, Stripe's webhook fires,
    Pipeline verifies the signature, and — because the invoice id is
    right there in the event, not inferred from a typed-in payment
    reference the way Wise matching has to be — marks that exact invoice
    paid immediately. A payment through a Stripe Payment Link that wasn't
    generated by Pipeline (made by hand in the Stripe Dashboard, say)
    still can't be matched to anything, and lands in an "Unmatched Stripe
    events" panel on the Invoices page for a human to confirm or dismiss,
    same fallback Wise already has.
  - **Webhook-only, on purpose — no daily backfill sync the way Wise
    has.** Stripe pushes events in real time, so there's nothing to poll.
    The honest tradeoff: if the webhook endpoint is ever unreachable for
    a stretch (Stripe retries failed deliveries automatically, but not
    forever), a payment during that window won't be caught retroactively
    — it would need reconciling by hand from the Stripe Dashboard.
  - **Currency assumption:** amounts are converted to Stripe's
    smallest-unit integer with a plain `amount * 100`, which is exact for
    every currency this app currently offers (all two-decimal — see
    `src/lib/currency.js`). Would need adjusting if a zero-decimal
    currency like JPY were ever added.
  - **Untested against a live Stripe account**, same honesty as the Wise
    note above — built carefully against Stripe's documented API and
    webhook-signing behavior, but not yet run against a real account
    processing a real payment. Treat this as "ready to try, not yet
    proven."
- Status (draft/sent/paid/cancelled) is tracked per invoice; "overdue" is
  computed automatically in the UI when a sent invoice's due date has passed
  — no separate status to remember to set.
- **Printed/PDF invoices show your real billing identity, not a
  placeholder.** Settings → Billing (name, company, address — all
  optional, `organizations.biller_name`/`biller_company`/`biller_address`)
  renders top-right on every invoice, next to the invoice number/issue
  date/due date, which moved to the top-left to make room. Any field left
  blank in Settings just doesn't show up on the invoice; if Billing has
  never been filled in at all, the letterhead falls back to the
  workspace's own name rather than rendering empty. No uploaded-logo
  support yet — text only.
  Printing also suppresses the browser's own header/footer (today's
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
- **The view itself is now rate-limited too** (60 views per 10 minutes per
  token) — previously this was the one public-facing endpoint without any
  cap at all, since it's a direct RPC call from the browser with no
  `api/*.js` function in front of it the way invite/OAuth/MFA have.
  Deliberately generous since it's read-only and already narrow in what
  it returns; the goal is blunting a scraping script, not limiting normal
  use. Uses the same `rate_limit_events` table the other rate limits
  share — see `schema_share_view_rate_limit.sql`.
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
- **Task description** — a free-text notes field (separate from the
  project's own description above it), for scope, requirements, or
  anything else specific to this one task. Saves on blur. This used to
  only appear for standalone tasks (labeled "brand guidelines" and doing
  double duty as a place for client brand notes); it's now shown for
  every task, project-linked or not, and holds only task-scoped notes —
  see "How the Clients page works" below for where brand guidelines
  moved to.
- **Start date, alongside the existing due date.** Both project-linked and
  standalone tasks get a start date the moment they're created (defaults
  to that day, editable) — see "How My Tasks works" above.
- **Assigned members — three fixed role slots (Graphics Designer, Project
  Manager, Developer), one "choose a member" dropdown each, plus
  unlimited free-form rows below via "+ Add member."** This is separate
  from the simple single-assignee dropdown used in project task rows and
  My Tasks (that stays the quick way to set *one* primary person) — think
  of that dropdown as "who's the main owner" and this section as "who's
  actually working on it, in what capacity." The three role names
  themselves aren't editable; only who fills each one is. A free-form row
  gets its own editable role textbox (optional — saves on blur) and its
  own member dropdown, and can be removed. Both task-creation forms still
  have just the three fixed slots built in, so a task can go out staffed
  with its core roles without a follow-up trip to its own page — extra
  members get added there afterward.
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

## How time tracking works

Lives on the task detail page (see above) — every time entry is logged
against a task, and a project's total is the sum of its tasks' entries,
the same way invoicing already treats "the whole project" as shorthand
for "all of it."

- **Two ways to log time: a live start/stop timer, or a manual entry.**
  The timer shows a running elapsed count once started and writes its
  final duration the moment you stop it; manual entries are for anything
  you forgot to time live or did outside the app — pick a date, type
  hours (decimals fine, e.g. `1.5`), optionally a note.
- **Only one running timer per person, enforced in the database, not
  just the UI** — starting a second one anywhere else in the app isn't
  possible until the first is stopped. If a teammate has their own timer
  running on the same task you're looking at, you'll see that noted, but
  it never blocks or gets confused with your own.
- **Billing rate resolves from the project, then the org.** Settings →
  Billing has one default hourly rate for the whole org; any project can
  override it with its own rate (set inline on the project page, next to
  its progress bar). A standalone task with no project just uses the org
  default. Leave both unset and time tracking still works — hours show
  up everywhere, just without a dollar amount attached until a rate
  exists somewhere in that chain.
- **Invoices can pull unbilled time in directly.** Creating or editing an
  invoice linked to a project or task shows a "+ Add logged time" button
  next to "+ Add line" — it totals up whatever hasn't been billed yet
  (across every task, if the invoice is project-linked) into one line
  item at the resolved rate, and marks those specific entries billed the
  moment the invoice is actually saved, not before. The line item's
  quantity and rate stay normal, editable fields afterward, same as any
  other line — editing the rate before saving changes what actually gets
  billed.
- **"Mark unbilled" is the safety valve, and it's admin-only.** If a
  "Logged time" line item ever gets deleted from an invoice after having
  been added (during an edit, say), the underlying entries stay flagged
  billed — they don't automatically release themselves just because the
  line disappeared. An org admin can use "Mark unbilled" on the task page
  to free those hours up for a different invoice. This is deliberately
  restricted to admins — an entry's own owner can't flip their own
  billing status once it's set (enforced in the database, not just
  hidden in the UI), so a client can't end up double-billed for the same
  hours by an entry quietly getting unbilled and re-pulled without an
  admin's involvement.
- **You can only log time under your own account.** No admin correcting
  or backdating someone else's hours on their behalf yet — a mistake
  needs the person who logged it to fix or delete their own entry (or an
  admin can delete it outright; editing someone else's entry isn't
  possible for anyone but them).
- **No time report in Reports yet.** The task and project pages both show
  a running total, but there's no cross-project "hours this week/month"
  view — worth adding if billing by time becomes the primary way invoices
  get built rather than the exception.

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
- **Colors are contrast-checked against WCAG AA for actual text pairs**
  (ink/ink-muted against bg/panel) — comfortably pass in both themes. The
  three tally accents (`--tally-progress`/`-alert`/`-done`) are tuned for
  their real job — dots, progress-bar fills, borders against `--panel` —
  not for sitting as text on their own `-soft` tint; measured that way in
  light mode they land at 3.5:1/3.0:1/1.99:1, under AA's 4.5:1 for
  normal-size text (an `app-audit` layer-architecture-audit finding, not
  caught when this section was first written). Three darker `-text`
  variants (`--tally-progress-text`/`-alert-text`/`-done-text`) exist
  specifically for that one context — every status message and badge
  that puts a tally color as text on its own soft background uses the
  `-text` version, ~77 call sites across 30 files — while dots, fills,
  and the Scrubber/TallyDot components keep the original accent
  unchanged. Dark mode's base accents already cleared 4.5:1 against their
  own soft background except alert (4.4:1), which got a small brightness
  bump for its `-text` variant; the other two dark `-text` variants just
  reuse the base color. Loosely calibrated the panel/border elevation
  differences against GitHub's own dark theme rather than chasing a
  literal 3:1 there, since strict non-text contrast on adjacent
  near-black surfaces produces a washed-out result that isn't actually
  how any real dark UI looks (GitHub's own border-vs-canvas is roughly
  1.5:1, not 3:1) — the same reasoning is why `--border` against `--panel`
  (~1.4:1 in light mode) hasn't been changed; that's tracked as an open
  before-licensing question in the architecture status doc, not silently
  ignored.
- **Native `<select>` dropdowns needed an explicit fix, separate from
  everything else.** `color-scheme: dark` alone wasn't enough to theme
  the opened options popup (a known cross-browser quirk, not specific to
  this app) — it fell back to a plain white popup with washed-out text.
  `select, option { background-color: var(--panel); color: var(--ink); }`
  in index.css fixes it directly, since Chrome and Firefox both respect
  explicit background/color on `<option>` even when `color-scheme` alone
  doesn't fully theme the native popup.

## How global search works

- **Jump straight to a task, client, or invoice by name/number instead of
  navigating through list pages.** Didn't exist anywhere in the app
  before this — previously the only way to find a specific record was to
  open its list page and scroll/filter. `src/components/GlobalSearch.jsx`,
  rendered from `AppShell`'s header on every page.
- **Opens two ways**: the search button in the header (with a "Ctrl K"
  hint visible on wider screens), or the `Ctrl`/`Cmd`+K keyboard shortcut
  from anywhere in the app. Escape or an outside click closes it, same
  pattern as the account menu and notification bell.
- **Debounced at 250ms, minimum 2 characters**, to avoid firing a query on
  every keystroke. While typing, the panel shows a "type at least 2
  characters" hint, then "Searching…", then grouped results or a
  no-matches message — never a blank flash.
- **Searches three tables in parallel**: `tasks` (title), `clients` (name
  and company), and `invoices` (invoice number and client name), each
  explicitly scoped with `.eq('org_id', activeOrgId)` on top of what RLS
  already enforces — defense in depth, and it also means a stale
  `activeOrgId` can't leak another workspace's results even for a split
  second while a query is in flight.
- **Multi-column matches use two separate `.ilike()` queries merged
  client-side, not a hand-built `.or()` filter string.** PostgREST's
  `.or()` syntax treats commas and parentheses as structural, so a real
  client name like "Smith, Inc." would silently break a combined filter.
  Two plain `.ilike()` calls per table, deduped by `id` afterward, sidesteps
  that parsing problem entirely.
- **Results are grouped by type (Tasks/Clients/Invoices), capped at 5 per
  group.** Clicking a result — or pressing Enter to jump to the first
  match found — navigates straight to that record's detail page and
  closes the search panel.

## How bulk task actions work

- **Select multiple tasks and apply one change to all of them, instead of
  editing rows one at a time.** Available on both the Project task list
  (`src/pages/ProjectDetail.jsx`) and My Tasks (`src/pages/MyTasks.jsx`),
  via a shared `src/components/BulkTaskActionBar.jsx` component. A
  checkbox on each row plus a "Select all" checkbox (scoped to whatever's
  currently visible — the active filter tab on My Tasks) build up the
  selection; the action bar appears above the list once at least one task
  is checked.
- **Each action is one Supabase call for the whole batch**
  (`.update(...).in('id', ids)` / `.delete().in('id', ids)`), not one
  request per selected task. This works cleanly under the existing RLS
  policies without any change to them — `tasks` UPDATE/DELETE policies
  are already row-level (`is_org_member(org_id)`, evaluated per row), the
  same check a single-row edit already goes through.
- **Selection persists across actions, but clears after delete.** You can
  select a batch, set status, then set an assignee, then set a due date,
  all against the same selection — it only resets when you hit Clear or
  delete the selected tasks (since those rows are gone).
- **The two pages expose different actions, matching what each page
  already allowed per-row before this feature existed** — the point was
  to batch existing capability, not quietly grant new permissions:
  - **Project task list**: status, due date, assignee, and delete — all
    four already existed as per-row actions here, open to any workspace
    member (not admin-gated), same as before.
  - **My Tasks**: status and due date only. This page never had per-row
    assignee editing or a delete button, so bulk versions of those aren't
    added here either — extending what a page already does, not adding
    net-new editing surface to it in passing.
- **Bulk delete carries the same permission level as single-task delete
  already did** — any workspace member, not admin-only. That mirrors
  existing behavior rather than introducing a new restriction, though
  it's worth revisiting if task deletion should be admin-gated generally
  (tracked as an open question, not decided here).

## How task trash (soft delete) works

- **"Delete" no longer removes a task immediately — it sets a `deleted_at`
  timestamp and the task disappears from every normal view, recoverable
  from a new Trash page (`src/pages/Trash.jsx`, linked from the name
  dropdown next to Task Templates).** Schema change:
  `supabase/schema_task_soft_delete.sql` adds the nullable
  `deleted_at timestamptz` column plus an `(org_id, deleted_at)` index — no
  RLS policy changes were needed, since setting/clearing it is an ordinary
  column update already covered by the existing row-level UPDATE policy,
  and permanent removal from Trash goes through the existing DELETE
  policy the same way a hard delete always did.
- **Every list, report, search, and picker that reads from `tasks` now
  filters on `deleted_at is null`** — the project task list, My Tasks,
  Dashboard's counts, Reports' rollups and CSV export, Calendar's due-date
  merge, Global Search, the client detail page's linked tasks, the "has
  linked tasks" check on the Clients list, the task-to-task relation
  picker, the invoice/recurring-invoice task pickers, and the chat
  task-mention picker — 13 call sites across 11 files. A trashed task
  stops appearing anywhere in the app except Trash itself and, if you
  still have the direct link, its own detail page (see next point).
- **One deliberate exception: unbilled time entries on a trashed task
  still count toward that project's unbilled total for invoicing.**
  Moving a task to trash doesn't erase the work that was actually logged
  against it — treating already-logged time as unbillable the moment its
  task is trashed would be a real (and easy to miss) revenue loss, not a
  cosmetic issue, so `fetchUnbilledForProject()` in `src/lib/timeTracking.js`
  was deliberately left unfiltered rather than "fixed" to match the
  pattern everywhere else.
- **Opening a trashed task directly (`/tasks/:id`) doesn't hide or
  redirect it — it shows the task normally, with an alert banner** ("This
  task is in Trash...") offering Restore and, for admins, Delete
  permanently. A stray bookmark or link to a deleted task should explain
  itself, not silently 404 or bounce you away.
- **An existing invoice that references a task which later gets trashed
  keeps showing that task's name, with a "(deleted)" suffix**
  (`InvoiceDetail.jsx`) — the invoice itself doesn't change, it's just
  labeled so it's clear the underlying task no longer shows up elsewhere.
- **Restoring is open to any workspace member — the same permission level
  moving a task to trash already had.** Permanently deleting is
  admin-only, since unlike everything else in this feature, it's the one
  step that's actually irreversible; enforced in the application layer
  (`Trash.jsx`, `TaskDetail.jsx`), the same way admin-only task creation
  already is, since there's no existing precedent in this schema for a
  role check inside an RLS policy itself.
- **No automatic purge.** Trashed tasks stay there indefinitely until
  someone restores or permanently deletes them — simplest thing that's
  sufficient for now; a scheduled cleanup (e.g. auto-purge after 30 days)
  is a reasonable later addition but wasn't built ahead of need, consistent
  with this project's free-tier-now approach.

## How client-facing overdue-invoice reminders work

- **Two ways to send one, both landing in the same place.** A **"Send
  reminder"** button appears on any overdue invoice's page for admins
  (`InvoiceDetail.jsx`) and sends immediately, one click. Separately, a new
  daily cron (`api/invoice-reminders.js`) can send them automatically —
  but only for workspaces that turn it on, per workspace, in **Settings →
  Overdue invoice reminders** (`organizations.auto_invoice_reminders`,
  **off by default**). Nothing goes to a client automatically until an
  admin opts that workspace in; the manual button always works regardless
  of the setting.
- **Automatic cadence: once as soon as it's overdue, then every 7 days
  until paid.** Both the manual button and the automatic job write the
  same `invoices.last_reminder_sent_at` column, so a manual send also
  resets the automatic job's 7-day clock instead of the two overlapping
  and double-sending on the same day.
- **"Overdue" isn't a stored status — it's computed the same way it
  already was everywhere else in the app** (`status = 'sent'` and
  `due_date` in the past, the same predicate `deriveInvoiceDisplayStatus()`
  uses on `ProjectDetail.jsx`/`TaskDetail.jsx`/`ClientDetail.jsx`), just
  replicated server-side in the cron since a database query can't filter
  on a client-computed value.
- **The reminder email includes a "Pay now" link when one exists** — the
  invoice's own Stripe payment link if one was generated, falling back to
  the workspace's permanent Wise payment link otherwise. If neither is
  set, the email still goes out with the amount, due date, and days
  overdue, just without a payment button.
- **One new serverless function** (`api/invoice-reminders.js`, #10 of
  Vercel Hobby's 12), dispatched by HTTP method rather than sharing a file
  with `daily-digest.js` — GET is the cron path (`CRON_SECRET`-gated,
  service-role key, bypasses RLS same as every other cron here), POST is
  the manual path (the caller's own session token, independently verified
  as an org admin server-side — never trusts a client-supplied role).
  Extracted the actual Resend send call the digest cron already had into
  a shared `api/_email.js` helper so this didn't need its own copy.
- **Manual sending is admin-only**, matching the permission level of the
  other consequential actions already on this page (status changes,
  editing) — not opened up to every member, since it's an email that goes
  directly to a real client.
- **No PDF attached.** This is a plain-text-style reminder nudging about
  an existing invoice, not a resend of the invoice document itself —
  invoices still aren't emailed automatically in general (see the known
  limitation on that), so a client who needs the actual invoice again
  still gets it the same manual way they got it the first time.

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
  link to set a password. The address is checked for basic deliverability
  first — see "How email validation works" — so a fake or nonexistent
  domain is rejected before either path runs.
- **The permission check happens twice, deliberately.** The UI hides the
  invite form from non-admins, but that's just convenience — the real
  enforcement is in `api/invite-member.js`, which independently verifies
  the caller's own session token and looks up their actual role in that
  workspace before doing anything. A regular member calling the endpoint
  directly (bypassing the UI) would still get rejected, because the check
  doesn't trust anything the client sends about its own permissions.
- **Invites are rate-limited per workspace: 20 per hour.** Generous for a
  real onboarding burst, but it stops a compromised admin session (or a
  mistaken bulk-paste) from spamming Supabase's invite emails. Hitting the
  limit shows a clear "wait a bit" message rather than failing silently —
  see `api/_rateLimit.js`.
- **Task and project Assigned Members: three fixed role slots plus
  unlimited free-form rows.** Graphics Designer, Project Manager,
  Developer (defined once in `src/lib/roles.js`) always show up first as
  plain text on the left, each with its own "choose a member" dropdown on
  the right — identical on both detail pages, and in both places a task
  gets created (My Tasks, a project's inline add-task row), where only
  the three fixed slots are offered. On a project's or task's own page, a
  "+ Add member" button below the three slots adds free-form rows: a
  role textbox (optional, saves on blur) plus a member dropdown, each
  removable. Picking a new person for a fixed role, or for an existing
  free-form row, replaces whoever was there; clearing a fixed slot back
  to "Choose a member…" unassigns it. Both the fixed slots and the
  free-form rows share the same underlying table
  (`project_assignees`/`task_assignees`, one row per person per role —
  see "one person can hold more than one role" above), so a
  pre-existing assignment with a role label outside the three fixed
  ones now surfaces as a free-form row instead of being hidden, as it
  previously was.
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

## How task templates work
- **A reusable, ordered task list you can drop into a project instead of
  typing tasks in one at a time.** Each template is a name, an optional
  description, and an ordered list of items — a title, an optional
  suggested role, and an optional description per item. Live at
  `/task-templates` and `/task-templates/:templateId`, linked from the
  account dropdown menu (next to Team and Settings) rather than the main
  nav bar, since managing templates is occasional setup work, not
  day-to-day project work.
- **Comes seeded with four starter templates** — Website Building,
  Website Makeover, Video Editing, and System Workflows — one set per
  workspace, added by `schema_task_templates.sql`. These are a
  reasonable starting draft, not a prescription: edit, reorder, add, or
  delete anything in them the same as a template you create from
  scratch. "System Workflows" in particular is the vaguest of the four
  (that name doesn't map to one obvious standard process the way the
  other three do) — treat it as the roughest starting point of the set.
- **Managing templates (creating, renaming, deleting, editing their task
  lists) is admin/owner-only**, enforced at the database level (RLS),
  same reasoning as task creation itself being admin-gated: a template
  shapes how work gets created workspace-wide, not one person's own
  content. Any member can still *apply* an existing template.
- **Suggested role is free text, not the three fixed
  `QUICK_ROLES`.** A video-editing template legitimately wants "Video
  Editor," not a forced fit into Graphics Designer / Project Manager /
  Developer. It's just a label carried on the template item — applying
  a template still means picking a real person for each role that
  comes up, exactly like assigning anyone else.
- **Usable two ways: right when creating a project, or any time after
  from the project's own page.** Both flows are the same picker
  (`TemplatePicker`) — choose a template, see its task list preview,
  optionally assign a real workspace member to each distinct role the
  template uses, leave any role unassigned to fill in later. Applying
  appends the template's tasks after whatever tasks the project already
  has, in the template's own order.
- **Applying is best-effort past the first task.** Tasks are added one
  at a time (not a single bulk insert) so each new task's own id is
  available immediately for its assignee row, without depending on
  insert-order guarantees from a multi-row insert. If something fails
  partway through, the tasks already added stay added — nothing rolls
  back — and the rest can be added by hand or by re-applying the
  template. On the new-project form specifically, a template failure
  never blocks navigating to the newly created project, matching the
  same non-blocking pattern already used there for members and
  attachments.

## How team chat works
A new, standalone feature — deliberately separate from task Notes and
ticket comment threads rather than an upgrade to those, and team members
only (no client access). Everything lives in one place: the **Chat** page
in the top nav — a single, unified, Messenger-style hub rather than
scattered across the app. (An earlier version embedded project/task
threads inline on their own detail pages; that felt like a box wedged
into an unrelated page rather than a real chat experience, so it moved
here instead.) Four kinds of conversation, all in the same sidebar:

- **General** — one shared channel per organization, created automatically
  the first time anyone opens the Chat page. Visible to every org member.
- **Projects** — every project in the org is listed and clickable; its
  thread is created the first time anyone opens it. A bounded, channel-like
  set, so the full list shows up front rather than requiring a search.
- **Tasks** — deliberately handled differently from Projects, since a busy
  workspace can have far more tasks than projects: only threads someone
  has already started show up in the sidebar. Finding any other task to
  start a new thread goes through "+ New" → a live title search, the same
  pattern DMs already use.
- **Direct messages** — one-on-one between two teammates in the same
  organization, started from "+ New" → a teammate picker. These are the
  one conversation type genuinely restricted beyond org membership: only
  the two participants can ever see a DM, enforced at the RLS level via a
  dedicated participants table, not just hidden in the UI.

Project and task threads are still visible to every org member, same as
tasks/projects/comments elsewhere in the app — not restricted to
assignees specifically, matching the existing precedent that RLS is
org-wide and the UI (here, "did someone already start this thread") is
the relevance filter, not a security boundary.

Messages arrive live via Supabase Realtime (the same mechanism already
powering the activity feed and notification bell) — no refresh needed
while a conversation is open.

**Unread badges** (Slack/Messenger-style) show on the Chat nav link (a
total across every conversation) and on each conversation in the
sidebar (a per-conversation count). A conversation is marked read the
moment you open it, and again automatically if a new message arrives
while you're already looking at it — you're never shown an unread badge
for something you're actively viewing. Counts update live via Realtime,
not on a refresh or poll.

**@mentions** — type `@` in the composer to bring up a live-filtered
picker of org members; picking one inserts `@Name` and tags that person
explicitly. Only people picked from the dropdown ever count as a real
mention — typing someone's name as plain text doesn't, since there's no
reliable way to tell "meant as a mention" from "happened to type their
name" from text alone. A mention does three things a regular message
doesn't:
- Renders highlighted (amber) in the message, for everyone in the
  conversation, not just the person mentioned.
- Turns that conversation's sidebar badge amber instead of the usual
  red, and does the same to the total badge on the Chat nav link, so a
  mention reads as more urgent than routine unread traffic at a glance.
- Creates a real notification-bell entry ("X mentioned you in Y"),
  visible from anywhere in the app, not just while Chat is open.
  Clicking it opens Chat with that exact conversation already selected
  (via `?conversation=<id>`), not just the Chat page in general.

**Known limitations, honestly scoped for v1:**
- No editing or deleting a sent message.
- No read receipts or typing indicators yet (unread badges and mentions
  exist, but nothing tells you when the other person has actually read
  your message, or that they're currently typing).
- Mentions don't reach the daily email digest — only the in-app bell and
  chat badges. Someone who isn't actively using Pipeline that day won't
  get emailed about being mentioned.
- No way to see, from one place, everyone who mentioned you recently —
  each mention is a normal bell notification plus a highlighted badge on
  its own conversation, not a dedicated "mentions" inbox.
- Message history isn't searchable yet — a thread just scrolls.
- The Tasks list only shows threads someone already started (see above) —
  a task with no messages yet won't appear until someone finds it via
  "+ New" and sends the first one.
- A conversation, once created, can't be renamed or archived.

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
  Password Requirements) — see Setup section 1, step 47. Set that to
  match (minimum length 10) before licensing this to anyone else.

## How login lockout works
Closes a specific, real gap rather than duplicating what Supabase already
does. Supabase Auth applies its own default rate limiting to
`/auth/v1/token` (configurable under Authentication → Rate Limits) — that
protection is IP-based, which stops a single source hammering the login
endpoint, but doesn't stop someone brute-forcing one specific account's
password from many different IP addresses. Pipeline never re-checks
passwords or re-implements Supabase's own logic — `api/auth-lockout.js`
only tracks failed attempts per account (by email), reusing the same
`rate_limit_events` table every other rate limit in this app already
uses.

- Before attempting sign-in, the login form asks `api/auth-lockout.js`
  whether this email has 10 or more recorded failures in the last 15
  minutes. If so, sign-in is blocked client-side with a "try again in
  about N minutes" message — Supabase is never even called.
- After Supabase itself rejects a login attempt (wrong password), the
  form records exactly one failure for that email. Successful logins and
  signup attempts never count toward this.
- Deliberately public/unauthenticated, since it has to run before any
  session exists — but it never looks up whether the email belongs to a
  real account, so a response can't be used to enumerate valid accounts
  either way.
- **Known trade-off, inherent to any account-level lockout, not unique
  to this implementation:** someone who knows or guesses a target's email
  could deliberately trigger their lockout by spamming failed-attempt
  reports for that address. The 10-attempts / 15-minute threshold is set
  generously enough that this is a mild, temporary annoyance rather than
  a durable denial-of-service — tighten only if real evidence suggests
  otherwise.
- Fails open everywhere: if the lockout check itself errors or can't be
  reached, login proceeds normally rather than silently blocking real
  users over an infra hiccup.

## How email validation works
Added after a manual test showed neither signup nor invite caught a
syntactically-fine-but-fake address (`carovox534@slotbeer.com`) — both used
to hand off straight to Supabase Auth, which only checks that an address is
well-formed, not that it's real.

- **Free-tier by design, and honestly limited because of it.** Before
  either signup or an invite goes through, `api/_emailValidation.js` checks:
  the address is well-formed; the domain isn't a known disposable/throwaway
  provider (`disposable-email-domains`, an MIT-licensed, community-maintained
  list of ~121k domains); and the domain actually has DNS records that can
  receive mail (an MX record, or — per RFC 5321's fallback rule — an A/AAAA
  record if it has no MX). **It does not, and can't for free, confirm that
  one specific mailbox exists.** No free method can — real mail providers,
  Gmail included, refuse to answer that over SMTP. A real domain with a
  made-up local part (`asdf1234@gmail.com`) passes this check. Actual
  mailbox *ownership* is still proven the way Supabase Auth already proves
  it: the confirmation-email click-through (signup: "confirm your email";
  invite: the magic link to set a password).
- **Same guard, two call sites.** `api/invite-member.js` runs it
  server-side before either the existing-account lookup or a new invite
  send. Signup runs it from the client (`src/lib/authLockout.js`'s
  `validateEmailForSignup`) via a new `validate-email` action added to the
  existing `api/auth-lockout.js` endpoint — extended rather than given its
  own file, to stay under Vercel Hobby's 12-function cap.
- **Rate-limited by IP, not by email**, since signup's pre-check runs
  before any account exists — 30 checks per 5 minutes, generous for a real
  person retyping a typo, tight enough to stop a script from using this
  endpoint as a free DNS-lookup or disposable-domain oracle.
- **Fails open on infra errors, same as every other guard in this app:** a
  DNS resolver timeout or an unreachable rate-limit table is treated as
  "couldn't confirm," not "this email is bad" — a real signup or invite
  should never fail because of a hiccup in this check.
- **Upgrade path, deferred, not built:** a paid mailbox-verification API
  (Kickbox, ZeroBounce, AbstractAPI) would catch the `asdf1234@gmail.com`
  case this can't, at a small per-lookup cost. Worth adding before
  licensing this to someone who'll actually pay for onboarding volume, not
  before.

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
- **Recovery attempts are rate-limited per user: 5 per 15 minutes.**
  Brute-forcing an actual code is computationally infeasible on its own
  (10 characters from a 31-character alphabet), so this isn't really
  guarding against that — it's the same cheap defense-in-depth already
  applied to invites and the Google OAuth exchange, closing the one
  write-capable endpoint that didn't have it yet. See `api/_rateLimit.js`.
- **Admin-assisted reset, for when backup codes are also gone.** Backup
  codes cover the normal "lost my phone" case; this covers the one after
  that — someone who's lost their authenticator *and* their saved codes.
  Any workspace owner/admin can remove a teammate's authenticator from
  the Team page (each member row gets a "Reset 2FA" action, two-step
  confirm, same shape as everywhere else in the app that confirms before
  a destructive action). Under the hood it's the exact same mechanism as
  backup-code recovery above — `api/mfa.js`'s `admin-reset` action
  deletes the TOTP factor via the Admin API and clears any leftover
  codes — just triggered by an admin acting on someone else's account
  instead of the account holder using a code. `requireOrgAdmin` verifies
  the caller server-side (never trusts the client's own admin-ness), the
  target must actually be a member of that same workspace (an admin of
  one org can't reset an arbitrary user id from another), it's rate-
  limited per workspace (10/hour, tighter than invites' 20 since this is
  the more sensitive action), and can't be used on your own account
  (Settings already has that, with its own confirm step). The affected
  person gets a real in-app notification explaining what happened and
  who did it — this isn't a silent bypass, and they'd choose to
  re-enroll from Settings afterward if they want 2FA back on.
- **Building this surfaced a real, pre-existing bug in `notifications.type`,
  fixed alongside it.** Three earlier migrations
  (`schema_project_requirements.sql`, `schema_task_detail.sql`,
  `schema_chat_mentions.sql`) had each widened that column's check
  constraint by adding only their own new type on top of the original
  three, silently dropping whichever type the migration before them had
  added. Invisible on a brand-new database; on one with real usage, it
  meant the *next* migration's ALTER could fail outright against
  existing rows — which is exactly what happened running
  `schema_admin_mfa_reset.sql`, and a strong signal that task-note and
  project-assignment notifications (and possibly the actions themselves
  — see below) had likely been silently broken since whichever migration
  ran last narrowed the list. `schema_admin_mfa_reset.sql` now carries
  the full union of every type ever used, with a loud comment warning
  the next migration to do the same.
  `schema_notification_insert_resilience.sql` is the other half: every
  trigger that writes to `notifications` (seven of them, across three
  files) now wraps its insert in its own exception-safe sub-block, so a
  bad type — from this bug recurring, or any other cause — can only ever
  cost a missing notification going forward, never fail the actual
  action (adding a task note, assigning a project, commenting, an
  @mention) it's attached to. A failure still isn't silent — it's a
  `RAISE WARNING`, visible in Supabase's Postgres logs.

## How onboarding works

- **One short walkthrough, shown once, same for everyone.** Right after
  first login — whether the account is an owner, admin, or member — a
  four-step `/welcome` page (`src/pages/Onboarding.jsx`) gives a quick
  look at every module (Projects/Tasks, Invoicing, Calendar, Tickets,
  Reports, Team) plus a handful of practical tips, before landing on the
  Dashboard. Content is identical regardless of role — the app's real
  permission boundaries already show up naturally once someone's actually
  using it (an admin sees "Reset 2FA" on Team, a member doesn't), so this
  doesn't try to pre-explain who can do what.
- **Gated the same shape as the MFA challenge.** `profiles` gets one new
  nullable column, `onboarding_completed_at` (`schema_onboarding.sql`) —
  null means "hasn't finished or skipped it yet." `AuthContext` computes
  `needsOnboarding` from it, and `ProtectedRoute` (`src/App.jsx`) redirects
  to `/welcome` whenever it's true, checked right after `needsMfaChallenge`
  so a still-pending second factor always comes first. `/welcome` itself
  has its own `OnboardingRoute` wrapper — authenticated and past any MFA
  challenge, but deliberately *not* gated on `needsOnboarding` (that's the
  flag this page exists to clear) and not wrapped in the normal `AppShell`
  nav, since the point is a full-bleed walkthrough rather than another
  page inside the usual chrome.
- **Skipping counts as seeing it.** Both "Get started" (after the last
  step) and "Skip for now" (available on every step) set the same
  `onboarding_completed_at` timestamp via a plain client-side
  `profiles` update — RLS already allows anyone to update their own
  profile row, so no server function was needed. Either way, nobody gets
  nagged with it again just for choosing not to read it once.
- **Always revisitable.** "Take the tour" in the account menu (next to
  Team/Task Templates/Settings) links to `/welcome` any time, regardless
  of whether `onboarding_completed_at` is already set — reopening it
  doesn't clear or touch that column, so it never re-triggers the forced
  redirect for someone who already finished it.
- **Existing accounts were backfilled as already-onboarded.** The
  migration only sets `onboarding_completed_at` for rows that existed
  *before* the column was added (a one-time backfill gated inside a `do`
  block keyed on the column not existing yet, not a plain `where ...
  is null` that would re-run every time) — so deploying this doesn't
  suddenly force everyone already using Pipeline through a first-time
  flow, while genuinely new signups after that point still correctly get
  `null` and see the real walkthrough.

## How Google sign-in works

- **A login option, not a separate integration of Pipeline's own** — the
  "Log in / Sign up with Google" button on `AuthPage` calls Supabase
  Auth's own `signInWithOAuth({ provider: 'google' })` directly from the
  browser. Unlike Google Calendar sync (its own OAuth client, its own
  server-side code in `api/google-calendar.js`, credentials in Vercel env
  vars), this one has **no code on our side handling tokens at all** —
  Supabase holds the Google Client ID/Secret itself (set once in its own
  dashboard, see `SETUP.md` section 11) and does the whole exchange
  before handing the browser back a normal session, same shape as any
  other sign-in. Worth not confusing the two if you're ever looking at
  Google Cloud Console — they're deliberately separate OAuth clients so
  editing one can't break the other.
- **The same button does both login and signup.** There's no separate
  "Sign up with Google" flow to build — a Google account Pipeline has
  never seen creates a new account the moment someone clicks through,
  firing the exact same `handle_new_user`/`handle_new_user_org` triggers
  as an ordinary email+password signup (new profile row, new personal
  workspace, first visit lands on `/welcome` per "How onboarding works"
  above). Nothing about those triggers changes for this — Google's
  metadata just happens to include `full_name`, which the existing
  profile trigger already reads.
- **A returning person's existing account, not a duplicate, when the
  email matches — confirmed working, not just documented.** If someone
  already has a Pipeline account under a password and later uses "Log in
  with Google" with a Google account sharing that same (confirmed) email,
  Supabase's own automatic account linking signs them into the *same*
  `auth.users` row rather than creating a second one — so someone doesn't
  end up managing two disconnected accounts, two separate sets of
  workspaces, just because they logged in a different way one day. This
  depends on Supabase project-wide **"Enable manual linking"** staying
  off (its default) — turning that on disables the automatic behavior.
- **Everything downstream treats it identically to a password session.**
  MFA gating (`needsMfaChallenge`), the onboarding gate
  (`needsOnboarding`), org membership, RLS — none of it branches on how
  the current session was established. A Google-signed-in account that
  later enrolls in 2FA gets challenged on its next Google sign-in exactly
  like a password account would.

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

## How backups work

- **Every real data table, once a day, to a private Storage bucket.**
  `api/backup-export.js` runs on a daily cron, discovers every table
  automatically via `list_public_tables()` (a small SQL helper — no
  hardcoded table list to keep in sync as the schema evolves), and writes
  one JSON file per day to a `backups` bucket that has zero client-side
  access (no RLS policies at all — same access model as
  `google_calendar_connections`). The last 14 days are kept; anything
  older is pruned automatically on the same run.
- **This is an export, not a restore button.** There is no
  `api/backup-restore.js` — writing back into a live multi-tenant database
  safely is a meaningfully bigger, riskier piece of work than making sure
  the data exists somewhere, which is what this actually closes. If the
  worst genuinely happens, restoring is a manual process, now documented
  step by step with a stated RPO/RTO in `supabase/RESTORE_PROCEDURE.md`,
  with `scripts/restore-backup.js` to actually run it (download the file
  from Supabase → Storage → `backups`, then re-insert each table's rows
  in dependency order — the script does the ordering and the inserting;
  you handle the credential-reconnect steps after, see that file). That
  procedure is documented and scripted but not yet live-tested end to
  end — see the status note at the top of it.
- **Four tables have their live credential columns stripped before
  export, on purpose:** `google_calendar_connections` (its OAuth
  `refresh_token`/`access_token`), `wise_reconciliation_connections` (its
  `api_token`), `stripe_connections` (its `secret_key`/`webhook_secret`),
  and `mfa_backup_codes` (`salt`/`code_hash`). Everything else about
  those rows — who was connected, when, whether Wise's eligibility check
  passed — is kept, since that's useful context for whoever's doing a
  manual restore. Only the actual secrets are dropped. The trade-off:
  restoring from a backup means reconnecting Google Calendar/Wise/Stripe
  and regenerating MFA backup codes afterward, a small one-time
  inconvenience against not having live credentials sitting in an export
  file, which is a meaningfully easier thing to over-expose than the
  production database itself.
- **`rate_limit_events` is skipped entirely** — purely operational,
  zero disaster-recovery value, and it would otherwise be the
  fastest-growing table in every export.
- Vercel's Hobby cron cap (once daily) applies here too — same constraint
  as the digest and both integrations' pull crons.

## How CI works

- **`.github/workflows/ci.yml` runs build + lint on every push and PR to
  `main`.** Before this, build/lint were only ever run by hand before a
  delivery — this makes a broken build visible immediately as a red X on
  the commit, instead of only surfacing once Vercel's own deploy fails.
- **Node version is pinned to 24, deliberately matching Vercel's own
  function runtime** (confirmed via a `DEP0169` deprecation warning that
  showed up in production logs once real error logging was added), so
  this check reflects the actual deploy environment rather than whatever
  happens to be installed locally.
- **This doesn't block merges by itself.** There's no branch protection
  rule requiring this check to pass — that's a GitHub repository setting,
  not something a workflow file can turn on, and it's deliberately tracked
  as a before-licensing step rather than done now, since branch protection
  matters a lot more once more than one person can push to `main`.
- **No secrets, no Supabase connection, no new setup step.** It only
  builds and lints the code as committed — it doesn't run the app, doesn't
  touch the database, and needs nothing added to Vercel or Supabase. Push,
  and it runs.

## How the service worker works

- **`public/sw.js` is what makes the app installable (PWA) and lets it
  keep working offline once something's been loaded once.** It splits
  requests into two handling paths: page navigations (loading `/`,
  `/admin`, any route) always go to the network first, only falling back
  to a cached copy of the app shell if the network is genuinely
  unreachable; everything else (hashed JS/CSS/image files under
  `/assets/`) is cache-first, revalidated in the background. Supabase API
  calls are never touched by the service worker at all — those always
  hit the network directly.
- **Why navigations are network-first and assets are cache-first, not the
  same strategy for both:** a Vite build fingerprints every JS/CSS
  filename by its content, so a cached asset is never stale under a URL
  that's still actually referenced — safe to serve instantly from cache.
  `index.html` (what a navigation actually loads) has no such
  fingerprint; serving a cached copy of it after a redeploy can hand the
  browser a shell that still points at old chunk filenames the new
  deploy already removed, which is exactly what caused the app to load
  blank until a second reload — the first reload was serving that stale
  cached shell while quietly re-fetching the real one in the background,
  so only the *second* reload actually got the fixed version.
- **The service worker's own file is stamped with a unique cache version
  on every build** (`scripts/stamp-sw.js`, wired into `npm run build`
  right after `vite build`). This closes a second, sneakier version of
  the same problem: `public/sw.js` is a static file Vite copies verbatim
  rather than fingerprinting, so its bytes were previously identical
  build after build even as the app underneath it changed — and a
  browser only re-installs a service worker when it detects the worker's
  *own* bytes changed, so an unchanged `sw.js` meant an already-visited
  browser could keep running an old worker (with old caching logic and
  old cached content) indefinitely, surviving redeploy after redeploy.
  Stamping a fresh `CACHE_NAME` into `dist/sw.js` at the end of every
  build guarantees there's always a real byte difference to detect.
- **A browser that visited the site before this fix shipped won't
  self-correct from bytes alone** — its already-installed old worker (old
  fetch logic, no version stamping) has no way to know a fix exists.
  DevTools → Application → Storage → **Clear site data**, then
  hard-reload, clears it out; this is a one-time thing per browser, not
  an ongoing workaround.

## How security headers work

- **`vercel.json` now sends four security headers on every response:**
  `X-Frame-Options: SAMEORIGIN` (blocks the app being framed by another
  site — defends against clickjacking), `X-Content-Type-Options: nosniff`
  (stops the browser from guessing content types), `Referrer-Policy:
  strict-origin-when-cross-origin`, and a `Permissions-Policy` that
  explicitly disables camera/microphone/geolocation (confirmed unused
  anywhere in the codebase before locking them off).
- **Content-Security-Policy shipped as a follow-up, after actually
  tracing every external dependency in the codebase** rather than
  guessing at directives:
  - `script-src 'self'` — no `'unsafe-inline'` needed. The theme
    flash-prevention script that used to live inline in `index.html` was
    moved to `public/theme-init.js` (a real file, loaded via `<script
    src>`) specifically so this could stay strict.
  - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` —
    `'unsafe-inline'` is a deliberate, scoped exception for the inline
    `style={{}}` attributes used throughout the component library
    (Scrubber, TallyDot, per-page theming). Rewriting all of that to
    avoid inline styles was out of scope for a header change; style
    injection alone is a much smaller attack surface than script
    injection, which stays fully locked down.
  - `font-src 'self' https://fonts.gstatic.com` and the
    `fonts.googleapis.com` entry above cover the Google Fonts
    stylesheet link — nothing else loads external fonts.
  - `img-src 'self' data:` — the only non-local image is the MFA QR
    code, which Supabase's own enroll API returns as a `data:` URI.
  - `connect-src 'self' https://*.supabase.co wss://*.supabase.co` —
    covers Supabase's REST API, Storage, and the Realtime websocket
    (activity log, notification bell). Wildcarded to `*.supabase.co`
    rather than the specific project ref so this doesn't need editing
    if the project ever moves (e.g. a future staging environment).
  - **Google's OAuth screen and the Wise payment link both needed
    nothing added.** Both are plain top-level navigations
    (`window.location.href` / `<a href target="_blank">`), which CSP's
    `connect-src`/`frame-src` don't govern — only real Supabase traffic
    goes through `fetch`/WebSocket from the browser.
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
    `frame-ancestors 'self'` — zero-risk defaults with nothing in the
    app that needs them relaxed.
  - **Verify after deploying**: log in, connect/sync Google Calendar,
    upload a file attachment, and watch the activity log update live —
    a CSP violation shows up as a browser console error immediately, it
    won't fail the build.
- **No schema change, no new setup step, no Vercel dashboard change.**
  This is pure `vercel.json` config — it takes effect on the next deploy
  with nothing else to configure.
- **Verify after deploying** with a fresh scan at
  `https://securityheaders.com/?q=https://pipeline-app-blond.vercel.app/`
  — the four should now show green; CSP will still show missing until
  that follow-up pass.
- **An OWASP ZAP scan against the live URL found three real, remaining
  gaps — one fixed, two documented as accepted trade-offs:**
  - **Fixed: a dev-facing comment in `theme-init.js` tripped ZAP's
    "suspicious comment" scanner.** Nothing sensitive was in it, but
    `public/` files ship to `dist/` byte-for-byte with none of the
    comment-stripping Vite gives every bundled `src/` file — so the
    build now runs `scripts/strip-comments.js` after `stamp-sw.js`,
    stripping `theme-init.js`'s comments from the shipped copy while
    keeping them in the source-controlled version for whoever reads the
    code next.
  - **Accepted: `style-src 'unsafe-inline'`, same trade-off as above,**
    now confirmed by a real scanner rather than just reasoned through —
    ZAP flags it Medium risk. The actual fix (rewriting every `style={{}}`
    attribute across the component library to Tailwind classes/CSS
    custom properties) is a real, much bigger refactor than a header
    change, tracked but not attempted here.
  - **Accepted: the Google Fonts `<link>` has no `integrity` attribute**
    (ZAP flags this Medium too). Google's font CSS API deliberately
    returns different `@font-face` rules depending on the requesting
    browser's `User-Agent` (different formats/subsets per browser), which
    is exactly what makes a fixed SRI hash unreliable for it — Google's
    own guidance is not to add one. The real fix is self-hosting the
    three font files instead of loading them from Google's CDN (which
    also removes the `fonts.googleapis.com`/`fonts.gstatic.com` CSP
    exceptions entirely) — not done here because it needs to be checked
    visually before shipping and this pass didn't have a way to do that
    safely; a real candidate for a follow-up session.
  - **Investigated, not a real gap: `Access-Control-Allow-Origin: *` on
    static assets** (ZAP calls this a Medium "Cross-Domain
    Misconfiguration"). Confirmed neither `vercel.json` nor any
    `api/*.js` file sets this header — it's Vercel's own default for
    static file hosting, present only on public, non-sensitive files
    (the HTML shell, `theme-init.js`) that contain nothing user-specific
    to begin with. The actual API (`/api/*.js`, where real data lives)
    sets no CORS header at all, so browsers still enforce the same-origin
    policy against it normally.
  - The remaining ZAP findings (Modern Web Application, Re-examine
    Cache-control Directives, Retrieved from Cache) are Informational
    and apply to the same public, non-sensitive static files — reviewed,
    no action needed.

## How error messages work

- **A shared `friendlyError()` helper (`src/lib/errorMessages.js`) maps
  raw Postgres/PostgREST errors to plain-language text**, applied at
  ~48 call sites across 18 pages — every form and detail page in the
  app that previously showed a raw database error (`duplicate key value
  violates unique constraint "clients_org_name_unique_idx"`, etc.)
  directly to the user now shows something readable instead.
- **Deliberately scoped to genuine database errors only.** Supabase
  Auth errors (sign up, sign in, MFA enroll/verify/disable, password
  reset) and this app's own `api/*.js` error messages (Google Calendar,
  Wise, MFA recovery) already come back with curated, user-appropriate
  text and are never passed through this helper — wrapping them would
  make things worse, not better. The function itself passes through
  anything without a Postgres-style `.code` unchanged, as a safety net.
- **Named constraints get specific text** (e.g. "An invoice must be
  linked to exactly one project or task"); everything else falls back
  to a per-error-code message (unique violation, missing required
  field, permission denied, etc.), and anything unrecognized falls back
  to a fully generic message rather than ever showing raw SQL.
- **One deliberate exception**: errors from this app's own
  security-definer functions (the ticket-submission and share-view rate
  limits, which `raise exception` with a message written for end users
  already) pass through unchanged rather than getting genericized —
  these use Postgres's default `P0001` code for a plain `raise
  exception`, which the helper specifically recognizes and leaves alone.

## How the admin dashboard works

- **`/admin` is a platform-wide view across every organization — visible
  to exactly one person (you), not org owners.** This is structurally
  different from everything else in the app: every other page is scoped
  to `activeOrgId` and enforced by RLS (`is_org_member`/`is_org_admin`).
  This page deliberately reads and writes across every org at once via
  the service-role client, so it can't lean on RLS at all — the gate is
  a single check in `api/admin.js` (`requirePlatformAdmin`): the caller's
  Supabase-verified email compared against a server-only
  `PLATFORM_ADMIN_EMAIL` env var.
- **Two separate env vars, same email address, on purpose:**
  `VITE_PLATFORM_ADMIN_EMAIL` (client-side, only controls whether the
  "Admin" link shows up in the name menu) and `PLATFORM_ADMIN_EMAIL`
  (server-only, the actual authorization check). Setting only one is an
  easy mistake — see `.env.example` and the Google Calendar setup history
  further up for what that class of bug looks like. Neither hiding the
  nav link nor the `/admin` route itself is a real security boundary —
  every API call the page makes is independently re-checked server-side.
- **Four tabs:**
  - **Overview** — platform-wide totals (orgs, users, projects, tasks,
    invoices, tickets) plus a per-org breakdown table.
  - **Organizations** — every org's roster, expandable. Role changes and
    member removal reuse the exact "can't touch the last owner" safeguard
    Team.jsx already enforces for in-org changes — re-checked server-side
    here too, since this endpoint can act on an org you aren't even a
    member of. **Inviting new people is intentionally not here** — that
    still happens from each org's own Team page (switch active org via
    the workspace selector, same as any admin would).
  - **Usage** — per-org attachment storage and invoice totals by
    currency, as an activity proxy. **This is not a billing dashboard.**
    Pipeline has no subscription/billing system of its own yet — Wise is
    for each org's own client invoicing, not for charging orgs to use
    Pipeline. Real billing would need a payment processor decision
    (Stripe or similar) as its own separate feature.
  - **System health** — whether Google Calendar/email-digest/`CRON_SECRET`
    are configured, the latest backup export's age, Google
    Calendar/Wise connection counts, and a **recent server errors** list.
    That last one is genuinely lightweight, not a real tracker: server
    errors get a best-effort insert into a new `error_log` table
    (`schema_error_log.sql`, optional) alongside the existing
    `console.error`/Vercel-logs path — no alerting, no stack traces, and
    writes aren't awaited (so a handful right at function termination
    could theoretically be lost; Vercel's own logs remain the complete
    record either way). A real tracker (Sentry or similar) is still the
    "before licensing" item this doesn't replace.
- **One new serverless function** (`api/admin.js`), consolidated the same
  way as the other integrations (dispatched by `action`) to stay well
  under Vercel Hobby's 12-function cap.



- Browser push notifications when the app is closed entirely (the bell only shows what's already installed and open — a native push notification, even with the app closed, would need VAPID keys and push subscription storage, a bigger addition than fit this pass)
- A general "browse all tasks" page. My Tasks only shows what's assigned to *you* specifically — a standalone task assigned to someone else (or not assigned to anyone yet) has no page that lists it for everyone to find, the way a project's own task list works for project-linked tasks. Worth building if standalone tasks get used a lot.
- Email validation (signup and invite) confirms a domain can receive mail, not that one specific mailbox exists — a made-up local part on a real domain (`asdf1234@gmail.com`) still gets through. Closing that gap needs a paid verification API (Kickbox/ZeroBounce/AbstractAPI); see "How email validation works."
