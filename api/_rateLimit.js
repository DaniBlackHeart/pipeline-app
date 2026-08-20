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
