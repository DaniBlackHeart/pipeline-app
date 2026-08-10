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

export const getWiseReconcileStatus = (orgId) =>
  callFn(`/api/wise-reconcile-status?orgId=${encodeURIComponent(orgId)}`)

export const connectWiseReconcile = (orgId, apiToken) =>
  callFn('/api/wise-reconcile-connect', { method: 'POST', body: { orgId, apiToken } })

export const disconnectWiseReconcile = (orgId) =>
  callFn('/api/wise-reconcile-disconnect', { method: 'POST', body: { orgId } })

export const syncWiseReconcileNow = (orgId) =>
  callFn('/api/wise-reconcile-sync', { method: 'POST', body: { orgId } })

// Direct Supabase queries — wise_transactions has real RLS policies for
// admins (unlike the connections table), so these don't need a
// serverless round-trip.
export async function listUnmatchedWiseTransactions(orgId) {
  const { data, error } = await supabase
    .from('wise_transactions')
    .select('id, amount, currency, reference, transaction_date, created_at')
    .eq('org_id', orgId)
    .eq('match_confidence', 'unmatched')
    .order('transaction_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function confirmWiseTransactionMatch(transactionId, invoiceId) {
  const { error } = await supabase
    .from('wise_transactions')
    .update({ matched_invoice_id: invoiceId, match_confidence: 'manual' })
    .eq('id', transactionId)
  if (error) throw error
  const { error: invoiceError } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (invoiceError) throw invoiceError
}

export async function ignoreWiseTransaction(transactionId) {
  const { error } = await supabase.from('wise_transactions').update({ match_confidence: 'ignored' }).eq('id', transactionId)
  if (error) throw error
}
