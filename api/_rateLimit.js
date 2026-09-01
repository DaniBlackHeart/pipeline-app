// Simple, DB-backed rate limiting shared by any serverless endpoint that
// needs it. Deliberately basic -- no IP tracking, no sliding windows, no
// external service -- just enough to blunt a scripted hammering loop or a
// compromised session spamming a write-capable endpoint, not a determined
// attacker. Mirrors the same "count recent rows, cap at N per window"
// pattern schema_client_tickets.sql already uses for the public
// submit_client_ticket() function, implemented here in JS instead of as a
// security-definer RPC, since every caller already runs server-side with
// the admin (service-role) client and doesn't need the privilege escalation
// a Postgres function would provide.
//
// Table: public.rate_limit_events (scope text, created_at timestamptz).
// Service-role only -- see schema_rate_limits.sql. Leading underscore
// keeps Vercel from treating this as its own route.
import { logServerError } from './_authHelpers.js'

// Returns true if the action is allowed (and records this attempt), false
// if `scope` has already hit `maxCount` attempts within the last
// `windowSeconds`. Callers should pick a scope specific enough to isolate
// the thing being limited -- e.g. `invite:${orgId}` or
// `oauth-exchange:${userId}` -- so one workspace or user hitting the limit
// doesn't affect any other.
export async function checkRateLimit(admin, scope, maxCount, windowSeconds) {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString()

  const { count, error } = await admin
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('scope', scope)
    .gt('created_at', windowStart)

  if (error) {
    // Fail open rather than blocking a legitimate request over a hiccup
    // in the rate-limit table itself -- but log it, since a persistent
    // failure here would otherwise silently disable the guard.
    logServerError(`rateLimit:${scope}`, error)
    return true
  }

  if ((count ?? 0) >= maxCount) {
    return false
  }

  const { error: insertError } = await admin.from('rate_limit_events').insert({ scope })
  if (insertError) logServerError(`rateLimit:${scope}:record`, insertError)

  return true
}

// Three lower-level building blocks below, for callers that can't use
// checkRateLimit's all-in-one "check and record" shape -- specifically,
// api/auth-lockout.js needs to record ONLY failed login attempts (not
// every attempt), so it must check without recording, then record
// separately and only when the caller already knows the attempt failed.

// Read-only -- returns the count of matching rows within the window
// without recording anything. Fails open (returns 0) on a DB error, same
// reasoning as checkRateLimit: never let an infra hiccup here look like
// "this account is at its limit."
export async function getRecentEventCount(admin, scope, windowSeconds) {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { count, error } = await admin
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('scope', scope)
    .gt('created_at', windowStart)

  if (error) {
    logServerError(`rateLimit:${scope}:count`, error)
    return 0
  }
  return count ?? 0
}

// Read-only -- returns the created_at of the oldest matching row within
// the window (or null if none), so a caller can compute a retry-after
// time. Returns null on error rather than throwing.
export async function getOldestEventInWindow(admin, scope, windowSeconds) {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { data, error } = await admin
    .from('rate_limit_events')
    .select('created_at')
    .eq('scope', scope)
    .gt('created_at', windowStart)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    logServerError(`rateLimit:${scope}:oldest`, error)
    return null
  }
  return data?.created_at ?? null
}

// Write-only -- records one event for `scope` unconditionally. The
// counterpart to the two read-only helpers above.
export async function recordEvent(admin, scope) {
  const { error } = await admin.from('rate_limit_events').insert({ scope })
  if (error) logServerError(`rateLimit:${scope}:record`, error)
}
