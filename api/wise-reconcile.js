// All Wise reconciliation server-side operations in one file, dispatched
// by method + an `action` field in the body. Consolidated from what were
// four separate files (status/connect/disconnect/sync) — same reason as
// api/google-calendar.js: Vercel's Hobby plan caps a deployment at 12
// serverless functions total. Each handler below is functionally
// identical to its original standalone file; only the routing changed.
//
//   GET                                -> status
//   POST { action: 'connect', ... }    -> save + probe a Wise API token
//   POST { action: 'disconnect' }      -> remove the connection
//   POST { action: 'sync' }            -> reconcile the caller's own org
//   (any method) Authorization: Bearer CRON_SECRET -> reconcile every org (daily cron)
import { requireCaller, requireOrgMember, requireOrgAdmin, createAdminClient, logServerError, respondServerError } from './_authHelpers.js'
import { fetchWiseProfile, fetchWiseBalances, fetchWiseStatement, findMatchingInvoice } from './_wiseAuth.js'

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30

// ---- status (GET) ----
// Any org member can see the status (matches how invoices themselves are
// viewable by everyone) — only setup/actions are admin-only. Never
// returns the token itself.
async function handleStatus(req, res) {
  const orgId = req.query.orgId
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgMember(admin, res, orgId, userId))) return

  const { data: connection, error } = await admin
    .from('wise_reconciliation_connections')
    .select('supported, last_synced_at, last_checked_at, last_error, created_at')
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) {
    respondServerError(res, 'wise-reconcile:status', error, "Couldn't load Wise reconciliation status. Please try again.")
    return
  }

  res.status(200).json({
    connected: Boolean(connection),
    supported: connection?.supported ?? null,
    lastSyncedAt: connection?.last_synced_at || null,
    lastCheckedAt: connection?.last_checked_at || null,
    lastError: connection?.last_error || null,
    connectedAt: connection?.created_at || null,
  })
}

// ---- connect (POST action=connect) ----
// Admin pastes their Wise personal API token. Probes whether
// balance-statement access actually works for this specific account,
// since Wise restricts that to accounts based in the US, Canada,
// Australia, New Zealand, Singapore, or Malaysia.
async function handleConnect(req, res) {
  const { orgId, apiToken } = req.body || {}
  if (!orgId || !apiToken) {
    res.status(400).json({ error: 'orgId and apiToken are both required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  let profile
  try {
    profile = await fetchWiseProfile(apiToken)
  } catch (err) {
    logServerError('wise-reconcile:connect-verify-token', err)
    res.status(400).json({ error: `Couldn't verify that token with Wise: ${err.message}` })
    return
  }

  let supported = true
  let probeError = null
  try {
    const balances = await fetchWiseBalances(apiToken, profile.id)
    if (balances[0]) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      await fetchWiseStatement(apiToken, profile.id, balances[0].id, since)
    }
  } catch (err) {
    logServerError('wise-reconcile:connect-probe', err)
    if (err.status === 403 || err.status === 401) {
      supported = false
      probeError = "This Wise account's country doesn't support balance-statement access via the API (Wise restricts that to accounts based in the US, Canada, Australia, New Zealand, Singapore, or Malaysia). The token is valid and saved, but auto-reconciliation won't find any transactions until that changes on Wise's end."
    } else {
      probeError = `Connected, but the test check failed: ${err.message}`
    }
  }

  const { error: upsertError } = await admin.from('wise_reconciliation_connections').upsert(
    {
      org_id: orgId,
      api_token: apiToken,
      wise_profile_id: String(profile.id),
      supported,
      last_checked_at: new Date().toISOString(),
      last_error: probeError,
      connected_by: userId,
    },
    { onConflict: 'org_id' }
  )
  if (upsertError) {
    respondServerError(res, 'wise-reconcile:connect-save', upsertError, 'Token verified, but saving the connection failed. Please try again.')
    return
  }

  res.status(200).json({ connected: true, supported, error: probeError })
}

// ---- disconnect (POST action=disconnect) ----
async function handleDisconnect(req, res) {
  const { orgId } = req.body || {}
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  const { error: deleteError } = await admin.from('wise_reconciliation_connections').delete().eq('org_id', orgId)
  if (deleteError) {
    respondServerError(res, 'wise-reconcile:disconnect', deleteError, 'Failed to disconnect Wise. Please try again.')
    return
  }

  res.status(200).json({ disconnected: true })
}

// ---- sync core, shared by on-demand + cron ----
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
        if (t.type !== 'CREDIT') continue

        const wiseTransactionId = String(t.referenceNumber || t.details?.transferId || `${balance.id}-${t.date}-${t.amount.value}`)

        const { data: existing } = await admin
          .from('wise_transactions')
          .select('id')
          .eq('org_id', connection.org_id)
          .eq('wise_transaction_id', wiseTransactionId)
          .maybeSingle()
        if (existing) continue

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
        if (insertError) continue

        result.pulled += 1
        if (match) {
          result.autoMatched += 1
          await admin.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', match.id)
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
    logServerError(`wise-reconcile:sync:${connection.id}`, err)
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

// ---- sync (POST action=sync) — the caller's own org only ----
async function handleSync(req, res) {
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

// ---- cron: every org ----
async function handleCronSync(res) {
  const admin = createAdminClient()
  const { data: connections, error } = await admin.from('wise_reconciliation_connections').select('*')
  if (error) {
    logServerError('wise-reconcile:cron-list-connections', error)
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
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || ''
  const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (isCron) {
    await handleCronSync(res)
    return
  }

  if (req.method === 'GET') {
    await handleStatus(req, res)
    return
  }

  if (req.method === 'POST') {
    const action = req.body?.action
    if (action === 'connect') return handleConnect(req, res)
    if (action === 'disconnect') return handleDisconnect(req, res)
    if (action === 'sync') return handleSync(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
