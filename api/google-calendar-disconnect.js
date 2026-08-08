// Disconnects the calling user's own Google Calendar connection —
// revokes the token with Google (best-effort) and deletes the local row.
// Deleting the connection cascades to calendar_event_google_links, so
// this person's Pipeline<->Google mapping is fully cleared; the Pipeline
// events themselves are untouched.
import { requireCaller } from './_authHelpers.js'
import { revokeToken } from './_googleAuth.js'

export default async function handler(req, res) {
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

  const { data: connection } = await admin
    .from('google_calendar_connections')
    .select('id, refresh_token')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!connection) {
    res.status(200).json({ disconnected: true }) // already disconnected, nothing to do
    return
  }

  await revokeToken(connection.refresh_token)

  const { error: deleteError } = await admin.from('google_calendar_connections').delete().eq('id', connection.id)
  if (deleteError) {
    res.status(500).json({ error: deleteError.message })
    return
  }

  res.status(200).json({ disconnected: true })
}
