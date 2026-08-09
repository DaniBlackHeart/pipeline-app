// Called once, right after Google redirects back to the app with a
// `code` — the frontend posts that code here (along with the redirect_uri
// it used, which must match exactly what was sent to Google's own
// authorization request) to complete the OAuth exchange.
//
// SECURITY: this is the only place GOOGLE_CLIENT_SECRET is ever used —
// it must stay server-side. The caller is identified from their own
// Supabase session token, same pattern as api/invite-member.js.
import { requireCaller } from './_authHelpers.js'
import { exchangeCodeForTokens } from './_googleAuth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!process.env.VITE_GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(500).json({ error: 'Google Calendar sync is not configured on this deployment yet (missing VITE_GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET).' })
    return
  }

  const { orgId, code, redirectUri } = req.body || {}
  if (!orgId || !code || !redirectUri) {
    res.status(400).json({ error: 'orgId, code, and redirectUri are all required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { data: membership } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this workspace' })
    return
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    if (!tokens.refresh_token) {
      // Happens if the user has already granted access before and Google
      // didn't re-issue a refresh token. The frontend always sends
      // prompt=consent on the authorization URL specifically to avoid
      // this, but guard anyway with a clear, actionable message.
      res.status(400).json({ error: "Google didn't return a refresh token. Try disconnecting in your Google Account's third-party access settings, then reconnect here." })
      return
    }

    // Fetch the connected account's email, for display purposes only.
    let googleEmail = null
    try {
      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (userinfoRes.ok) googleEmail = (await userinfoRes.json()).email || null
    } catch { /* non-essential, connection still works without it */ }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const { error: upsertError } = await admin.from('google_calendar_connections').upsert(
      {
        org_id: orgId,
        user_id: userId,
        google_email: googleEmail,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        access_token_expires_at: expiresAt,
        sync_token: null, // reset — force a fresh full sync on next pull
      },
      { onConflict: 'org_id,user_id' }
    )
    if (upsertError) {
      res.status(500).json({ error: upsertError.message })
      return
    }

    res.status(200).json({ connected: true, email: googleEmail })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Google token exchange failed' })
  }
}
