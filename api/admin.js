// Platform-wide admin dashboard — the one surface in this app that
// deliberately reads and writes across every organization at once,
// gated by requirePlatformAdmin (see api/_authHelpers.js) rather than
// requireOrgAdmin: there is no per-org boundary here at all, by design.
// Consolidated into one file dispatched by method + an `action` query
// param (GET) or body field (POST), same reason as google-calendar.js,
// wise-reconcile.js, and mfa.js — Vercel Hobby's 12-function cap.
//
//   GET  ?action=overview      -> global totals + a per-org breakdown
//                                 (roster, resource counts, invoice
//                                 totals by currency, attachment bytes)
//   GET  ?action=health        -> integration env-var status, latest
//                                 backup file, Google/Wise connection counts
//   POST { action: 'set-role',
//          orgId, userId, role }      -> change a member's role in any org
//   POST { action: 'remove-member',
//          orgId, userId }            -> remove a member from any org
//
// Both mutating actions reuse the same "can't touch the last owner"
// safeguard Team.jsx already enforces client-side for in-org changes —
// re-checked here server-side since this endpoint can act on an org the
// caller isn't even a member of.
import { requirePlatformAdmin, logServerError, respondServerError } from './_authHelpers.js'
import { getDisplayName } from '../src/lib/displayName.js'

const BACKUP_BUCKET = 'backups'
const VALID_ROLES = ['owner', 'admin', 'member']

function sumBy(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
}

function countByOrg(rows) {
  const counts = {}
  for (const row of rows) {
    counts[row.org_id] = (counts[row.org_id] || 0) + 1
  }
  return counts
}

// ---- overview (GET ?action=overview) ----
async function handleOverview(req, res) {
  const caller = await requirePlatformAdmin(req, res)
  if (!caller) return
  const { admin } = caller

  const [
    orgsRes,
    membersRes,
    profilesCountRes,
    projectsRes,
    tasksRes,
    invoicesRes,
    ticketsRes,
    attachmentsRes,
  ] = await Promise.all([
    admin.from('organizations').select('id, name, slug, created_at').order('created_at', { ascending: true }),
    admin.from('org_members').select('org_id, user_id, role, profiles ( id, full_name, nickname, email )'),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('projects').select('id, org_id'),
    admin.from('tasks').select('id, org_id'),
    admin.from('invoices').select('id, org_id, total_amount, currency, status'),
    admin.from('tickets').select('id, org_id'),
    admin.from('attachments').select('org_id, file_size'),
  ])

  const firstError = [orgsRes, membersRes, profilesCountRes, projectsRes, tasksRes, invoicesRes, ticketsRes, attachmentsRes]
    .find((r) => r.error)?.error
  if (firstError) {
    respondServerError(res, 'admin:overview', firstError, "Couldn't load the admin overview. Please try again.")
    return
  }

  const orgs = orgsRes.data || []
  const members = membersRes.data || []
  const projectCounts = countByOrg(projectsRes.data || [])
  const taskCounts = countByOrg(tasksRes.data || [])
  const ticketCounts = countByOrg(ticketsRes.data || [])
  const invoiceCounts = countByOrg(invoicesRes.data || [])

  const membersByOrg = {}
  for (const m of members) {
    if (!m.profiles) continue
    if (!membersByOrg[m.org_id]) membersByOrg[m.org_id] = []
    membersByOrg[m.org_id].push({
      userId: m.user_id,
      role: m.role,
      name: getDisplayName(m.profiles, 'Unnamed'),
      email: m.profiles.email || '—',
    })
  }

  const attachmentBytesByOrg = {}
  for (const a of attachmentsRes.data || []) {
    attachmentBytesByOrg[a.org_id] = (attachmentBytesByOrg[a.org_id] || 0) + (Number(a.file_size) || 0)
  }

  const invoiceTotalsByOrg = {}
  for (const inv of invoicesRes.data || []) {
    const bucket = (invoiceTotalsByOrg[inv.org_id] ||= {})
    const currency = inv.currency || 'PHP'
    const entry = (bucket[currency] ||= { count: 0, total: 0, paidTotal: 0 })
    entry.count += 1
    entry.total += Number(inv.total_amount) || 0
    if (inv.status === 'paid') entry.paidTotal += Number(inv.total_amount) || 0
  }

  const orgBreakdown = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.created_at,
    members: membersByOrg[org.id] || [],
    counts: {
      projects: projectCounts[org.id] || 0,
      tasks: taskCounts[org.id] || 0,
      invoices: invoiceCounts[org.id] || 0,
      tickets: ticketCounts[org.id] || 0,
    },
    attachmentBytes: attachmentBytesByOrg[org.id] || 0,
    invoiceTotals: invoiceTotalsByOrg[org.id] || {},
  }))

  res.status(200).json({
    totals: {
      organizations: orgs.length,
      users: profilesCountRes.count ?? 0,
      projects: (projectsRes.data || []).length,
      tasks: (tasksRes.data || []).length,
      invoices: (invoicesRes.data || []).length,
      tickets: (ticketsRes.data || []).length,
      attachmentBytes: sumBy(attachmentsRes.data || [], 'file_size'),
    },
    orgs: orgBreakdown,
  })
}

// ---- health (GET ?action=health) ----
async function handleHealth(req, res) {
  const caller = await requirePlatformAdmin(req, res)
  if (!caller) return
  const { admin } = caller

  const env = {
    googleCalendar: Boolean(process.env.VITE_GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    emailDigest: Boolean(process.env.RESEND_API_KEY && process.env.DIGEST_FROM_EMAIL),
    cronSecret: Boolean(process.env.CRON_SECRET),
  }

  let backup = { latestFile: null, latestAt: null, ageHours: null }
  const { data: files, error: listError } = await admin.storage.from(BACKUP_BUCKET).list('', {
    limit: 1,
    sortBy: { column: 'name', order: 'desc' },
  })
  if (listError) {
    logServerError('admin:health-backup-list', listError)
  } else if (files && files.length > 0) {
    const latest = files[0]
    const latestAt = latest.created_at || latest.updated_at || null
    backup = {
      latestFile: latest.name,
      latestAt,
      ageHours: latestAt ? Math.round((Date.now() - new Date(latestAt).getTime()) / 3600000) : null,
    }
  }

  const [googleConnRes, wiseConnRes, stripeConnRes] = await Promise.all([
    admin.from('google_calendar_connections').select('id', { count: 'exact', head: true }),
    admin.from('wise_reconciliation_connections').select('id', { count: 'exact', head: true }),
    admin.from('stripe_connections').select('id', { count: 'exact', head: true }),
  ])

  // Best-effort: recordErrorLog() (api/_authHelpers.js) is fire-and-forget,
  // so this table can genuinely be empty even on a deployment that has
  // logged errors -- and that's fine, it's the lightweight option. If the
  // query itself fails (e.g. schema_error_log.sql hasn't been run yet),
  // fail soft with an empty list rather than breaking the whole health tab.
  const { data: recentErrorRows, error: errorLogError } = await admin
    .from('error_log')
    .select('id, context, message, created_at')
    .order('created_at', { ascending: false })
    .limit(20)
  if (errorLogError) logServerError('admin:health-error-log', errorLogError)

  res.status(200).json({
    env,
    backup,
    integrations: {
      googleCalendarConnections: googleConnRes.count ?? 0,
      wiseConnections: wiseConnRes.count ?? 0,
      stripeConnections: stripeConnRes.count ?? 0,
    },
    recentErrors: recentErrorRows || [],
  })
}

// ---- set-role (POST action=set-role) ----
async function handleSetRole(req, res) {
  const caller = await requirePlatformAdmin(req, res)
  if (!caller) return
  const { admin } = caller
  const { orgId, userId, role } = req.body || {}

  if (!orgId || !userId || !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: 'orgId, userId, and a valid role are required.' })
    return
  }

  const { data: current, error: currentError } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (currentError) {
    respondServerError(res, 'admin:set-role-lookup', currentError, "Couldn't look up that member. Please try again.")
    return
  }
  if (!current) {
    res.status(404).json({ error: 'That person is not a member of that workspace.' })
    return
  }

  if (current.role === 'owner' && role !== 'owner') {
    const { count, error: ownerCountError } = await admin
      .from('org_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('role', 'owner')
    if (ownerCountError) {
      respondServerError(res, 'admin:set-role-owner-count', ownerCountError, "Couldn't verify owner count. Please try again.")
      return
    }
    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: "Can't demote the last owner of a workspace." })
      return
    }
  }

  const { error: updateError } = await admin
    .from('org_members')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (updateError) {
    respondServerError(res, 'admin:set-role-update', updateError, "Couldn't update that member's role. Please try again.")
    return
  }

  res.status(200).json({ updated: true })
}

// ---- remove-member (POST action=remove-member) ----
async function handleRemoveMember(req, res) {
  const caller = await requirePlatformAdmin(req, res)
  if (!caller) return
  const { admin } = caller
  const { orgId, userId } = req.body || {}

  if (!orgId || !userId) {
    res.status(400).json({ error: 'orgId and userId are required.' })
    return
  }

  const { data: current, error: currentError } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (currentError) {
    respondServerError(res, 'admin:remove-member-lookup', currentError, "Couldn't look up that member. Please try again.")
    return
  }
  if (!current) {
    res.status(404).json({ error: 'That person is not a member of that workspace.' })
    return
  }

  if (current.role === 'owner') {
    const { count, error: ownerCountError } = await admin
      .from('org_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('role', 'owner')
    if (ownerCountError) {
      respondServerError(res, 'admin:remove-member-owner-count', ownerCountError, "Couldn't verify owner count. Please try again.")
      return
    }
    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: "Can't remove the last owner of a workspace." })
      return
    }
  }

  const { error: deleteError } = await admin
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (deleteError) {
    respondServerError(res, 'admin:remove-member-delete', deleteError, "Couldn't remove that member. Please try again.")
    return
  }

  res.status(200).json({ removed: true })
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const action = req.query?.action
    if (action === 'overview') return handleOverview(req, res)
    if (action === 'health') return handleHealth(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  if (req.method === 'POST') {
    const action = req.body?.action
    if (action === 'set-role') return handleSetRole(req, res)
    if (action === 'remove-member') return handleRemoveMember(req, res)
    res.status(400).json({ error: `Unknown action: ${action}` })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
