// Admin pastes their Wise personal API token here. This isn't OAuth —
// Wise's personal tokens are just generated directly in the Wise
// dashboard and pasted in, no redirect flow needed. What this endpoint
// does beyond just storing it: probes whether balance-statement access
// actually works for this specific account, since Wise restricts that to
// accounts based in the US, Canada, Australia, New Zealand, Singapore,
// or Malaysia — everywhere else, the token is valid but that one
// capability is blocked. Storing `supported = false` when that happens
// means Settings can say so honestly instead of the feature just quietly
// never finding any transactions.
import { requireCaller, requireOrgAdmin } from './_authHelpers.js'
import { fetchWiseProfile, fetchWiseBalances, fetchWiseStatement } from './_wiseAuth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { orgId, apiToken } = req.body || {}
  if (!orgId || !apiToken) {
    res.status(400).json({ error: 'orgId and apiToken are both required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  let profile
  try {
    profile = await fetchWiseProfile(apiToken)
  } catch (err) {
    res.status(400).json({ error: `Couldn't verify that token with Wise: ${err.message}` })
    return
  }

  let supported = true
  let probeError = null
  try {
    const balances = await fetchWiseBalances(apiToken, profile.id)
    if (balances[0]) {
      // A short probe (last day) just to see whether the endpoint is
      // reachable at all for this account, not to pull real data yet —
      // the actual sync does that with a proper date range.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      await fetchWiseStatement(apiToken, profile.id, balances[0].id, since)
    }
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      supported = false
      probeError = "This Wise account's country doesn't support balance-statement access via the API (Wise restricts that to accounts based in the US, Canada, Australia, New Zealand, Singapore, or Malaysia). The token is valid and saved, but auto-reconciliation won't find any transactions until that changes on Wise's end."
    } else {
      // Something else went wrong (rate limit, Wise outage, etc.) — don't
      // permanently mark it unsupported over a transient error; the next
      // sync attempt will surface a fresh error if it's still broken.
      probeError = `Connected, but the test check failed: ${err.message}`
    }
  }

  const { error: upsertError } = await admin.from('wise_reconciliation_connections').upsert(
    {
      org_id: orgId,
      api_token: apiToken,
      wise_profile_id: String(profile.id),
      supported,
      last_checked_at: new Date().toISOString(),
      last_error: probeError,
      connected_by: userId,
    },
    { onConflict: 'org_id' }
  )
  if (upsertError) {
    res.status(500).json({ error: upsertError.message })
    return
  }

  res.status(200).json({ connected: true, supported, error: probeError })
}
