// Shared helpers for every Google Calendar serverless function. Not a
// route itself -- the leading underscore in the filename tells Vercel to
// skip it when discovering api/ endpoints, same convention used for any
// colocated non-route file in a Vercel project.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.VITE_GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed')
  return data // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.VITE_GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token refresh failed')
  return data // { access_token, expires_in, ... } -- refresh_token usually NOT re-sent
}

// Returns a valid access token for this connection, refreshing (and
// persisting the refresh) first if the stored one is expired or close to
// it. Throws if the refresh token itself has been revoked/expired --
// callers should catch this and mark the connection as needing reconnect.
export async function getValidAccessToken(supabase, connection) {
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0
  const stillValid = connection.access_token && expiresAt - Date.now() > 60_000
  if (stillValid) return connection.access_token

  const refreshed = await refreshAccessToken(connection.refresh_token)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  await supabase
    .from('google_calendar_connections')
    .update({ access_token: refreshed.access_token, access_token_expires_at: newExpiresAt })
    .eq('id', connection.id)
  return refreshed.access_token
}

export async function googleCalendarRequest(accessToken, method, path, body) {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204 || res.status === 410) return null // no content / gone (already deleted)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Google Calendar API error (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export async function revokeToken(token) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => {}) // best-effort -- disconnecting locally matters more than Google's own bookkeeping
}

// Pipeline event -> Google event body. All-day events use date-only
// start/end (Google's own convention); timed events use full datetimes.
// Google's `end.date` for all-day events is EXCLUSIVE, so a one-day event
// needs its end date pushed forward by one day.
export function toGoogleEvent(event) {
  if (event.all_day) {
    const start = event.start_at.slice(0, 10)
    const endDate = new Date(`${start}T00:00:00Z`)
    endDate.setUTCDate(endDate.getUTCDate() + 1)
    return {
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      start: { date: start },
      end: { date: endDate.toISOString().slice(0, 10) },
    }
  }
  return {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: { dateTime: event.start_at },
    end: { dateTime: event.end_at || event.start_at },
  }
}

// Google event -> Pipeline calendar_events fields (the reverse direction).
export function fromGoogleEvent(gEvent) {
  const allDay = Boolean(gEvent.start?.date)
  const startAt = allDay ? `${gEvent.start.date}T00:00:00` : gEvent.start?.dateTime
  const endAt = allDay ? null : gEvent.end?.dateTime || null
  return {
    title: gEvent.summary || '(untitled)',
    description: gEvent.description || null,
    location: gEvent.location || null,
    all_day: allDay,
    start_at: startAt,
    end_at: endAt,
  }
}
