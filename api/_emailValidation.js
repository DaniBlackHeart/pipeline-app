// Shared email-deliverability guard used by both the invite flow
// (invite-member.js) and the signup pre-check (auth-lockout.js's
// 'validate-email' action, called from src/lib/authLockout.js before
// AuthContext's signUp()). Added after a manual test showed neither path
// caught a syntactically-fine-but-nonexistent-domain address like
// carovox534@slotbeer.com -- both used to hand off straight to Supabase
// Auth, which only checks that an address is well-formed.
//
// Free-tier only, per this project's free-tier-now rule: a syntax check,
// a DNS MX/A/AAAA lookup, and a static disposable-domain blocklist. This
// does NOT confirm any specific mailbox exists -- no free method can
// (mail providers, Gmail included, refuse to answer that over SMTP). It
// only confirms the domain is real, is configured to accept mail at all,
// and isn't a known throwaway provider. Actual mailbox *ownership* is
// still ultimately proven the way Supabase Auth already proves it: the
// confirmation-email click-through (signup: "confirm your email"; invite:
// the magic link to set a password). This guard exists purely to stop
// obviously-fake or can't-receive-mail addresses from creating a DB row
// or triggering a send in the first place.
//
// A real mailbox-existence check (Kickbox/ZeroBounce/AbstractAPI-style)
// would catch more (e.g. a typo'd but real domain with a made-up local
// part) but costs money per lookup -- deferred until there's a reason to
// spend on it. See Pipeline — 13-Layer Architecture Status.md.
import dns from 'node:dns/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Community-maintained list (MIT, ~121k domains) of known disposable /
// throwaway email providers -- mailinator.com, guerrillamail.com, etc.
// https://github.com/disposable-email-domains/disposable-email-domains
const DISPOSABLE_DOMAINS = new Set(require('disposable-email-domains'))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DNS_NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA'])

// Resolves true/false for "does this record type exist," or throws if the
// resolver itself failed (timeout, network hiccup) rather than giving a
// definitive negative -- callers must NOT treat a thrown error here as
// "domain is bad."
async function hasRecords(resolveFn, domain) {
  try {
    const records = await resolveFn(domain)
    return records.length > 0
  } catch (err) {
    if (DNS_NOT_FOUND_CODES.has(err.code)) return false
    throw err
  }
}

// RFC 5321 §5.1: a mail sender tries MX records first; if a domain
// publishes none at all, it falls back to the domain's own A/AAAA record
// as the mail host. So "no MX records" alone doesn't prove a domain can't
// receive mail -- only "no MX AND no A AND no AAAA" does.
async function domainAcceptsMail(domain) {
  if (await hasRecords(dns.resolveMx, domain)) return true
  if (await hasRecords(dns.resolve4, domain)) return true
  return hasRecords(dns.resolve6, domain)
}

// Returns { valid: true } or { valid: false, reason }. Never throws --
// an unresolvable DNS lookup failure (as opposed to a definitive "no such
// domain") is treated as "couldn't confirm" and resolved as valid, same
// fail-open reasoning as every other guard in this app (see
// checkRateLimit and auth-lockout.js): an infra blip here should never be
// the reason a real signup or invite is blocked.
export async function validateEmailDeliverable(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase()

  if (!email || !EMAIL_RE.test(email)) {
    return { valid: false, reason: "That doesn't look like a valid email address." }
  }

  const domain = email.split('@')[1]

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: 'Temporary/disposable email addresses are not allowed. Please use a permanent email address.' }
  }

  let canReceiveMail
  try {
    canReceiveMail = await domainAcceptsMail(domain)
  } catch {
    // DNS resolver itself failed -- not proof the domain is bad.
    return { valid: true }
  }

  if (!canReceiveMail) {
    return { valid: false, reason: "That email domain doesn't appear to accept mail. Please double-check the address." }
  }

  return { valid: true }
}
