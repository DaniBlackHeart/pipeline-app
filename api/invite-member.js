// Called from the Team page when an admin invites someone by email.
//
// Two paths, decided server-side:
//   1. Email already belongs to a Pipeline user -> just add them to this
//      workspace's org_members (no email sent by us; they'll see the new
//      workspace next time they log in).
//   2. Email has no account yet -> use Supabase's admin API to create the
//      account and send Supabase's built-in "Invite user" email (a magic
//      link to set a password), then add them to org_members once created.
//
// SECURITY: uses the Supabase *service role* (or newer "secret") key, which
// bypasses every RLS policy. It must only ever run here, server-side. Unlike
// the daily-digest function (which trusts a static CRON_SECRET because
// Vercel Cron calls it on a timer with no user attached), this endpoint is
// triggered by a specific logged-in person — so instead of a static secret,
// it verifies *that person's own* Supabase session token and independently
// checks, in this function, that they're actually an admin/owner of the
// workspace they're trying to invite someone into. A member could not call
// this endpoint successfully even if they discovered the URL, because the
// admin check happens here regardless of what the client claims.
import { createClient } from '@supabase/supabase-js'
import { logServerError, respondServerError } from './_authHelpers.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    logServerError('invite-member:config', new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars'))
    res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const callerToken = authHeader.replace(/^Bearer /, '')
  if (!callerToken) {
    res.status(401).json({ error: 'Missing caller session token' })
    return
  }

  const { orgId, email, role } = req.body || {}
  if (!orgId || !email || !role) {
    res.status(400).json({ error: 'orgId, email, and role are all required' })
    return
  }
  if (!['admin', 'member'].includes(role)) {
    res.status(400).json({ error: 'role must be "admin" or "member"' })
    return
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Identify the caller from their own token, then independently verify
  // they're actually an admin/owner of orgId — never trust the client's
  // say-so about their own permissions.
  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken)
  if (callerError || !callerData?.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  const { data: membership, error: membershipError } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', callerData.user.id)
    .maybeSingle()

  if (membershipError) {
    respondServerError(res, 'invite-member:check-membership', membershipError, "Couldn't verify your permissions. Please try again.")
    return
  }
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    res.status(403).json({ error: 'Only workspace owners/admins can invite teammates' })
    return
  }

  const normalizedEmail = String(email).trim().toLowerCase()

  try {
    // Path 1: email already has a Pipeline account somewhere.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, full_name')
      .ilike('email', normalizedEmail)
      .maybeSingle()

    if (existingProfile) {
      const { error: upsertError } = await admin
        .from('org_members')
        .upsert({ org_id: orgId, user_id: existingProfile.id, role }, { onConflict: 'org_id,user_id' })

      if (upsertError) {
        respondServerError(res, 'invite-member:add-existing', upsertError, "Couldn't add that person to the workspace. Please try again.")
        return
      }

      res.status(200).json({ status: 'added_existing', email: normalizedEmail, name: existingProfile.full_name })
      return
    }

    // Path 2: no account yet — create one and send Supabase's invite email.
    // Passing `data` here sets this account's user_metadata (raw_user_meta_data)
    // at creation time — a flag we set explicitly and fully control, unlike
    // auth.users.invited_at, which turned out not to be reliably set by
    // inviteUserByEmail on current Supabase versions (confirmed the hard way:
    // a real invited teammate still ended up with a stray personal workspace
    // because the trigger's old invited_at-only check never fired true). The
    // workspace-creation trigger checks this flag now — see
    // schema_fix_invite_workspace_signal.sql.
    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${siteUrl}/login`,
      data: { pipeline_invited: true },
    })

    if (inviteError || !inviteData?.user) {
      if (inviteError) logServerError('invite-member:invite-new', inviteError)
      res.status(500).json({ error: inviteError?.message || 'Invite failed for an unknown reason' })
      return
    }

    // The profile-creation trigger fires automatically on this insert into
    // auth.users, same as a normal signup — but the workspace-creation half
    // of that trigger now skips itself for this account, because of the
    // pipeline_invited flag set above. We add them to *this* workspace below;
    // they get no separate personal one.
    const { error: memberInsertError } = await admin
      .from('org_members')
      .upsert({ org_id: orgId, user_id: inviteData.user.id, role }, { onConflict: 'org_id,user_id' })

    if (memberInsertError) {
      respondServerError(res, 'invite-member:add-new', memberInsertError, 'Account created, but adding them to the workspace failed. They may need to be added manually — check Team settings.')
      return
    }

    res.status(200).json({ status: 'invited_new', email: normalizedEmail })
  } catch (err) {
    respondServerError(res, 'invite-member:unexpected', err, 'Something went wrong sending the invite. Please try again.')
  }
}
