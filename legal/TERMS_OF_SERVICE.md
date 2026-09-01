# Pipeline — Terms of Service (Draft)

**This is a starting draft, not a finished legal document.** Same caveat
as `PRIVACY_POLICY.md` in this folder: not lawyer-reviewed, not currently
linked from the app, and not something to publish or rely on as-is.
Fill in every `[bracketed]` field, get a real legal review — especially
around liability limitation, which varies significantly by
jurisdiction and by what you're actually promising clients — and wire it
into the signup flow before treating this as real.

Tracked as a "before licensing" item in
`Pipeline — 13-Layer Architecture Status.md`.

---

**Effective date:** [date this is actually published]

## 1. Agreement

By creating a Pipeline account or using a Pipeline workspace, you agree
to these terms. If you're using Pipeline on behalf of an organization,
you're agreeing on that organization's behalf and confirming you have
authority to do so.

## 2. The Service

Pipeline is a project management tool covering projects and tasks,
invoicing, a calendar, support ticketing, and reporting, with each
organization's workspace isolated from every other. [Add your actual
pricing/plan terms here once there's a real pricing model — this draft
assumes free/pre-revenue use and says nothing about billing.]

## 3. Accounts and workspaces

You're responsible for keeping your login credentials secure, including
any 2FA backup codes you generate — codes we cannot recover once
generated (only regenerate, which invalidates the old set). You're
responsible for the accuracy of the data you and your teammates enter,
and for managing who has access to your workspace (invites, roles,
removal) — Pipeline enforces the permissions your admins set, but doesn't
police who an admin chooses to invite.

Anyone invited to your workspace and accepting that invite gets access to
that workspace's data per the role assigned. [If you want an
acceptable-use clause — restrictions on what content can be stored, e.g.
no illegal content, no data you don't have rights to store — add it
here.]

## 4. Payments (Stripe / Wise)

If you connect Stripe or Wise, payments your clients make flow directly
through that processor under that processor's own terms — Pipeline
facilitates generating a payment link/request and reconciling the result
against your invoices, but is not a party to the payment itself and
doesn't hold your clients' funds at any point.

[If you ever charge for Pipeline itself — subscription fees for the
product, not the invoicing feature — add real billing terms: what's
charged, refund policy, what happens to data on cancellation.]

## 5. Client-facing surfaces

Clients you invite via a share link or ticket-submission form aren't
Pipeline account holders and aren't bound by these terms merely by
submitting a form — you (the workspace) are responsible for how you use
that data and for your own relationship with your client, separate from
your relationship with Pipeline.

## 6. Data ownership and export

You own the data you put into your workspace. [Add your actual export
process here — the app doesn't currently have a bulk "export everything"
button; if you're representing that clients can get their data on
request, either build that or describe the manual process honestly.] If
your account is closed, [state your actual retention/deletion timeline
after closure].

## 7. Service availability

Pipeline runs on Vercel and Supabase's infrastructure and inherits their
uptime characteristics. [This draft intentionally does not promise an
uptime SLA — don't add one until you're ready to actually back it,
especially on free-tier infrastructure with no load balancing or
multi-region failover, which the architecture status doc tracks
honestly as "not applicable yet" at current scale.] Scheduled
maintenance, third-party outages (Vercel, Supabase, Stripe, Google, Wise,
Resend), and factors outside our control can affect availability.

## 8. Limitation of liability

[This is the section most in need of an actual lawyer before publishing
— liability limitations that hold up vary by jurisdiction, and getting
this wrong either leaves you exposed or makes the terms unenforceable.
A typical structure: Pipeline is provided "as is," disclaiming implied
warranties, with liability capped at fees paid in the preceding 12
months (or a stated amount if the Service is free) — but don't ship that
language without a lawyer confirming it's appropriate for where you and
your users are located.]

## 9. Termination

You can stop using Pipeline and close your account at any time. We may
suspend or terminate access for a workspace that violates these terms
[or, once you have a real acceptable-use policy, that clause]. [Add
notice requirements if you want to commit to any — e.g. "30 days' notice
except for violations."]

## 10. Changes to these terms

[Describe how you'll notify users of material changes before this goes
live — e.g., email plus an in-app notice, with a reasonable notice
period before changes take effect.]

## 11. Governing law

[State the jurisdiction whose law governs these terms — this needs to
match wherever you're actually operating from/incorporated, which a
lawyer should confirm.]

## 12. Contact

[Your contact email/address for questions about these terms.]
