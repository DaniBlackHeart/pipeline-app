import { supabase } from './supabase'

async function callFn(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method,
    headers: {
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// Sends an overdue-invoice reminder to the client immediately, regardless
// of the workspace's auto-reminder setting or the automatic job's weekly
// cadence -- both paths write invoices.last_reminder_sent_at, so this
// also resets that cadence rather than overlapping with it.
export const sendInvoiceReminder = (orgId, invoiceId) =>
  callFn('/api/invoice-reminders', { method: 'POST', body: { orgId, invoiceId } })
