// Generates 10 fresh backup codes for the caller's own account, deleting
// any existing ones first (regenerating always invalidates the old set —
// standard practice, so an old list that leaked or was misplaced can't
// still be used). Called automatically right after enrolling 2FA, and
// available again any time from Settings via "Generate new codes".
//
// The plaintext codes are returned exactly once in this response and
// never stored anywhere — only their salted hashes persist.
import { requireCaller } from './_authHelpers.js'
import { generateBackupCodes } from './_mfaBackupCodes.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { error: deleteError } = await admin.from('mfa_backup_codes').delete().eq('user_id', userId)
  if (deleteError) {
    res.status(500).json({ error: deleteError.message })
    return
  }

  const { plaintextCodes, rows } = generateBackupCodes()

  const { error: insertError } = await admin.from('mfa_backup_codes').insert(
    rows.map((r) => ({ user_id: userId, salt: r.salt, code_hash: r.code_hash }))
  )
  if (insertError) {
    res.status(500).json({ error: insertError.message })
    return
  }

  res.status(200).json({ codes: plaintextCodes })
}
