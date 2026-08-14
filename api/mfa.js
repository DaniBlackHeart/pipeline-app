// All 2FA backup-code operations in one file, dispatched by method + an
// `action` field in the body. Consolidated from what were three separate
// files (status/generate/recover) — same reason as api/google-calendar.js
// and api/wise-reconcile.js: Vercel's Hobby plan caps a deployment at 12
// serverless functions total. Each handler below is functionally
// identical to its original standalone file; only the routing changed.
//
//   GET                          -> how many unused backup codes remain
//   POST { action: 'generate' }  -> generate a fresh set of 10 (invalidates any existing)
//   POST { action: 'recover',
//          code }                -> the actual recovery mechanism, see below
//
// Worth restating the recovery mechanism plainly, since it's the whole
// point of this file: a backup code can't act as a substitute for a real
// TOTP verification, because Supabase's own session model is the only
// thing that can promote a session to aal2 — nothing outside their
// auth.mfa.verify() can do that. So instead of pretending to "pass" the
// MFA challenge, a valid backup code removes the lost factor entirely
// (via the Admin API, which doesn't care what aal level the caller's own
// session is at), which makes the account stop requiring aal2 at all. A
// normal password login works again immediately afterward; re-enabling
// 2FA is a separate, deliberate step from Settings if they want it back
// on. The caller only needs to be *identified*, not already at aal2 —
// that's the whole point, this runs exactly when they can't reach aal2.
//
// Built against Supabase's documented Admin API conventions but not
// verified against a live call during development (same caveat as the
// Wise integration) -- if the admin user endpoint doesn't return a
// `factors` array in exactly this shape, or the delete-factor path is
// slightly different, this is the first place to look.
import { requireCaller } from './_authHelpers.js'
import { generateBackupCodes, normalizeCode, codeMatchesHash } from './_mfaBackupCodes.js'

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

// ---- status (GET) ----
async function handleStatus(req, res) {
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

// ---- generate (POST action=generate) ----
async function handleGenerate(req, res) {
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

// ---- recover (POST action=recover) ----
async function handleRecover(req, res) {
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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    await handleStatus(req, res)
    return
  }

  if (req.method === 'POST') {
    const action = req.body?.action
    if (action === 'generate') return handleGenerate(req, res)
    if (action === 'recover') return handleRecover(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
