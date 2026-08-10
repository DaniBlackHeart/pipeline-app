// Any org member can see the status (matches how invoices themselves are
// viewable by everyone) — only setup/actions are admin-only. Never
// returns the token itself; wise_reconciliation_connections has no RLS
// policies for `authenticated` at all, same reasoning as
// google_calendar_connections.
import { requireCaller, requireOrgMember } from './_authHelpers.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

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
    res.status(500).json({ error: error.message })
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
