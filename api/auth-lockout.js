// Two things live in this file, both deliberately public/unauthenticated
// pre-auth checks that share the same rate_limit_events-backed pattern.
// Consolidated into one function rather than split into two files to stay
// under Vercel Hobby's 12-serverless-function cap (see project
// instructions / README) -- neither is a full "route" in its own right.
//
// 1. Login lockout -- closes a specific gap in Supabase's own built-in
// Auth rate limiting, rather than duplicating it. Supabase Auth already
// rate-limits /auth/v1/token by IP address (configurable under
// Authentication -> Rate Limits) -- that's Supabase's job, and this file
// doesn't touch it, re-check passwords, or issue sessions. What that
// IP-based limit doesn't cover: someone brute-forcing ONE specific
// account's password from many different IP addresses. This endpoint
// adds a per-account failure counter on top. It never sees a password --
// only whether a given email has racked up too many recent failed login
// attempts, as reported by the client after Supabase itself has already
// rejected the attempt.
//
// Doesn't look up whether the email corresponds to a real account
// anywhere, so a response can't be used to enumerate valid accounts.
//
// Known trade-off, same as any account-level lockout: someone who knows
// (or guesses) a target's email could deliberately trigger their
// lockout by spamming record-failure for that address. The threshold
// below (10 failures / 15 min) is set generously enough that this is a
// mild, temporary annoyance for a real user rather than a durable
// denial-of-service -- tighten only if evidence suggests otherwise.
//
// 2. Email validation -- runs the free deliverability guard in
// _emailValidation.js (syntax + DNS MX/A/AAAA + disposable-domain
// blocklist) before AuthContext's signUp() creates an account. It has to
// live pre-auth too, for the same reason as the lockout check: there's no
// session yet during signup. Rate-limited by IP rather than by email --
// there's no account to scope it to yet -- generous enough for a real
// person retyping a typo, tight enough to stop a script from using this
// as a free DNS-lookup/disposable-domain oracle.
//
//   POST { action: 'check', email }          -> { locked, retryAfterSeconds? }
//   POST { action: 'record-failure', email } -> { recorded: true }
//   POST { action: 'validate-email', email } -> { valid, reason? }
import { createAdminClient, logServerError } from './_authHelpers.js'
import { getRecentEventCount, getOldestEventInWindow, recordEvent, checkRateLimit } from './_rateLimit.js'
import { validateEmailDeliverable } from './_emailValidation.js'

const MAX_FAILURES = 10
const WINDOW_SECONDS = 15 * 60

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

async function handleCheck(req, res) {
  const email = normalizeEmail(req.body?.email)
  if (!email) {
    res.status(400).json({ error: 'Email is required' })
    return
  }

  try {
    const admin = createAdminClient()
    const scope = `login-fail:${email}`

    const count = await getRecentEventCount(admin, scope, WINDOW_SECONDS)
    if (count < MAX_FAILURES) {
      res.status(200).json({ locked: false })
      return
    }

    const oldest = await getOldestEventInWindow(admin, scope, WINDOW_SECONDS)
    const retryAfterSeconds = oldest
      ? Math.max(0, WINDOW_SECONDS - Math.floor((Date.now() - new Date(oldest).getTime()) / 1000))
      : WINDOW_SECONDS

    res.status(200).json({ locked: true, retryAfterSeconds })
  } catch (err) {
    logServerError('auth-lockout:check', err)
    // Fail open -- a misconfigured/unreachable admin client here should
    // never be the reason a legitimate login gets blocked.
    res.status(200).json({ locked: false })
  }
}

async function handleRecordFailure(req, res) {
  const email = normalizeEmail(req.body?.email)
  if (!email) {
    res.status(400).json({ error: 'Email is required' })
    return
  }

  try {
    const admin = createAdminClient()
    await recordEvent(admin, `login-fail:${email}`)
    res.status(200).json({ recorded: true })
  } catch (err) {
    logServerError('auth-lockout:record-failure', err)
    // Not recording this one failure just means it doesn't count toward
    // the limit -- never worth surfacing as an error to the login form.
    res.status(200).json({ recorded: false })
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

async function handleValidateEmail(req, res) {
  const email = normalizeEmail(req.body?.email)
  if (!email) {
    res.status(400).json({ error: 'Email is required' })
    return
  }

  try {
    const admin = createAdminClient()
    const allowed = await checkRateLimit(admin, `validate-email-ip:${clientIp(req)}`, 30, 5 * 60)
    if (!allowed) {
      // Fail open on the UX, not the guard: don't block signup entirely
      // just because this endpoint's own rate limit was hit -- skip the
      // deep check for this request rather than returning an error the
      // signup form would have to explain.
      res.status(200).json({ valid: true })
      return
    }

    const result = await validateEmailDeliverable(email)
    res.status(200).json(result)
  } catch (err) {
    logServerError('auth-lockout:validate-email', err)
    // Fail open -- same reasoning as handleCheck above.
    res.status(200).json({ valid: true })
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const action = req.body?.action
  if (action === 'check') return handleCheck(req, res)
  if (action === 'record-failure') return handleRecordFailure(req, res)
  if (action === 'validate-email') return handleValidateEmail(req, res)
  res.status(400).json({ error: `Unknown action: ${action}` })
}
