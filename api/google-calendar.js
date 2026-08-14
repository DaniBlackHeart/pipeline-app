// All Google Calendar server-side operations in one file, dispatched by
// method + an `action` field in the body. Consolidated from what were
// five separate files (status/exchange/disconnect/push/sync) — Vercel's
// Hobby plan caps a deployment at 12 serverless functions total, and
// this project was about to exceed that across Google Calendar + Wise +
// MFA combined. Each handler below is functionally identical to its
// original standalone file; only the routing changed.
//
//   GET                              -> status
//   POST { action: 'exchange', ... } -> complete the OAuth code exchange
//   POST { action: 'disconnect' }    -> revoke + remove the connection
//   POST { action: 'push', ... }     -> push one calendar_event change to Google
//   POST { action: 'sync' }          -> pull the caller's own connection
//   (any method) Authorization: Bearer CRON_SECRET -> pull every connection (daily cron)
import { requireCaller, requireOrgMember, createAdminClient } from './_authHelpers.js'
import {
  exchangeCodeForTokens,
  revokeToken,
  getValidAccessToken,
  googleCalendarRequest,
  toGoogleEvent,
  fromGoogleEvent,
} from './_googleAuth.js'

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6
const TWELVE_MONTHS_MS = SIX_MONTHS_MS * 2

// ---- status (GET) ----
async function handleStatus(req, res) {
  const orgId = req.query.orgId
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { data: connection, error } = await admin
    .from('google_calendar_connections')
    .select('google_email, last_synced_at, created_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(200).json({
    connected: Boolean(connection),
    email: connection?.google_email || null,
    lastSyncedAt: connection?.last_synced_at || null,
    connectedAt: connection?.created_at || null,
  })
}

// ---- exchange (POST action=exchange) ----
// SECURITY: this is the only place GOOGLE_CLIENT_SECRET is ever used —
// it must stay server-side.
async function handleExchange(req, res) {
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
      res.status(400).json({ error: "Google didn't return a refresh token. Try disconnecting in your Google Account's third-party access settings, then reconnect here." })
      return
    }

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
        sync_token: null,
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

  const { data: connection } = await admin
    .from('google_calendar_connections')
    .select('id, refresh_token')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!connection) {
    res.status(200).json({ disconnected: true })
    return
  }

  await revokeToken(connection.refresh_token)

  const { error: deleteError } = await admin.from('google_calendar_connections').delete().eq('id', connection.id)
  if (deleteError) {
    res.status(500).json({ error: deleteError.message })
    return
  }

  res.status(200).json({ disconnected: true })
}

// ---- push (POST action=push) ----
async function handlePush(req, res) {
  const { orgId, eventId, pushAction } = req.body || {}
  if (!orgId || !eventId || !['upsert', 'delete'].includes(pushAction)) {
    res.status(400).json({ error: 'orgId, eventId, and a valid pushAction are all required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller
  if (!(await requireOrgMember(admin, res, orgId, userId))) return

  const { data: connections } = await admin
    .from('google_calendar_connections')
    .select('*')
    .eq('org_id', orgId)

  if (!connections || connections.length === 0) {
    res.status(200).json({ pushed: 0, errors: [] })
    return
  }

  let event = null
  if (pushAction === 'upsert') {
    const { data } = await admin.from('calendar_events').select('*').eq('id', eventId).maybeSingle()
    if (!data) {
      res.status(200).json({ pushed: 0, errors: ['Event no longer exists — nothing to push'] })
      return
    }
    event = data
  }

  const errors = []
  let pushed = 0

  for (const connection of connections) {
    try {
      const accessToken = await getValidAccessToken(admin, connection)

      const { data: link } = await admin
        .from('calendar_event_google_links')
        .select('google_event_id')
        .eq('calendar_event_id', eventId)
        .eq('connection_id', connection.id)
        .maybeSingle()

      if (pushAction === 'delete') {
        if (link) {
          await googleCalendarRequest(accessToken, 'DELETE', `/calendars/primary/events/${link.google_event_id}`)
          await admin.from('calendar_event_google_links').delete().eq('calendar_event_id', eventId).eq('connection_id', connection.id)
        }
        pushed += 1
        continue
      }

      const body = toGoogleEvent(event)
      if (link) {
        await googleCalendarRequest(accessToken, 'PUT', `/calendars/primary/events/${link.google_event_id}`, body)
      } else {
        const created = await googleCalendarRequest(accessToken, 'POST', '/calendars/primary/events', body)
        await admin.from('calendar_event_google_links').insert({
          calendar_event_id: eventId,
          connection_id: connection.id,
          google_event_id: created.id,
        })
      }
      pushed += 1
    } catch (err) {
      errors.push(`${connection.google_email || connection.id}: ${err.message}`)
    }
  }

  res.status(200).json({ pushed, errors })
}

// ---- sync core (Google -> Pipeline, shared by on-demand + cron) ----
async function syncOneConnection(admin, connection) {
  const result = { pulled: 0, created: 0, updated: 0, unlinked: 0, error: null }
  try {
    const accessToken = await getValidAccessToken(admin, connection)

    let pageToken
    let nextSyncToken = connection.sync_token
    let items = []

    do {
      const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' })
      if (connection.sync_token) {
        params.set('syncToken', connection.sync_token)
      } else {
        params.set('timeMin', new Date(Date.now() - SIX_MONTHS_MS).toISOString())
        params.set('timeMax', new Date(Date.now() + TWELVE_MONTHS_MS).toISOString())
      }
      if (pageToken) params.set('pageToken', pageToken)

      let page
      try {
        page = await googleCalendarRequest(accessToken, 'GET', `/calendars/primary/events?${params.toString()}`)
      } catch (err) {
        if (err.status === 410 && connection.sync_token) {
          return syncOneConnection(admin, { ...connection, sync_token: null })
        }
        throw err
      }

      items = items.concat(page.items || [])
      pageToken = page.nextPageToken
      if (page.nextSyncToken) nextSyncToken = page.nextSyncToken
    } while (pageToken)

    for (const gEvent of items) {
      const { data: link } = await admin
        .from('calendar_event_google_links')
        .select('calendar_event_id')
        .eq('connection_id', connection.id)
        .eq('google_event_id', gEvent.id)
        .maybeSingle()

      if (gEvent.status === 'cancelled') {
        if (link) {
          await admin.from('calendar_event_google_links').delete().eq('connection_id', connection.id).eq('google_event_id', gEvent.id)
          result.unlinked += 1
        }
        continue
      }

      const fields = fromGoogleEvent(gEvent)
      if (!fields.start_at) continue

      if (link) {
        await admin.from('calendar_events').update(fields).eq('id', link.calendar_event_id)
        result.updated += 1
      } else {
        const { data: created } = await admin
          .from('calendar_events')
          .insert({ ...fields, org_id: connection.org_id, created_by: connection.user_id })
          .select('id')
          .single()
        await admin.from('calendar_event_google_links').insert({
          calendar_event_id: created.id,
          connection_id: connection.id,
          google_event_id: gEvent.id,
        })
        result.created += 1
      }
      result.pulled += 1
    }

    await admin
      .from('google_calendar_connections')
      .update({ sync_token: nextSyncToken, last_synced_at: new Date().toISOString() })
      .eq('id', connection.id)
  } catch (err) {
    result.error = err.message || 'Sync failed'
  }
  return result
}

// ---- sync (POST action=sync) — the caller's own connection only ----
async function handleSync(req, res) {
  const { orgId } = req.body || {}
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' })
    return
  }

  const caller = await requireCaller(req, res)
  if (!caller) return
  const { admin, userId } = caller

  const { data: connection } = await admin
    .from('google_calendar_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!connection) {
    res.status(400).json({ error: 'Not connected to Google Calendar yet' })
    return
  }

  const result = await syncOneConnection(admin, connection)
  if (result.error) {
    res.status(500).json({ error: result.error })
    return
  }
  res.status(200).json(result)
}

// ---- cron: every connection across every org ----
async function handleCronSync(res) {
  const admin = createAdminClient()
  const { data: connections, error } = await admin.from('google_calendar_connections').select('*')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  const summary = { connectionsProcessed: 0, errors: [] }
  for (const connection of connections || []) {
    const result = await syncOneConnection(admin, connection)
    summary.connectionsProcessed += 1
    if (result.error) summary.errors.push(`${connection.google_email || connection.id}: ${result.error}`)
  }
  res.status(200).json(summary)
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || ''
  const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (isCron) {
    await handleCronSync(res)
    return
  }

  if (req.method === 'GET') {
    await handleStatus(req, res)
    return
  }

  if (req.method === 'POST') {
    const action = req.body?.action
    if (action === 'exchange') return handleExchange(req, res)
    if (action === 'disconnect') return handleDisconnect(req, res)
    if (action === 'push') return handlePush(req, res)
    if (action === 'sync') return handleSync(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
