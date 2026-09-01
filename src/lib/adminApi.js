import { supabase } from './supabase'

// Same pattern as src/lib/googleCalendar.js's callFn — attach the
// caller's own session token, let api/admin.js do the real
// authorization check server-side (requirePlatformAdmin). Nothing here
// is a security boundary on its own.
async function callAdmin(action, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const url = method === 'GET' ? `/api/admin?action=${action}` : '/api/admin'
  const res = await fetch(url, {
    method,
    headers: {
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify({ action, ...body }) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const getAdminOverview = () => callAdmin('overview')
export const getAdminHealth = () => callAdmin('health')
export const setMemberRole = (orgId, userId, role) =>
  callAdmin('set-role', { method: 'POST', body: { orgId, userId, role } })
export const removeMember = (orgId, userId) =>
  callAdmin('remove-member', { method: 'POST', body: { orgId, userId } })
