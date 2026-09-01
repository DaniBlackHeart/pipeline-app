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

export const getStripeStatus = (orgId) =>
  callFn(`/api/stripe?orgId=${encodeURIComponent(orgId)}`)

export const connectStripe = (orgId, secretKey, webhookSecret) =>
  callFn('/api/stripe', { method: 'POST', body: { action: 'connect', orgId, secretKey, webhookSecret } })

export const disconnectStripe = (orgId) =>
  callFn('/api/stripe', { method: 'POST', body: { action: 'disconnect', orgId } })

export const generateStripePaymentLink = (orgId, invoiceId) =>
  callFn('/api/stripe', { method: 'POST', body: { action: 'generate-link', orgId, invoiceId } })

// The URL to register as this org's webhook endpoint in their own Stripe
// Dashboard — the org id in the query string is what lets one shared
// endpoint serve every org's separate Stripe account (see api/stripe.js).
export const stripeWebhookUrl = (orgId) =>
  `${window.location.origin}/api/stripe?orgId=${orgId}`

// Direct Supabase queries — stripe_events has real RLS policies for
// admins (unlike the connections table), so these don't need a
// serverless round-trip.
export async function listUnmatchedStripeEvents(orgId) {
  const { data, error } = await supabase
    .from('stripe_events')
    .select('id, amount, currency, stripe_session_id, created_at')
    .eq('org_id', orgId)
    .eq('match_status', 'unmatched')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function confirmStripeEventMatch(eventId, invoiceId) {
  const { error } = await supabase
    .from('stripe_events')
    .update({ matched_invoice_id: invoiceId, match_status: 'manual' })
    .eq('id', eventId)
  if (error) throw error
  const { error: invoiceError } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (invoiceError) throw invoiceError
}

export async function ignoreStripeEvent(eventId) {
  const { error } = await supabase.from('stripe_events').update({ match_status: 'ignored' }).eq('id', eventId)
  if (error) throw error
}
