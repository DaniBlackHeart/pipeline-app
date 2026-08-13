// Returns the count of unused backup codes for the caller's own account —
// enough for Settings to show "8 backup codes remaining" without ever
// exposing the codes or their hashes.
import { requireCaller } from './_authHelpers.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { count, error } = await admin
    .from('mfa_backup_codes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('used_at', null)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(200).json({ remaining: count ?? 0 })
}
