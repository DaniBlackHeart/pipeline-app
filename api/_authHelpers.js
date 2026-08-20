// Shared auth boilerplate for the Google Calendar endpoints, mirroring
// the exact pattern api/invite-member.js already uses: identify the
// caller from their own session token, then independently verify their
// org membership server-side -- never trust what the client claims about
// its own permissions. Leading underscore keeps Vercel from treating this
// as its own route.
import { createClient } from '@supabase/supabase-js'

// Logs full error detail to Vercel's function logs so a production
// failure leaves a trace even though it's never returned to the client
// verbatim (see respondServerError below). `context` should be short
// and specific -- e.g. 'google-calendar:handleExchange' -- so a log
// line is traceable back to the code that produced it.
export function logServerError(context, err) {
  console.error(`[api/${context}]`, err)
}

// Logs the full error, then sends a short, safe, generic message to
// the client instead of the raw one. Supabase/Postgres error text can
// include column, table, or constraint names that aren't meant for an
// end user, and an unexpected JS exception's message can be almost
// anything -- neither belongs in an HTTP response. `fallbackMessage`
// should still say what failed, just without the internals.
export function respondServerError(res, context, err, fallbackMessage, status = 500) {
  logServerError(context, err)
  res.status(status).json({ error: fallbackMessage })
}

export function createAdminClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Returns { admin, userId } or writes an error response and returns null.
export async function requireCaller(req, res) {
  const admin = createAdminClient()
  const authHeader = req.headers.authorization || ''
  const callerToken = authHeader.replace(/^Bearer /, '')
  if (!callerToken) {
    res.status(401).json({ error: 'Missing caller session token' })
    return null
  }
  const { data, error } = await admin.auth.getUser(callerToken)
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }
  return { admin, userId: data.user.id }
}

// Verifies the caller belongs to orgId at all (any role — this is for
// features every member can use, unlike invite-member.js's admin-only
// check). Returns true, or writes a 403 and returns false.
export async function requireOrgMember(admin, res, orgId, userId) {
  const { data: membership, error } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    respondServerError(res, 'authHelpers:requireOrgMember', error, "Couldn't verify your workspace membership. Please try again.")
    return false
  }
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this workspace' })
    return false
  }
  return true
}

// Stricter version for admin-only actions (Wise reconciliation setup,
// confirming/ignoring a match) — same shape, just checks the role too.
export async function requireOrgAdmin(admin, res, orgId, userId) {
  const { data: membership, error } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    respondServerError(res, 'authHelpers:requireOrgAdmin', error, "Couldn't verify your workspace permissions. Please try again.")
    return false
  }
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    res.status(403).json({ error: 'Admins only' })
    return false
  }
  return true
}
