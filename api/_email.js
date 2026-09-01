// Shared Resend send call, used by api/daily-digest.js and
// api/invoice-reminders.js. Leading underscore keeps Vercel from
// treating this as its own route (same convention as the other _*.js
// helpers in this folder).
//
// Returns { ok, error } instead of throwing -- a failed send for one
// recipient shouldn't take down a whole cron run processing many orgs/
// invoices in one pass. The caller decides whether a failure here is
// worth surfacing (a summary count, an error_log row, etc).
export async function sendEmail({ apiKey, from, to, subject, html }) {
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY is not configured' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || 'Pipeline <onboarding@resend.dev>',
        to,
        subject,
        html,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Resend responded ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
