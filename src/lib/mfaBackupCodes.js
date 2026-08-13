import { supabase } from './supabase'

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

export const generateBackupCodes = () => callFn('/api/mfa-generate-backup-codes', { method: 'POST' })
export const getBackupCodesRemaining = () => callFn('/api/mfa-backup-codes-status')
export const recoverWithBackupCode = (code) => callFn('/api/mfa-recover', { method: 'POST', body: { code } })
