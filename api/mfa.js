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
//   POST { action: 'admin-reset',
//          orgId, targetUserId } -> workspace admin/owner removes a locked-out
//                                   teammate's authenticator, see handleAdminReset below
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
import { requireCaller, requireOrgAdmin, logServerError, respondServerError } from './_authHelpers.js'
import { generateBackupCodes, normalizeCode, codeMatchesHash } from './_mfaBackupCodes.js'
import { checkRateLimit } from './_rateLimit.js'

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
    respondServerError(res, 'mfa:status', error, "Couldn't check your backup code status. Please try again.")
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
    respondServerError(res, 'mfa:generate-clear-old', deleteError, "Couldn't generate new backup codes. Please try again.")
    return
  }

  const { plaintextCodes, rows } = generateBackupCodes()

  const { error: insertError } = await admin.from('mfa_backup_codes').insert(
    rows.map((r) => ({ user_id: userId, salt: r.salt, code_hash: r.code_hash }))
  )
  if (insertError) {
    respondServerError(res, 'mfa:generate-insert', insertError, "Couldn't generate new backup codes. Please try again.")
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

  // Rate limit: scoped per user, since the caller is already identified at
  // this point (just not at aal2). Brute-forcing a code itself is
  // computationally infeasible (10 chars from a 31-char alphabet), so this
  // isn't guarding against that -- it's cheap defense-in-depth against a
  // compromised session hammering the endpoint, matching the same guard
  // already on invite-member and the Google OAuth exchange.
  const allowed = await checkRateLimit(admin, `mfa-recover:${userId}`, 5, 15 * 60)
  if (!allowed) {
    res.status(429).json({ error: 'Too many recovery attempts. Please wait a bit before trying again.' })
    return
  }

  const { data: candidates, error: fetchError } = await admin
    .from('mfa_backup_codes')
    .select('id, salt, code_hash')
    .eq('user_id', userId)
    .is('used_at', null)

  if (fetchError) {
    respondServerError(res, 'mfa:recover-fetch-codes', fetchError, "Couldn't verify that backup code. Please try again.")
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
    logServerError('mfa:recover-remove-factor', err)
    res.status(500).json({ error: "Backup code accepted, but the account couldn't be fully recovered automatically. Contact whoever manages this Supabase project directly." })
    return
  }

  // 2FA is off now — the remaining codes were for the factor that just
  // got removed, so they're moot. A fresh enroll from Settings later
  // generates a new set.
  await admin.from('mfa_backup_codes').delete().eq('user_id', userId)

  res.status(200).json({ recovered: true })
}

// ---- admin-reset (POST action=admin-reset) ----
// The other side of the same recovery story: handleRecover above is what
// the locked-out person themselves does with a saved backup code. This is
// for when they've lost those too -- a workspace owner/admin removes their
// authenticator from the Team page instead of the account being stuck
// until someone goes into the Supabase dashboard directly. Same underlying
// mechanism as recovery (delete the TOTP factor via the Admin API, clear
// any leftover backup codes), just triggered by an admin acting on someone
// else's account instead of the account holder using a code.
async function handleAdminReset(req, res) {
  const { orgId, targetUserId } = req.body || {}
  if (!orgId || !targetUserId) {
    res.status(400).json({ error: 'orgId and targetUserId are required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId: callerUserId } = caller

  if (targetUserId === callerUserId) {
    // Resetting your own 2FA has a real UI for it already (Settings ->
    // Disable, with its own confirm step) -- routing that through here
    // instead would just be a confusing second path to the same thing.
    res.status(400).json({ error: 'Use Settings to turn off your own two-factor authentication.' })
    return
  }

  const isCallerAdmin = await requireOrgAdmin(admin, res, orgId, callerUserId)
  if (!isCallerAdmin) return

  // The caller being an admin of orgId isn't enough on its own -- also
  // confirm the target is actually a member of that same workspace, so an
  // admin of one org can't reset 2FA for an arbitrary user id just because
  // they know it (e.g. picked up from another org they're also a member
  // of). Any role counts here, not just admin/owner -- this isn't a
  // privilege check on the target, just workspace scoping.
  const { data: targetMembership, error: targetMembershipError } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (targetMembershipError) {
    respondServerError(res, 'mfa:admin-reset-check-target', targetMembershipError, "Couldn't verify that person's workspace membership. Please try again.")
    return
  }
  if (!targetMembership) {
    res.status(404).json({ error: 'That person is not a member of this workspace.' })
    return
  }

  // Rate limit: scoped per workspace, not per admin -- multiple admins in
  // the same org share one budget, same reasoning as invite-member.js.
  // Tighter than invites (10 vs 20 per hour) since this is the more
  // sensitive action of the two -- it removes a security control from
  // someone else's account.
  const allowed = await checkRateLimit(admin, `mfa-admin-reset:${orgId}`, 10, 60 * 60)
  if (!allowed) {
    res.status(429).json({ error: 'Too many 2FA resets for this workspace recently. Please wait a bit before trying again.' })
    return
  }

  let totpFactors
  try {
    const user = await adminFetch(`/auth/v1/admin/users/${targetUserId}`)
    totpFactors = (user.factors || []).filter((f) => f.factor_type === 'totp')
  } catch (err) {
    respondServerError(res, 'mfa:admin-reset-fetch-user', err, "Couldn't look up that person's account. Please try again.")
    return
  }

  if (totpFactors.length === 0) {
    res.status(200).json({ reset: false, message: "That person doesn't have two-factor authentication enabled." })
    return
  }

  try {
    for (const factor of totpFactors) {
      await adminFetch(`/auth/v1/admin/users/${targetUserId}/factors/${factor.id}`, { method: 'DELETE' })
    }
  } catch (err) {
    respondServerError(res, 'mfa:admin-reset-remove-factor', err, "Couldn't remove that person's authenticator. Please try again.")
    return
  }

  // Moot now that the factor they protected is gone -- a fresh enroll
  // later (their own choice, from Settings) generates a new set.
  await admin.from('mfa_backup_codes').delete().eq('user_id', targetUserId)

  // Let them know, rather than their 2FA just silently disappearing next
  // time they look. Written directly by this service-role call (not a
  // trigger, like every other row in this table) since there's no
  // ordinary table write to hang one off -- the reset itself happened
  // through the Admin Auth API above, not a Postgres row change.
  const { data: callerProfile } = await admin.from('profiles').select('full_name').eq('id', callerUserId).maybeSingle()
  const actorName = callerProfile?.full_name || caller.email || 'A workspace admin'
  const { error: notifyError } = await admin.from('notifications').insert({
    org_id: orgId,
    user_id: targetUserId,
    actor_id: callerUserId,
    type: 'mfa_reset_by_admin',
    title: 'Two-factor authentication was reset',
    body: `${actorName} reset your two-factor authentication because you were locked out. Turn it back on from Settings whenever you're ready.`,
    link_path: '/settings',
  })
  // Best-effort -- the reset itself already succeeded and is the part
  // that actually matters; a failed notification insert shouldn't make
  // this look like it failed.
  if (notifyError) logServerError('mfa:admin-reset-notify', notifyError)

  res.status(200).json({ reset: true })
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
    if (action === 'admin-reset') return handleAdminReset(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
