// Pull direction: Google -> Pipeline. Two ways in:
//   1. A logged-in user hits "Sync now" on the Calendar page -- the
//      Authorization header carries their own Supabase session token,
//      and only their own connection gets synced.
//   2. Vercel Cron calls this once a day (see vercel.json) as a backstop,
//      so Google-side changes still land even if nobody opens the
//      Calendar page for a while -- Authorization header carries
//      CRON_SECRET instead, and every connection across every org gets
//      synced in one pass.
//
// Deletion asymmetry, worth being explicit about: an event *edited* on
// Google's side updates the shared Pipeline event for the whole team, but
// an event *deleted* on Google's side only removes that one person's
// sync link -- it does not delete the shared Pipeline event. Deleting a
// shared team event for everyone still has to happen in Pipeline itself
// (which does push the delete out to every connected Google Calendar).
// Otherwise one person tidying their own Google Calendar could silently
// wipe an event the rest of the team still needs.
import { createAdminClient, requireCaller } from './_authHelpers.js'
import { getValidAccessToken, googleCalendarRequest, fromGoogleEvent } from './_googleAuth.js'

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6
const TWELVE_MONTHS_MS = SIX_MONTHS_MS * 2

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
          // Sync token expired/invalid on Google's side -- fall back to a
          // fresh full sync instead of failing outright.
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
      if (!fields.start_at) continue // malformed/unsupported event shape, skip

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

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || ''
  const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (isCron) {
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
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

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
