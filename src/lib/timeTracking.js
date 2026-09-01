// Shared helpers for time tracking -- used by TaskDetail (the timer +
// manual entry + entries list), ProjectDetail (the rollup), and
// InvoiceForm (pulling unbilled time in as a line item). Keeping the
// rate-resolution and duration-formatting logic in one place means the
// three pages can't quietly drift into computing a total differently.
import { supabase } from './supabase'

// A project's own rate wins if set; otherwise fall back to the org's
// default. Neither set just means "no rate yet" -- callers should show
// hours without a dollar amount rather than treating null as zero.
export function resolveHourlyRate({ orgDefaultRate, projectRate }) {
  const project = Number(projectRate)
  if (Number.isFinite(project) && project > 0) return project
  const org = Number(orgDefaultRate)
  if (Number.isFinite(org) && org > 0) return org
  return null
}

export function minutesToHours(minutes) {
  return Math.round(((minutes || 0) / 60) * 100) / 100
}

export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes || 0))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

// Elapsed minutes for a still-running timer, computed live from its
// started_at rather than trusting a client-side interval alone to be
// accurate after e.g. a laptop sleeps.
export function elapsedMinutesSince(startedAt) {
  if (!startedAt) return 0
  const ms = Date.now() - new Date(startedAt).getTime()
  return Math.max(0, ms / 60000)
}

export async function fetchRunningEntry({ orgId, userId }) {
  return supabase
    .from('time_entries')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .not('started_at', 'is', null)
    .maybeSingle()
}

export async function startTimer({ orgId, taskId, userId }) {
  return supabase
    .from('time_entries')
    .insert({ org_id: orgId, task_id: taskId, user_id: userId, started_at: new Date().toISOString(), minutes: null, source: 'timer' })
    .select('*')
    .single()
}

export async function stopTimer({ entryId, startedAt }) {
  const minutes = Math.max(1, Math.round(elapsedMinutesSince(startedAt)))
  return supabase
    .from('time_entries')
    .update({ minutes, started_at: null })
    .eq('id', entryId)
    .select('*')
    .single()
}

export async function addManualEntry({ orgId, taskId, userId, entryDate, minutes, note }) {
  return supabase
    .from('time_entries')
    .insert({
      org_id: orgId,
      task_id: taskId,
      user_id: userId,
      entry_date: entryDate,
      minutes,
      note: note?.trim() || null,
      source: 'manual',
    })
    .select('*')
    .single()
}

export async function deleteEntry(entryId) {
  return supabase.from('time_entries').delete().eq('id', entryId)
}

// Releases an entry from an invoice without deleting the logged time --
// the safety valve for when a "Logged time" line item gets removed from
// an invoice by hand (see InvoiceForm) and the underlying hours need to
// go back to being billable.
export async function unbillEntries(entryIds) {
  if (!entryIds?.length) return { error: null }
  return supabase
    .from('time_entries')
    .update({ billed: false, invoice_id: null, rate_snapshot: null })
    .in('id', entryIds)
}

export async function markEntriesBilled({ entryIds, invoiceId, rate }) {
  if (!entryIds?.length) return { error: null }
  return supabase
    .from('time_entries')
    .update({ billed: true, invoice_id: invoiceId, rate_snapshot: rate ?? null })
    .in('id', entryIds)
}

export async function fetchTaskEntries(taskId) {
  return supabase
    .from('time_entries')
    .select('*, profiles ( full_name, nickname )')
    .eq('task_id', taskId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
}

export async function fetchUnbilledForTask(taskId) {
  return supabase
    .from('time_entries')
    .select('*')
    .eq('task_id', taskId)
    .eq('billed', false)
    .not('minutes', 'is', null)
}

// A project-linked invoice can pull time logged against any of the
// project's tasks, not just one -- resolved in two steps (task ids for
// the project, then entries for those tasks) rather than a single
// embedded-resource filter, to stay compatible with the pinned
// supabase-js version's query builder.
export async function fetchUnbilledForProject(projectId) {
  const { data: taskRows, error: taskError } = await supabase.from('tasks').select('id').eq('project_id', projectId)
  if (taskError) return { data: null, error: taskError }
  const taskIds = (taskRows || []).map((t) => t.id)
  if (taskIds.length === 0) return { data: [], error: null }
  return supabase.from('time_entries').select('*').in('task_id', taskIds).eq('billed', false).not('minutes', 'is', null)
}

export function sumMinutes(entries) {
  return (entries || []).reduce((sum, e) => sum + (e.minutes || 0), 0)
}
