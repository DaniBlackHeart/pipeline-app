// All Stripe payment operations in one file, dispatched by method + an
// `action` field in the body — same consolidation reasoning as
// api/wise-reconcile.js and api/google-calendar.js: Vercel's Hobby plan
// caps a deployment at 12 serverless functions total.
//
//   GET                                     -> status
//   POST { action: 'connect', ... }         -> save + probe a secret key
//   POST { action: 'disconnect' }           -> remove the connection
//   POST { action: 'generate-link', ... }   -> create/replace one invoice's payment link
//   POST with a Stripe-Signature header     -> webhook (real Stripe request, not ours)
//
// Body parsing is disabled for the whole file (see `config` below) so the
// webhook path can verify Stripe's signature against the exact raw bytes
// received — the non-webhook actions below parse the same raw body as
// JSON manually instead of relying on Vercel's automatic parsing.
import { requireCaller, requireOrgMember, requireOrgAdmin, createAdminClient, logServerError, respondServerError } from './_authHelpers.js'
import { stripeRequest, verifyStripeSignature, readRawBody } from './_stripeAuth.js'

export const config = { api: { bodyParser: false } }

// ---- status (GET) ----
// Any org member can see the status (matches how invoices themselves are
// viewable by everyone) — only setup/actions are admin-only. Never
// returns the secret key or webhook secret themselves.
async function handleStatus(req, res) {
  const orgId = req.query.orgId
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgMember(admin, res, orgId, userId))) return

  const { data: connection, error } = await admin
    .from('stripe_connections')
    .select('last_verified_at, last_error, created_at')
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) {
    respondServerError(res, 'stripe:status', error, "Couldn't load Stripe status. Please try again.")
    return
  }

  res.status(200).json({
    connected: Boolean(connection),
    lastVerifiedAt: connection?.last_verified_at || null,
    lastError: connection?.last_error || null,
    connectedAt: connection?.created_at || null,
  })
}

// ---- connect (POST action=connect) ----
// Admin pastes their Stripe secret key and the webhook signing secret
// Stripe gave them when they registered this org's webhook URL (see
// handleWebhook below — the URL includes the org id so a shared endpoint
// can serve every org's separate Stripe account). The secret key is
// probed against a real Stripe endpoint before saving; the webhook
// secret can't be probed the same way — there's no "check this whsec_ is
// right" endpoint, it's only provable by an actual incoming webhook
// verifying successfully.
async function handleConnect(req, res) {
  const { orgId, secretKey, webhookSecret } = req.body || {}
  if (!orgId || !secretKey || !webhookSecret) {
    res.status(400).json({ error: 'orgId, secretKey, and webhookSecret are all required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  try {
    await stripeRequest(secretKey, '/v1/balance')
  } catch (err) {
    logServerError('stripe:connect-verify-key', err)
    res.status(400).json({ error: `Couldn't verify that secret key with Stripe: ${err.message}` })
    return
  }

  const { error: upsertError } = await admin.from('stripe_connections').upsert(
    {
      org_id: orgId,
      secret_key: secretKey,
      webhook_secret: webhookSecret,
      last_verified_at: new Date().toISOString(),
      last_error: null,
      connected_by: userId,
    },
    { onConflict: 'org_id' }
  )
  if (upsertError) {
    respondServerError(res, 'stripe:connect-save', upsertError, 'Key verified, but saving the connection failed. Please try again.')
    return
  }

  res.status(200).json({ connected: true })
}

// ---- disconnect (POST action=disconnect) ----
async function handleDisconnect(req, res) {
  const { orgId } = req.body || {}
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  const { error: deleteError } = await admin.from('stripe_connections').delete().eq('org_id', orgId)
  if (deleteError) {
    respondServerError(res, 'stripe:disconnect', deleteError, 'Failed to disconnect Stripe. Please try again.')
    return
  }

  res.status(200).json({ disconnected: true })
}

// ---- generate-link (POST action=generate-link) ----
// Creates (or replaces) the Stripe Payment Link for one specific invoice,
// with the invoice's exact total as an ad-hoc price and the Pipeline
// invoice id in metadata — that metadata is what lets the webhook match
// a payment back to this invoice with certainty rather than guessing
// from a typed-in reference the way Wise reconciliation has to. Only
// two decimal places are handled deliberately: every currency this app
// offers (see src/lib/currency.js) uses two decimal places, so a plain
// amount * 100 is exact — this would need adjusting for a zero-decimal
// currency like JPY if one were ever added.
async function handleGenerateLink(req, res) {
  const { orgId, invoiceId } = req.body || {}
  if (!orgId || !invoiceId) {
    res.status(400).json({ error: 'orgId and invoiceId are required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgAdmin(admin, res, orgId, userId))) return

  const { data: connection } = await admin.from('stripe_connections').select('secret_key').eq('org_id', orgId).maybeSingle()
  if (!connection) {
    res.status(400).json({ error: 'Stripe is not connected for this workspace yet' })
    return
  }

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .select('id, invoice_number, client_name, total_amount, currency, stripe_payment_link_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (invoiceError || !invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }

  // Deactivate the previous link, if any, before creating the new one —
  // best-effort. A stale-but-still-active link left over from a prior
  // amount would let someone pay the wrong total; a failed deactivation
  // call is not itself a reason to block generating the new (correct) one.
  if (invoice.stripe_payment_link_id) {
    try {
      await stripeRequest(connection.secret_key, `/v1/payment_links/${invoice.stripe_payment_link_id}`, {
        method: 'POST',
        body: { active: 'false' },
      })
    } catch (err) {
      logServerError('stripe:generate-link-deactivate-old', err)
    }
  }

  let paymentLink
  try {
    paymentLink = await stripeRequest(connection.secret_key, '/v1/payment_links', {
      method: 'POST',
      body: {
        line_items: [
          {
            price_data: {
              currency: String(invoice.currency).toLowerCase(),
              unit_amount: Math.round(Number(invoice.total_amount) * 100),
              product_data: {
                name: `Invoice ${invoice.invoice_number}${invoice.client_name ? ` — ${invoice.client_name}` : ''}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: { pipeline_invoice_id: invoice.id, pipeline_org_id: orgId },
        after_completion: {
          type: 'hosted_confirmation',
          hosted_confirmation: { custom_message: `Thanks — invoice ${invoice.invoice_number} is now marked paid.` },
        },
      },
    })
  } catch (err) {
    logServerError('stripe:generate-link-create', err)
    res.status(400).json({ error: `Couldn't create a Stripe payment link: ${err.message}` })
    return
  }

  const { error: updateError } = await admin
    .from('invoices')
    .update({
      stripe_payment_link: paymentLink.url,
      stripe_payment_link_id: paymentLink.id,
      stripe_link_amount: invoice.total_amount,
      stripe_link_currency: invoice.currency,
    })
    .eq('id', invoice.id)
  if (updateError) {
    respondServerError(res, 'stripe:generate-link-save', updateError, 'Link created on Stripe, but saving it to the invoice failed. Please try again.')
    return
  }

  res.status(200).json({ url: paymentLink.url })
}

// ---- webhook (real Stripe request — verified by signature, not our own auth) ----
// The URL each org registers in their own Stripe Dashboard is
// /api/stripe?orgId=<their org id> — the org id in the URL is what lets
// one shared endpoint serve every org's separate Stripe account, since
// the webhook secret needed to even verify the request has to be looked
// up before verification can happen at all.
async function handleWebhook(req, res, rawBodyBuffer) {
  const orgId = req.query.orgId
  if (!orgId) {
    res.status(400).send('Missing orgId in webhook URL')
    return
  }

  const admin = createAdminClient()
  const { data: connection } = await admin.from('stripe_connections').select('webhook_secret').eq('org_id', orgId).maybeSingle()
  if (!connection) {
    // Not logged as an error — an org that disconnected Stripe but never
    // removed the webhook in their own Stripe Dashboard will keep
    // sending these; a 404 tells Stripe to keep it disabled/retry
    // briefly, not to hammer this endpoint forever.
    res.status(404).send('Unknown org')
    return
  }

  const rawBody = rawBodyBuffer.toString('utf8')
  try {
    verifyStripeSignature(rawBody, req.headers['stripe-signature'], connection.webhook_secret)
  } catch (err) {
    logServerError('stripe:webhook-verify', err)
    res.status(400).send('Signature verification failed')
    return
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    res.status(400).send('Malformed JSON body')
    return
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object || {}
    const invoiceId = session.metadata?.pipeline_invoice_id || null
    const amount = session.amount_total != null ? session.amount_total / 100 : null
    const currency = session.currency ? session.currency.toUpperCase() : null

    let matchedInvoiceId = null
    let matchStatus = 'unmatched'

    if (invoiceId) {
      const { data: invoice } = await admin
        .from('invoices')
        .select('id, status')
        .eq('id', invoiceId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (invoice) {
        matchedInvoiceId = invoice.id
        if (invoice.status === 'paid') {
          matchStatus = 'already_paid'
        } else {
          const { error: markPaidError } = await admin
            .from('invoices')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', invoice.id)
          matchStatus = markPaidError ? 'unmatched' : 'auto'
          if (markPaidError) logServerError('stripe:webhook-mark-paid', markPaidError)
        }
      }
    }

    // Insert is the idempotency guard, via stripe_events.stripe_event_id's
    // unique constraint — Stripe retries deliveries it doesn't get a 2xx
    // for, so this same event can legitimately arrive more than once. A
    // unique-violation here means it was already fully processed; that's
    // success, not an error.
    const { error: insertError } = await admin.from('stripe_events').insert({
      org_id: orgId,
      stripe_event_id: event.id,
      stripe_session_id: session.id || null,
      amount,
      currency,
      matched_invoice_id: matchedInvoiceId,
      match_status: matchStatus,
    })
    if (insertError && insertError.code !== '23505') {
      logServerError('stripe:webhook-insert-event', insertError)
    }
  }

  res.status(200).json({ received: true })
}

export default async function handler(req, res) {
  const rawBodyBuffer = await readRawBody(req)

  if (req.headers['stripe-signature']) {
    await handleWebhook(req, res, rawBodyBuffer)
    return
  }

  // Not a webhook — manual JSON parsing since the body parser is
  // disabled for this whole file (see `config` above).
  let body = {}
  if (rawBodyBuffer.length) {
    try {
      body = JSON.parse(rawBodyBuffer.toString('utf8'))
    } catch {
      res.status(400).json({ error: 'Malformed JSON body' })
      return
    }
  }
  req.body = body

  if (req.method === 'GET') {
    await handleStatus(req, res)
    return
  }

  if (req.method === 'POST') {
    const action = body.action
    if (action === 'connect') return handleConnect(req, res)
    if (action === 'disconnect') return handleDisconnect(req, res)
    if (action === 'generate-link') return handleGenerateLink(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
