// Runs once a day via Vercel Cron (see vercel.json). Two jobs in one pass,
// since both need the same "walk every org" loop and the same service-role
// access:
//   1. Auto-generate any recurring invoices that are due today.
//   2. Email each member a digest of what needs attention — but only if
//      there's actually something to report, so quiet days send nothing.
//
// SECURITY: this file uses the Supabase *service role* key, which bypasses
// every RLS policy in the database. It must only ever run here, server-side,
// authenticated by CRON_SECRET — never in frontend code, never with the
// VITE_ prefix (which would bundle it into the client JS).
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const digestFromAddress = process.env.DIGEST_FROM_EMAIL

  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const today = new Date().toISOString().slice(0, 10)
  const summary = { orgsProcessed: 0, invoicesGenerated: 0, emailsSent: 0, errors: [] }

  const { data: orgs, error: orgsError } = await supabase.from('organizations').select('id, name')
  if (orgsError) {
    res.status(500).json({ error: orgsError.message })
    return
  }

  for (const org of orgs || []) {
    try {
      await processOrg(supabase, org, today, resendApiKey, digestFromAddress, summary)
      summary.orgsProcessed += 1
    } catch (err) {
      summary.errors.push(`${org.name}: ${err.message}`)
    }
  }

  res.status(200).json(summary)
}

async function processOrg(supabase, org, today, resendApiKey, digestFromAddress, summary) {
  // ---- 1. Auto-generate due recurring invoices ----
  const { data: dueTemplates } = await supabase
    .from('recurring_invoice_templates')
    .select('id, client_name, currency')
    .eq('org_id', org.id)
    .eq('active', true)
    .lte('next_run_date', today)

  const generatedThisRun = []
  for (const tmpl of dueTemplates || []) {
    const { data: newInvoiceId, error: genError } = await supabase.rpc('generate_invoice_from_template', {
      template_id_param: tmpl.id,
    })
    if (!genError && newInvoiceId) {
      generatedThisRun.push({ clientName: tmpl.client_name, currency: tmpl.currency })
      summary.invoicesGenerated += 1
    }
  }

  // ---- 2. Gather digest data for this org ----
  const [{ data: invoices }, { data: tasks }, { data: tickets }, { data: members }, { data: prefsRows }] = await Promise.all([
    supabase.from('invoices').select('invoice_number, client_name, total_amount, currency, due_date, status').eq('org_id', org.id).eq('status', 'sent'),
    supabase.from('tasks').select('title, due_date, status, project_id, projects(name)').eq('org_id', org.id).neq('status', 'done').not('due_date', 'is', null),
    supabase.from('tickets').select('id, status').eq('org_id', org.id).neq('status', 'resolved'),
    supabase.from('org_members').select('user_id'),
    supabase.from('notification_preferences').select('*').eq('org_id', org.id),
  ])

  const overdueInvoices = (invoices || []).filter((inv) => inv.due_date && inv.due_date < today)
  const dueTasks = (tasks || []).filter((t) => t.due_date <= today)
  const openTicketCount = (tickets || []).length

  const orgMemberIds = new Set((members || []).map((m) => m.user_id))
  const prefsByUser = new Map((prefsRows || []).filter((p) => orgMemberIds.has(p.user_id)).map((p) => [p.user_id, p]))

  // ---- 3. Send one digest email per member who wants one ----
  for (const [userId, prefs] of prefsByUser) {
    if (!prefs.email_enabled) continue

    const sections = []
    if (prefs.notify_overdue_invoices && overdueInvoices.length > 0) {
      sections.push({
        title: 'Overdue invoices',
        lines: overdueInvoices.map((inv) => `${inv.invoice_number} — ${inv.client_name} — ${inv.currency} ${Number(inv.total_amount).toFixed(2)}`),
      })
    }
    if (prefs.notify_tasks_due && dueTasks.length > 0) {
      sections.push({
        title: 'Tasks due today or overdue',
        lines: dueTasks.map((t) => `${t.title}${t.projects?.name ? ` (${t.projects.name})` : ''} — due ${t.due_date}`),
      })
    }
    if (prefs.notify_open_tickets && openTicketCount > 0) {
      sections.push({ title: 'Open tickets', lines: [`${openTicketCount} ticket${openTicketCount === 1 ? '' : 's'} still open or in progress`] })
    }
    if (prefs.notify_recurring_generated && generatedThisRun.length > 0) {
      sections.push({
        title: 'Recurring invoices generated today',
        lines: generatedThisRun.map((g) => `${g.clientName} — ${g.currency}`),
      })
    }

    if (sections.length === 0) continue // nothing to report — send nothing

    const { data: userData } = await supabase.auth.admin.getUserById(userId)
    const email = userData?.user?.email
    if (!email) continue

    if (resendApiKey) {
      await sendDigestEmail(resendApiKey, digestFromAddress, email, org.name, sections)
      summary.emailsSent += 1
    }
  }
}

async function sendDigestEmail(apiKey, fromAddress, toEmail, orgName, sections) {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">${orgName} — daily digest</h2>
      <p style="color: #6b7078; font-size: 13px; margin-top: 0;">${new Date().toLocaleDateString()}</p>
      ${sections.map((s) => `
        <div style="margin-top: 20px;">
          <p style="font-weight: 600; margin-bottom: 6px;">${s.title}</p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
            ${s.lines.map((line) => `<li style="margin-bottom: 4px;">${escapeHtml(line)}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
      <p style="color: #6b7078; font-size: 12px; margin-top: 28px;">
        Manage what's included in Settings → Email notifications.
      </p>
    </div>
  `

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress || 'Pipeline <onboarding@resend.dev>',
      to: toEmail,
      subject: `${orgName}: today's digest`,
      html,
    }),
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
