// Returns whether the calling user has a Google Calendar connection for
// the given org, and non-sensitive display info about it. Never returns
// tokens — the frontend has no legitimate reason to see them, and
// google_calendar_connections has no RLS policies for `authenticated`
// precisely so nothing but this kind of narrow, server-controlled
// response ever leaves the table.
import { requireCaller } from './_authHelpers.js'

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

  const { data: connection, error } = await admin
    .from('google_calendar_connections')
    .select('google_email, last_synced_at, created_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(200).json({
    connected: Boolean(connection),
    email: connection?.google_email || null,
    lastSyncedAt: connection?.last_synced_at || null,
    connectedAt: connection?.created_at || null,
  })
}
