// Shared helpers for the Wise reconciliation serverless functions. Not a
// route itself -- leading underscore excludes it from Vercel's route
// discovery, same convention as api/_googleAuth.js.
const WISE_API = 'https://api.wise.com'

async function wiseRequest(token, path) {
  const res = await fetch(`${WISE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.errors?.[0]?.message || data?.error || `Wise API error (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export async function fetchWiseProfile(token) {
  const profiles = await wiseRequest(token, '/v1/profiles')
  // Business token -> business profile. Prefer it explicitly in case
  // Wise ever returns more than one profile for an account.
  const business = profiles.find((p) => p.type === 'business') || profiles[0]
  if (!business) throw new Error('No Wise profile found for this token')
  return business
}

export async function fetchWiseBalances(token, profileId) {
  return wiseRequest(token, `/v4/profiles/${profileId}/balances?types=STANDARD`)
}

// Statement lines for one balance, from `sinceDate` to now. Throws with
// status 403 specifically when the account's country isn't one of the
// ones Wise allows balance-statement API access for (US, Canada,
// Australia, New Zealand, Singapore, Malaysia) -- callers use that to
// set `supported = false` rather than treating it as a transient error.
export async function fetchWiseStatement(token, profileId, balanceId, sinceDate) {
  const intervalStart = `${sinceDate}T00:00:00.000Z`
  const intervalEnd = new Date().toISOString()
  const data = await wiseRequest(
    token,
    `/v1/profiles/${profileId}/balance-statements/${balanceId}/statement.json?currency=&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`
  )
  return data.transactions || []
}

// Finds the single sent (unpaid) invoice this transaction most likely
// pays for -- reference text contains the invoice number, AND the amount
// and currency match exactly. Deliberately conservative: anything less
// than a full match on both reference and amount is left unmatched for a
// human to review rather than guessed at, since marking the wrong
// invoice paid is a real mistake, not a cosmetic one.
export function findMatchingInvoice(transaction, openInvoices) {
  const reference = (transaction.details?.paymentReference || '').toUpperCase()
  if (!reference) return null
  const candidates = openInvoices.filter(
    (inv) =>
      reference.includes(inv.invoice_number.toUpperCase()) &&
      inv.currency === transaction.amount.currency &&
      Math.abs(Number(inv.total_amount) - Number(transaction.amount.value)) < 0.01
  )
  return candidates.length === 1 ? candidates[0] : null
}
