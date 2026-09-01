// Client-facing overdue-invoice reminders. Two entry points in one file
// (function #10/12 — see the Vercel Hobby 12-function note in README):
//
//   GET  (Vercel Cron, authenticated via CRON_SECRET like every other
//        cron file here) — the automatic path. Only processes workspaces
//        that opted in via organizations.auto_invoice_reminders (off by
//        default). Sends the first reminder as soon as an invoice goes
//        overdue, then repeats weekly until it's paid.
//   POST (an authenticated org member, from InvoiceDetail.jsx's "Send
//        reminder" button) — the manual path. Sends immediately for one
//        specific invoice regardless of the org's auto-reminder setting
//        or the weekly cadence, gated to admins (same level as the other
//        consequential actions on that page: status changes, editing).
//
// Both paths write invoices.last_reminder_sent_at, so a manual send also
// resets the automatic job's weekly clock instead of the two overlapping.
//
// SECURITY: the GET path uses the Supabase service-role key (bypasses
// RLS), same as api/daily-digest.js, and is gated purely by CRON_SECRET.
// The POST path uses the caller's own session token plus an explicit
// server-side org-admin check (api/_authHelpers.js) — it never trusts a
// client-supplied role or org_id claim.
import { createClient } from '@supabase/supabase-js'
import { logServerError, requireCaller, requireOrgAdmin, respondServerError } from './_authHelpers.js'
import { sendEmail, escapeHtml } from './_email.js'

const REMINDER_INTERVAL_DAYS = 7

export default async function handler(req, res) {
  if (req.method === 'GET') return handleCron(req, res)
  if (req.method === 'POST') return handleManualSend(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}

async function handleCron(req, res) {
  const authHeader = req.headers.authorization
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.DIGEST_FROM_EMAIL

  if (!supabaseUrl || !serviceRoleKey) {
    logServerError('invoice-reminders:config', new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars'))
    res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const summary = { orgsProcessed: 0, remindersSent: 0, errors: [] }

  const { data: orgs, error: orgsError } = await supabase
    .from('organizations')
    .select('id, name, wise_payment_link')
    .eq('auto_invoice_reminders', true)
  if (orgsError) {
    logServerError('invoice-reminders:list-orgs', orgsError)
    res.status(500).json({ error: orgsError.message })
    return
  }

  for (const org of orgs || []) {
    try {
      const { data: invoices, error: invoicesError } = await supabase
        .from('invoices')
        .select('id, invoice_number, client_name, client_email, currency, total_amount, due_date, stripe_payment_link, last_reminder_sent_at')
        .eq('org_id', org.id)
        .eq('status', 'sent')
        .lt('due_date', today)
        .not('client_email', 'is', null)
      if (invoicesError) throw invoicesError

      const due = (invoices || []).filter(
        (inv) => !inv.last_reminder_sent_at || inv.last_reminder_sent_at <= cutoff
      )

      for (const invoice of due) {
        const result = await sendEmail({
          apiKey: resendApiKey,
          from: fromAddress,
          to: invoice.client_email,
          subject: `Reminder: invoice ${invoice.invoice_number} is overdue`,
          html: reminderEmailHtml(org, invoice, today),
        })
        if (result.ok) {
          summary.remindersSent += 1
          await supabase.from('invoices').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', invoice.id)
        } else {
          logServerError(`invoice-reminders:send:${org.id}:${invoice.id}`, new Error(result.error))
          summary.errors.push(`${org.name} — ${invoice.invoice_number}: ${result.error}`)
        }
      }
      summary.orgsProcessed += 1
    } catch (err) {
      logServerError(`invoice-reminders:processOrg:${org.id}`, err)
      summary.errors.push(`${org.name}: ${err.message}`)
    }
  }

  res.status(200).json(summary)
}

async function handleManualSend(req, res) {
  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { orgId, invoiceId } = req.body || {}
  if (!orgId || !invoiceId) {
    res.status(400).json({ error: 'orgId and invoiceId are required' })
    return
  }

  const isAdmin = await requireOrgAdmin(admin, res, orgId, userId)
  if (!isAdmin) return

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .select('id, org_id, invoice_number, client_name, client_email, currency, total_amount, due_date, status, stripe_payment_link, last_reminder_sent_at')
    .eq('id', invoiceId)
    .single()
  if (invoiceError || !invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }
  // Belt-and-suspenders: the invoice must actually belong to the org the
  // caller was just verified as an admin of, not merely exist somewhere.
  if (invoice.org_id !== orgId) {
    res.status(403).json({ error: 'Invoice does not belong to this workspace' })
    return
  }
  if (!invoice.client_email) {
    res.status(400).json({ error: 'This invoice has no client email on file' })
    return
  }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('id, name, wise_payment_link')
    .eq('id', orgId)
    .single()
  if (orgError || !org) {
    respondServerError(res, 'invoice-reminders:manual:load-org', orgError || new Error('org not found'), 'Could not load workspace details.')
    return
  }

  const resendApiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.DIGEST_FROM_EMAIL
  if (!resendApiKey) {
    res.status(500).json({ error: 'Email sending is not configured on this deployment (missing RESEND_API_KEY).' })
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const result = await sendEmail({
    apiKey: resendApiKey,
    from: fromAddress,
    to: invoice.client_email,
    subject: `Reminder: invoice ${invoice.invoice_number} is overdue`,
    html: reminderEmailHtml(org, invoice, today),
  })

  if (!result.ok) {
    respondServerError(res, 'invoice-reminders:manual:send', new Error(result.error), `Couldn't send the reminder: ${result.error}`)
    return
  }

  const sentAt = new Date().toISOString()
  await admin.from('invoices').update({ last_reminder_sent_at: sentAt }).eq('id', invoiceId)

  res.status(200).json({ ok: true, sentAt })
}

function reminderEmailHtml(org, invoice, today) {
  const daysOverdue = invoice.due_date ? Math.max(1, Math.round((new Date(today) - new Date(invoice.due_date)) / 86400000)) : null
  const amount = `${invoice.currency} ${Number(invoice.total_amount).toFixed(2)}`
  const payLink = invoice.stripe_payment_link || org.wise_payment_link

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">Invoice ${escapeHtml(invoice.invoice_number)} is overdue</h2>
      <p style="color: #6b7078; font-size: 13px; margin-top: 0;">
        From ${escapeHtml(org.name)}${daysOverdue ? ` — ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past due` : ''}
      </p>
      <p style="font-size: 15px; margin-top: 20px;">Hi ${escapeHtml(invoice.client_name)},</p>
      <p style="font-size: 15px;">
        This is a reminder that invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> for
        <strong>${escapeHtml(amount)}</strong>${invoice.due_date ? ` (due ${escapeHtml(invoice.due_date)})` : ''}
        hasn't been marked as paid yet.
      </p>
      ${payLink ? `
        <p style="margin-top: 20px;">
          <a href="${escapeHtml(payLink)}" style="display: inline-block; background: #111; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px;">
            Pay now
          </a>
        </p>
      ` : ''}
      <p style="color: #6b7078; font-size: 13px; margin-top: 24px;">
        Reference invoice ${escapeHtml(invoice.invoice_number)} with your payment. If you've already paid, or have any
        questions, just reply to this email and let us know.
      </p>
    </div>
  `
}
