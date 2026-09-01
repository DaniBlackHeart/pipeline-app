// Daily automated backup export -- cron-only, mirrors daily-digest.js's
// CRON_SECRET pattern exactly (Vercel Cron calls this on a timer with no
// user attached, so a static shared secret is the right auth model here,
// unlike the user-triggered endpoints elsewhere in this project).
//
// What this is: a full logical export of every real data table to a
// single JSON file in a private Storage bucket, once a day, with the
// last 14 days kept and older ones pruned automatically.
//
// What this is NOT: a point-in-time-recovery backup (that needs a paid
// Supabase tier), and NOT a one-click restore -- there is no
// api/backup-restore.js. Restoring from one of these files is a manual,
// careful process: download the JSON from Storage, then re-insert each
// table's rows in dependency order (organizations and profiles first,
// everything else after). That's a deliberate scope boundary, not an
// oversight -- an automated restore that writes into a live multi-tenant
// database is a meaningfully bigger, riskier piece of work than "make
// sure the data exists somewhere if the worst happens," which is what
// this closes. A real tested restore procedure is tracked separately as
// a "before licensing" item, not a "now" one.
//
// Four tables hold live credentials (Google's OAuth tokens, Wise's API
// token, Stripe's secret key + webhook signing secret, MFA backup code
// hashes) and are deliberately NOT included whole -- see
// SENSITIVE_COLUMNS below. Losing those in a restore just means
// reconnecting Google Calendar/Wise/Stripe or regenerating backup codes, a
// small one-time inconvenience traded for not having live credentials
// sitting in a backup file, which is a meaningfully easier thing to
// accidentally over-expose than the production database itself.
import { logServerError } from './_authHelpers.js'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'backups'
const KEEP_DAYS = 14
const PAGE_SIZE = 1000

// Tables to skip entirely -- purely operational/transient, zero
// disaster-recovery value, and rate_limit_events in particular would
// just add the fastest-growing, least-useful rows to every export.
const SKIP_TABLES = new Set(['rate_limit_events', 'error_log'])

// table name -> columns to strip from every row before export.
const SENSITIVE_COLUMNS = {
  google_calendar_connections: ['refresh_token', 'access_token'],
  wise_reconciliation_connections: ['api_token'],
  stripe_connections: ['secret_key', 'webhook_secret'],
  mfa_backup_codes: ['salt', 'code_hash'],
}

function stripSensitiveColumns(tableName, rows) {
  const strip = SENSITIVE_COLUMNS[tableName]
  if (!strip || !rows.length) return rows
  return rows.map((row) => {
    const copy = { ...row }
    for (const col of strip) delete copy[col]
    return copy
  })
}

async function fetchAllRows(admin, tableName) {
  const rows = []
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from(tableName)
      .select('*')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${tableName}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return stripSensitiveColumns(tableName, rows)
}

async function pruneOldBackups(admin) {
  const { data: files, error } = await admin.storage.from(BUCKET).list('', {
    limit: 1000,
    sortBy: { column: 'name', order: 'desc' },
  })
  if (error) {
    logServerError('backup-export:list-existing', error)
    return
  }
  const stale = (files || []).slice(KEEP_DAYS).map((f) => f.name)
  if (stale.length === 0) return

  const { error: removeError } = await admin.storage.from(BUCKET).remove(stale)
  if (removeError) logServerError('backup-export:prune', removeError)
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    logServerError('backup-export:config', new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars'))
    res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL env vars' })
    return
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: tableRows, error: listError } = await admin.rpc('list_public_tables')
  if (listError) {
    logServerError('backup-export:list-tables', listError)
    res.status(500).json({ error: listError.message })
    return
  }

  const tableNames = (tableRows || [])
    .map((r) => r.table_name)
    .filter((name) => !SKIP_TABLES.has(name))

  const exportPayload = { exported_at: new Date().toISOString(), tables: {} }
  const errors = []
  let totalRows = 0

  for (const tableName of tableNames) {
    try {
      const rows = await fetchAllRows(admin, tableName)
      exportPayload.tables[tableName] = rows
      totalRows += rows.length
    } catch (err) {
      logServerError(`backup-export:fetch:${tableName}`, err)
      errors.push(`${tableName}: ${err.message}`)
    }
  }

  const dateStr = exportPayload.exported_at.slice(0, 10)
  const fileName = `pipeline-backup-${dateStr}.json`
  const body = JSON.stringify(exportPayload)

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(fileName, body, {
    contentType: 'application/json',
    upsert: true,
  })

  if (uploadError) {
    logServerError('backup-export:upload', uploadError)
    res.status(500).json({ error: uploadError.message, tablesExported: tableNames.length, totalRows, errors })
    return
  }

  await pruneOldBackups(admin)

  res.status(200).json({
    file: fileName,
    tablesExported: tableNames.length - errors.length,
    totalRows,
    sizeBytes: body.length,
    errors,
  })
}
