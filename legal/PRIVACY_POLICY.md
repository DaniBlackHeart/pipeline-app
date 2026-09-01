# Pipeline — Privacy Policy (Draft)

**This is a starting draft, not a finished legal document.** It was
written to accurately describe what Pipeline actually does today — the
real data it collects, the real third parties it shares data with, the
real retention periods — rather than generic boilerplate. It has **not**
been reviewed by a lawyer, is **not** currently linked from the app (no
footer link, no signup-flow acceptance checkbox), and should not be
published or relied on as-is. Before it goes live: have an actual lawyer
review it (laws like GDPR/CCPA impose specific requirements this draft
doesn't attempt to fully satisfy), fill in every `[bracketed]` field
below, and wire it into the app (a link in the footer/signup flow, at
minimum).

Tracked as a "before licensing" item in
`Pipeline — 13-Layer Architecture Status.md`.

---

**Effective date:** [date this is actually published]
**Last updated:** [date]

## Who this covers

This policy describes how Pipeline ("we," "us," the "Service") collects,
uses, and shares information when an organization ("you," a "workspace")
and its members use the app. If you're a client of a Pipeline workspace
(using the client ticket-submission form or a shared project link)
without an account, see "Client-facing surfaces" below — a narrower set
of rules applies to you.

## Information we collect

**Account information.** Name, email address, and password (stored
hashed by Supabase Auth, never in plain text) when you sign up. If you
sign in with Google instead, we receive your Google account's name,
email, and profile picture URL from Google — we don't receive your
Google password.

**Workspace content.** Everything you or your teammates put into your
workspace to use the product: projects, tasks, notes, invoices and their
line items, calendar events, support tickets and their comment threads,
uploaded file attachments, chat messages, and client contact information
you enter (name, email, billing address) for the clients you work with.

**Payment-related information.** If you connect Stripe or Wise for
invoice payments, we store the connection credentials (API keys) you
provide — see "Third parties we share data with" below for how those are
protected — and transaction metadata Stripe/Wise send us (amounts,
timestamps, a payment reference) so invoices can be marked paid
automatically. We do not receive or store your clients' card numbers or
bank details directly — that flows through Stripe/Wise, not through us.

**Google Calendar data**, only if you connect it: your calendar's event
titles, times, and descriptions, synced two-way with Pipeline's own
calendar events. We only read/write your primary calendar, and only for
the sync window Google's API supports (roughly 6 months back to 12
months forward).

**Technical and usage information.** IP address and timestamp for
login-lockout and rate-limiting purposes (kept only as long as needed to
enforce those limits, not as a general activity log); browser/device
information standard to any web app's server logs; and an activity log
of actions taken inside your workspace (who created/updated/completed
what, and when) visible to your teammates inside the product.

**Two-factor authentication data.** If you enable 2FA, we store a TOTP
secret and, if you generate backup codes, salted cryptographic hashes of
those codes (never the codes themselves — a lost code can't be recovered,
only regenerated).

## Client-facing surfaces

If you're not a Pipeline account holder but you've received a shared
project link or a client-ticket submission form from a workspace using
Pipeline: submitting the form sends your name, email, and message
content to that workspace. We don't build a profile of you across
different workspaces, and you can't log in — there's no account tied to
your submission. Rate limits apply to these surfaces (currently 60 views
per link per 10 minutes, 5 ticket submissions per project per 10
minutes) purely to prevent abuse, not to track you individually.

## How we use this information

To provide the Service: display your workspace's data back to you and
your teammates, send the invoices you create, sync your calendar, notify
you of activity via the in-app bell and the optional daily email digest,
and process payments through the processor you've connected.

To secure your account: enforce login lockouts after repeated failed
attempts, verify 2FA codes, detect and prevent abuse of public-facing
endpoints (ticket submission, share links).

We do not sell your data, and we do not use your workspace content to
train any model or for advertising of any kind.

## Third parties we share data with

Every one of these exists because a feature you specifically turned on
needs it — nothing here runs by default:

- **Supabase** (database, authentication, file storage) — hosts all of
  your workspace's data. [State your Supabase project's hosting region
  here, e.g. "us-east-1" — check your Supabase dashboard.]
- **Vercel** (hosting, serverless functions) — runs the app and its
  backend logic.
- **Resend** (transactional email) — sends the daily digest email, if
  you've enabled it.
- **Google** (OAuth sign-in, Calendar sync) — only if you choose to sign
  in with Google or connect Google Calendar.
- **Stripe** — only if you connect it for card payments. Stripe's own
  privacy policy governs data it processes directly (e.g., your clients'
  card details, which never reach our servers).
- **Wise** — only if you connect it for payment reconciliation. Same
  model as Stripe: Wise's own privacy policy governs what Wise processes
  directly.

Live third-party credentials you provide (Stripe secret keys, Wise API
tokens) are stored server-side, never exposed to the browser, and access
to the tables holding them is denied by default at the database level to
every account except our own service infrastructure. [Note: as of this
draft, these are stored as plain text in the database, protected by
database-level access rules rather than field-level encryption —
encrypting them at rest via Supabase Vault is a tracked before-licensing
item. Update this paragraph once that's done.]

We do not share your data with any other third party, and we do not sell
it.

## Data retention

Workspace content persists until you delete it or close your account. A
daily automated backup of the database is kept for 14 days on a rolling
basis (see `supabase/RESTORE_PROCEDURE.md` for what that backup does and
doesn't include — notably, it never includes your live third-party
credentials). Rate-limiting and login-lockout records are kept only long
enough to enforce those limits, typically well under 24 hours.

## Your rights and choices

You can update or delete most of your account and workspace data directly
in the app. [If you're publishing this for real: add the actual process
for a full account/data deletion request, and if GDPR/CCPA applies to
any of your users, add the specific rights those laws require you to
name explicitly — access, correction, deletion, portability, and how to
exercise each.]

## Children's privacy

Pipeline is a business tool, not directed at children, and we don't
knowingly collect information from anyone under 13 (or the relevant age
in your jurisdiction).

## Changes to this policy

[Describe how you'll notify users of material changes — e.g., email plus
an in-app notice — before this goes live.]

## Contact

[Your contact email/address for privacy questions.]
