// Pulls each connected org's Wise balance statement(s), records every
// transaction, and auto-marks an invoice paid when a transaction's
// reference contains that invoice's number AND the amount/currency match
// exactly. Anything less certain is recorded as 'unmatched' for an admin
// to confirm or ignore from the Invoices page.
//
// Two ways in, same as api/google-calendar-sync.js:
//   1. An admin hits "Reconcile now" — Authorization carries their own
//      session token, only their org's connection gets synced.
//   2. Vercel Cron calls this once a day (see vercel.json) — Authorization
//      carries CRON_SECRET, every org's connection gets synced in one pass.
import { createAdminClient, requireCaller, requireOrgAdmin } from './_authHelpers.js'
import { fetchWiseBalances, fetchWiseStatement, findMatchingInvoice } from './_wiseAuth.js'

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30

async function syncOneConnection(admin, connection) {
  const result = { pulled: 0, autoMatched: 0, unmatched: 0, error: null }

  if (connection.supported === false) {
    result.error = 'Skipped — this account is already known not to support balance-statement access.'
    return result
  }

  try {
    const sinceDate = connection.last_synced_at
      ? new Date(connection.last_synced_at).toISOString().slice(0, 10)
      : new Date(Date.now() - THIRTY_DAYS_MS).toISOString().slice(0, 10)

    const balances = await fetchWiseBalances(connection.api_token, connection.wise_profile_id)

    const { data: openInvoices } = await admin
      .from('invoices')
      .select('id, invoice_number, currency, total_amount')
      .eq('org_id', connection.org_id)
      .eq('status', 'sent')

    for (const balance of balances) {
      const transactions = await fetchWiseStatement(connection.api_token, connection.wise_profile_id, balance.id, sinceDate)

      for (const t of transactions) {
        if (t.type !== 'CREDIT') continue // only incoming money is relevant here

        const wiseTransactionId = String(t.referenceNumber || t.details?.transferId || `${balance.id}-${t.date}-${t.amount.value}`)

        const { data: existing } = await admin
          .from('wise_transactions')
          .select('id')
          .eq('org_id', connection.org_id)
          .eq('wise_transaction_id', wiseTransactionId)
          .maybeSingle()
        if (existing) continue // already recorded from a previous sync

        const match = findMatchingInvoice(t, openInvoices || [])

        const { error: insertError } = await admin.from('wise_transactions').insert({
          org_id: connection.org_id,
          wise_transaction_id: wiseTransactionId,
          amount: t.amount.value,
          currency: t.amount.currency,
          reference: t.details?.paymentReference || null,
          transaction_date: (t.date || new Date().toISOString()).slice(0, 10),
          matched_invoice_id: match?.id || null,
          match_confidence: match ? 'auto' : 'unmatched',
        })
        if (insertError) continue // don't let one bad row stop the rest

        result.pulled += 1
        if (match) {
          result.autoMatched += 1
          await admin.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', match.id)
          // Remove it from this pass's candidate list so a second
          // transaction in the same sync can't also claim it.
          const idx = (openInvoices || []).findIndex((inv) => inv.id === match.id)
          if (idx !== -1) openInvoices.splice(idx, 1)
        } else {
          result.unmatched += 1
        }
      }
    }

    await admin
      .from('wise_reconciliation_connections')
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq('id', connection.id)
  } catch (err) {
    const nowUnsupported = err.status === 403 || err.status === 401
    result.error = err.message
    await admin
      .from('wise_reconciliation_connections')
      .update({
        last_checked_at: new Date().toISOString(),
        last_error: nowUnsupported
          ? "This Wise account's country doesn't support balance-statement access via the API."
          : err.message,
        ...(nowUnsupported ? { supported: false } : {}),
      })
      .eq('id', connection.id)
  }
  return result
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || ''
  const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (isCron) {
    const admin = createAdminClient()
    const { data: connections, error } = await admin.from('wise_reconciliation_connections').select('*')
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    const summary = { connectionsProcessed: 0, errors: [] }
    for (const connection of connections || []) {
      const result = await syncOneConnection(admin, connection)
      summary.connectionsProcessed += 1
      if (result.error) summary.errors.push(`${connection.org_id}: ${result.error}`)
    }
    res.status(200).json(summary)
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { orgId } = req.body || {}
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  const { data: connection } = await admin
    .from('wise_reconciliation_connections')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()

  if (!connection) {
    res.status(400).json({ error: 'Not connected to Wise reconciliation yet' })
    return
  }

  const result = await syncOneConnection(admin, connection)
  res.status(200).json(result)
}
