// Called right after a calendar_event is created, updated, or deleted in
// EventDialog.jsx. Pushes that one change out to every team member's
// connected Google Calendar (not just the acting user's — a shared org
// calendar should look the same from everyone's connected Google
// account). The person who made the change doesn't need a connection
// themselves for this to work; it loops over whoever *does* have one.
//
// Best-effort by design: a failure pushing to one person's Google
// Calendar doesn't roll back the Pipeline change (already saved) and
// doesn't stop the push to everyone else's. Errors are collected and
// returned so the frontend can show something if it wants, but the
// caller (EventDialog.jsx) treats this as fire-and-forget either way.
import { requireCaller, requireOrgMember } from './_authHelpers.js'
import { getValidAccessToken, googleCalendarRequest, toGoogleEvent } from './_googleAuth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { orgId, eventId, action } = req.body || {}
  if (!orgId || !eventId || !['upsert', 'delete'].includes(action)) {
    res.status(400).json({ error: 'orgId, eventId, and a valid action are all required' })
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
    res.status(200).json({ pushed: 0, errors: [] }) // nobody's connected — nothing to do
    return
  }

  let event = null
  if (action === 'upsert') {
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

      if (action === 'delete') {
        if (link) {
          await googleCalendarRequest(accessToken, 'DELETE', `/calendars/primary/events/${link.google_event_id}`)
          await admin.from('calendar_event_google_links').delete().eq('calendar_event_id', eventId).eq('connection_id', connection.id)
        }
        pushed += 1
        continue
      }

      // upsert
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
