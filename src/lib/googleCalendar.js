import { supabase } from './supabase'

// Must exactly match an "Authorized redirect URI" registered on the
// Google Cloud OAuth client — computed from wherever the app is actually
// running so it works the same in local dev and in production without a
// hardcoded domain. Settings is the landing page either way.
export function getGoogleRedirectUri() {
  return `${window.location.origin}/settings`
}

export function buildGoogleAuthUrl() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    // Forces Google to re-issue a refresh token every time, not just on
    // the very first-ever authorization — without this, reconnecting
    // after a disconnect can silently come back with no refresh token.
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function callFn(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method,
    headers: {
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const getGoogleCalendarStatus = (orgId) =>
  callFn(`/api/google-calendar?orgId=${encodeURIComponent(orgId)}`)

export const exchangeGoogleCode = (orgId, code, redirectUri) =>
  callFn('/api/google-calendar', { method: 'POST', body: { action: 'exchange', orgId, code, redirectUri } })

export const disconnectGoogleCalendar = (orgId) =>
  callFn('/api/google-calendar', { method: 'POST', body: { action: 'disconnect', orgId } })

export const syncGoogleCalendarNow = (orgId) =>
  callFn('/api/google-calendar', { method: 'POST', body: { action: 'sync', orgId } })

// Fire-and-forget — a failure here never blocks the calendar_events
// write that already succeeded. EventDialog.jsx doesn't await the
// result for anything beyond starting the request. `pushAction` here is
// the calendar_events change type ('upsert'/'delete'), separate from the
// top-level `action: 'push'` that routes to this endpoint's push handler.
export const pushGoogleCalendarChange = (orgId, eventId, pushAction) =>
  callFn('/api/google-calendar', { method: 'POST', body: { action: 'push', orgId, eventId, pushAction } }).catch(() => {})
