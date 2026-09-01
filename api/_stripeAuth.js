// Shared helpers for the Stripe serverless function. Not a route itself --
// leading underscore excludes it from Vercel's route discovery, same
// convention as api/_wiseAuth.js.
//
// Deliberately no `stripe` npm package here -- same reasoning as
// _wiseAuth.js using plain fetch instead of a Wise SDK: Stripe's REST API
// is plain HTTP, well documented, and stable, so a full SDK dependency
// (and its bundle weight) buys nothing a handful of small helpers don't
// already cover.
import crypto from 'node:crypto'

const STRIPE_API = 'https://api.stripe.com'
// Pinned explicitly rather than left to the account's dashboard-configured
// default, since that default could be older than what this code needs --
// price_data (inline, ad-hoc pricing) on Payment Links only exists from
// this version onward. Bump deliberately, not accidentally.
const STRIPE_API_VERSION = '2025-07-30.basil'

// Flattens a nested params object into Stripe's bracket-notation form
// pairs, e.g. { line_items: [{ price_data: { currency: 'usd' } }] } ->
// [['line_items[0][price_data][currency]', 'usd']]. Stripe's REST API
// takes application/x-www-form-urlencoded bodies, not JSON.
function flattenParams(obj, prefix = '') {
  const pairs = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    const paramKey = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const arrKey = `${paramKey}[${i}]`
        if (item !== null && typeof item === 'object') pairs.push(...flattenParams(item, arrKey))
        else pairs.push([arrKey, item])
      })
    } else if (typeof value === 'object') {
      pairs.push(...flattenParams(value, paramKey))
    } else {
      pairs.push([paramKey, value])
    }
  }
  return pairs
}

function toFormBody(obj) {
  return flattenParams(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

// Secret key goes in as the HTTP Basic auth username with an empty
// password -- this is Stripe's own documented pattern (`curl -u
// sk_live_xxx: ...`), not something specific to this integration.
export async function stripeRequest(secretKey, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Stripe-Version': STRIPE_API_VERSION,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? toFormBody(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe API error (${res.status})`)
    err.status = res.status
    err.code = data?.error?.code
    throw err
  }
  return data
}

// Manually verifies a Stripe webhook's Stripe-Signature header against
// the raw request body -- see https://docs.stripe.com/webhooks/signature.
// Header format: "t=<unix ts>,v1=<hex hmac>[,v0=...]". Signed payload is
// "<timestamp>.<raw body>", HMAC-SHA256 with the endpoint's webhook
// secret, hex-encoded. Throws on any failure; never returns false --
// callers should treat any thrown error as "reject this request."
export function verifyStripeSignature(rawBody, signatureHeader, webhookSecret, toleranceSeconds = 300) {
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header')

  const parts = {}
  for (const piece of signatureHeader.split(',')) {
    const [k, v] = piece.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  }
  const timestamp = parts.t
  const v1 = parts.v1
  if (!timestamp || !v1) throw new Error('Malformed Stripe-Signature header')

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    throw new Error('Webhook timestamp outside tolerance (possible replay or clock skew)')
  }

  const signedPayload = `${timestamp}.${rawBody}`
  const expectedHex = crypto.createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex')

  const expectedBuf = Buffer.from(expectedHex, 'hex')
  const actualBuf = Buffer.from(v1, 'hex')
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new Error('Signature mismatch')
  }
}

// Reads the full raw request body as a Buffer -- needed because this
// function disables Vercel's automatic body parsing (see api/stripe.js)
// so the webhook path can verify a signature against the exact bytes
// Stripe sent, unmodified by any JSON parser.
export async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}
