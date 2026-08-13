// This is the actual recovery mechanism, so it's worth restating the
// constraint from schema_mfa_backup_codes.sql plainly: a backup code
// can't act as a substitute for a real TOTP verification, because
// Supabase's own session model is the only thing that can promote a
// session to aal2 — nothing outside auth.mfa.verify() can do that. So
// instead of pretending to "pass" the MFA challenge, a valid backup code
// here removes the lost factor entirely (via the Admin API, which
// doesn't care what aal level the caller's own session is at), which
// makes the account stop requiring aal2 at all. A normal password login
// works again immediately afterward; re-enabling 2FA is a separate,
// deliberate step from Settings if they want it back on.
//
// The caller only needs to be *identified*, not already at aal2 — that's
// the whole point, this runs exactly when they can't reach aal2. A valid
// (any-level) session token is enough to know who's asking; the actual
// authorization to proceed comes from the backup code matching, not from
// the caller's current assurance level.
//
// Built against Supabase's documented Admin API conventions but not
// verified against a live call during development (same caveat as the
// Wise integration) -- if the admin user endpoint doesn't return a
// `factors` array in exactly this shape, or the delete-factor path is
// slightly different, this is the first place to look.
import { requireCaller } from './_authHelpers.js'
import { normalizeCode, codeMatchesHash } from './_mfaBackupCodes.js'

async function adminFetch(path, options = {}) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.msg || data?.message || `Supabase admin API error (${res.status})`)
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { code } = req.body || {}
  if (!code) {
    res.status(400).json({ error: 'A backup code is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { data: candidates, error: fetchError } = await admin
    .from('mfa_backup_codes')
    .select('id, salt, code_hash')
    .eq('user_id', userId)
    .is('used_at', null)

  if (fetchError) {
    res.status(500).json({ error: fetchError.message })
    return
  }

  const normalized = normalizeCode(code)
  const match = (candidates || []).find((c) => codeMatchesHash(normalized, c.salt, c.code_hash))

  if (!match) {
    // Deliberately generic — doesn't distinguish "wrong code" from
    // "already used" from "no codes exist at all", so this can't be used
    // to enumerate anything about the account.
    res.status(400).json({ error: 'Invalid or already-used backup code' })
    return
  }

  await admin.from('mfa_backup_codes').update({ used_at: new Date().toISOString() }).eq('id', match.id)

  try {
    const user = await adminFetch(`/auth/v1/admin/users/${userId}`)
    const totpFactors = (user.factors || []).filter((f) => f.factor_type === 'totp')
    for (const factor of totpFactors) {
      await adminFetch(`/auth/v1/admin/users/${userId}/factors/${factor.id}`, { method: 'DELETE' })
    }
  } catch (err) {
    res.status(500).json({ error: `Backup code accepted, but couldn't remove the old authenticator: ${err.message}. Contact whoever manages this Supabase project directly.` })
    return
  }

  // 2FA is off now — the remaining codes were for the factor that just
  // got removed, so they're moot. A fresh enroll from Settings later
  // generates a new set.
  await admin.from('mfa_backup_codes').delete().eq('user_id', userId)

  res.status(200).json({ recovered: true })
}
