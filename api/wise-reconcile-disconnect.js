// Deletes the org's Wise API token. Doesn't touch wise_transactions —
// the historical record of what was already matched stays intact, only
// the ability to pull new ones goes away. Wise personal tokens don't
// have a documented revoke-via-API endpoint the way Google's OAuth
// tokens do, so unlike Google disconnect this is local-only; if someone
// wants the token itself invalidated on Wise's side too, that's done
// from the Wise dashboard directly.
import { requireCaller, requireOrgAdmin } from './_authHelpers.js'

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
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  const { error: deleteError } = await admin.from('wise_reconciliation_connections').delete().eq('org_id', orgId)
  if (deleteError) {
    res.status(500).json({ error: deleteError.message })
    return
  }

  res.status(200).json({ disconnected: true })
}
