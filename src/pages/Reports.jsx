import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { dateKey } from '../lib/calendarUtils'
import { getPresetRange, RANGE_PRESETS, formatRangeLabel } from '../lib/dateRange'
import { downloadCSV } from '../lib/csv'
import { formatMoney } from '../lib/currency'
import Scrubber from '../components/Scrubber'
import TallyDot from '../components/TallyDot'

const TYPE_LABELS = { bug: 'Bug', request: 'Request', question: 'Question', other: 'Other' }
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }

function withinRange(isoString, start, end) {
  const key = dateKey(isoString)
  if (start && key < start) return false
  if (end && key > end) return false
  return true
}

function emptyCurrencyBucket() {
  return { invoiced: 0, paid: 0, outstanding: 0, overdue: 0, count: 0 }
}

export default function Reports() {
  const { activeOrgId, activeOrg } = useAuth()
  const [preset, setPreset] = useState('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [invoices, setInvoices] = useState([])
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const range = preset === 'custom'
    ? { start: customStart || null, end: customEnd || null }
    : getPresetRange(preset)

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    let invoiceQuery = supabase
      .from('invoices')
      .select('id, invoice_number, client_name, project_id, status, currency, total_amount, issue_date, due_date')
      .eq('org_id', activeOrgId)
    if (range.start) invoiceQuery = invoiceQuery.gte('issue_date', range.start)
    if (range.end) invoiceQuery = invoiceQuery.lte('issue_date', range.end)

    const [{ data: invoiceRows, error: invoiceError }, { data: projectRows, error: projectError }, { data: taskRows, error: taskError }, { data: ticketRows, error: ticketError }] =
      await Promise.all([
        invoiceQuery,
        supabase.from('projects').select('id, name, status, due_date').eq('org_id', activeOrgId).neq('status', 'archived'),
        supabase.from('tasks').select('id, project_id, status').eq('org_id', activeOrgId),
        supabase.from('tickets').select('id, type, priority, status, project_id, created_at, resolved_at').eq('org_id', activeOrgId),
      ])

    if (invoiceError || projectError || taskError || ticketError) {
      setError((invoiceError || projectError || taskError || ticketError).message)
      setLoading(false)
      return
    }

    setInvoices(invoiceRows || [])
    setProjects(projectRows || [])
    setTasks(taskRows || [])
    setTickets(ticketRows || [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, range.start, range.end])

  useEffect(() => { load() }, [load])

  // ---- Financial summary, grouped by currency (never summed across currencies) ----
  const financialByCurrency = useMemo(() => {
    const buckets = {}
    const today = dateKey(new Date())
    for (const inv of invoices) {
      buckets[inv.currency] ??= emptyCurrencyBucket()
      const bucket = buckets[inv.currency]
      bucket.invoiced += inv.total_amount
      bucket.count += 1
      const isOverdue = inv.status === 'sent' && inv.due_date && inv.due_date < today
      if (inv.status === 'paid') bucket.paid += inv.total_amount
      else if (isOverdue) bucket.overdue += inv.total_amount
      else if (inv.status === 'sent') bucket.outstanding += inv.total_amount
    }
    return buckets
  }, [invoices])

  // ---- Per-project rollup: current completion snapshot + invoiced-in-range ----
  const taskCountsByProject = useMemo(() => {
    const counts = {}
    for (const t of tasks) {
      counts[t.project_id] ??= { done: 0, total: 0 }
      counts[t.project_id].total += 1
      if (t.status === 'done') counts[t.project_id].done += 1
    }
    return counts
  }, [tasks])

  const invoicedByProject = useMemo(() => {
    const map = {}
    for (const inv of invoices) {
      if (!inv.project_id) continue
      map[inv.project_id] ??= {}
      map[inv.project_id][inv.currency] = (map[inv.project_id][inv.currency] || 0) + inv.total_amount
    }
    return map
  }, [invoices])

  const unlinkedInvoiced = useMemo(() => {
    const bucket = {}
    for (const inv of invoices) {
      if (inv.project_id) continue
      bucket[inv.currency] = (bucket[inv.currency] || 0) + inv.total_amount
    }
    return bucket
  }, [invoices])

  // ---- Ticket activity ----
  const ticketStats = useMemo(() => {
    const filed = tickets.filter((t) => withinRange(t.created_at, range.start, range.end))
    const resolvedInRange = tickets.filter((t) => t.resolved_at && withinRange(t.resolved_at, range.start, range.end))
    const currentlyOpen = tickets.filter((t) => t.status !== 'resolved').length

    const byType = {}
    const byPriority = {}
    for (const t of filed) {
      byType[t.type] = (byType[t.type] || 0) + 1
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1
    }

    const avgResolutionDays = resolvedInRange.length > 0
      ? resolvedInRange.reduce((sum, t) => sum + (new Date(t.resolved_at) - new Date(t.created_at)), 0) / resolvedInRange.length / 86400000
      : null

    return { filedCount: filed.length, resolvedCount: resolvedInRange.length, currentlyOpen, byType, byPriority, avgResolutionDays }
  }, [tickets, range.start, range.end])

  const currencies = Object.keys(financialByCurrency)

  const handleExportInvoicesCSV = () => {
    downloadCSV('invoices.csv', invoices.map((inv) => ({
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      status: inv.status,
      currency: inv.currency,
      total_amount: inv.total_amount,
      issue_date: inv.issue_date,
      due_date: inv.due_date || '',
    })))
  }

  const handleExportProjectsCSV = () => {
    downloadCSV('project-rollup.csv', projects.map((p) => {
      const counts = taskCountsByProject[p.id] || { done: 0, total: 0 }
      const invoicedStr = Object.entries(invoicedByProject[p.id] || {}).map(([c, amt]) => `${c} ${amt.toFixed(2)}`).join('; ')
      return {
        project: p.name,
        status: p.status,
        tasks_done: counts.done,
        tasks_total: counts.total,
        percent_complete: counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
        due_date: p.due_date || '',
        invoiced_in_period: invoicedStr,
      }
    }))
  }

  return (
    <div>
      <div className="print:hidden flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Reports</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {formatRangeLabel(range.start, range.end)}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="print:hidden flex items-center gap-2 mb-6 flex-wrap">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className="text-xs font-mono uppercase tracking-wide rounded-full px-3 py-1 border transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: preset === p.key ? 'var(--ink)' : 'transparent',
              color: preset === p.key ? 'var(--panel)' : 'var(--ink-muted)',
            }}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <span className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="text-sm rounded-md border px-2 py-1" style={{ borderColor: 'var(--border)' }} />
            <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="text-sm rounded-md border px-2 py-1" style={{ borderColor: 'var(--border)' }} />
          </span>
        )}
      </div>

      {/* Print-only letterhead */}
      <div className="hidden print:block mb-6">
        <p className="font-display font-bold text-xl">{activeOrg?.name}</p>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Report for {formatRangeLabel(range.start, range.end)} — generated {new Date().toLocaleDateString()}
        </p>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading report…</p>
      ) : (
        <div className="space-y-8">
          {/* Financial summary */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-lg">Financial summary</h2>
              <button onClick={handleExportInvoicesCSV} className="print:hidden text-sm rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                Download CSV
              </button>
            </div>

            {currencies.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No invoices issued in this period.</p>
            ) : (
              <div className="space-y-3">
                {currencies.map((currency) => {
                  const b = financialByCurrency[currency]
                  return (
                    <div key={currency} className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                      <p className="text-xs font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>
                        {currency} · {b.count} invoice{b.count === 1 ? '' : 's'}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Invoiced</p>
                          <p className="font-display font-bold">{formatMoney(b.invoiced, currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Paid</p>
                          <p className="font-display font-bold" style={{ color: 'var(--tally-done)' }}>{formatMoney(b.paid, currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Outstanding</p>
                          <p className="font-display font-bold" style={{ color: 'var(--tally-progress)' }}>{formatMoney(b.outstanding, currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Overdue</p>
                          <p className="font-display font-bold" style={{ color: 'var(--tally-alert)' }}>{formatMoney(b.overdue, currency)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {Object.keys(unlinkedInvoiced).length > 0 && (
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Includes invoices not linked to a specific project.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Ticket activity */}
          <section>
            <h2 className="font-display font-bold text-lg mb-3">Ticket activity</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Filed this period</p>
                <p className="font-display font-bold text-lg">{ticketStats.filedCount}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Resolved this period</p>
                <p className="font-display font-bold text-lg" style={{ color: 'var(--tally-done)' }}>{ticketStats.resolvedCount}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Currently open</p>
                <p className="font-display font-bold text-lg">{ticketStats.currentlyOpen}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Avg. resolution time</p>
                <p className="font-display font-bold text-lg">
                  {ticketStats.avgResolutionDays !== null ? `${ticketStats.avgResolutionDays.toFixed(1)}d` : '—'}
                </p>
              </div>
            </div>

            {ticketStats.filedCount > 0 && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                  <p className="text-xs font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>By type</p>
                  {Object.entries(ticketStats.byType).map(([type, count]) => (
                    <div key={type} className="flex justify-between text-sm py-0.5">
                      <span>{TYPE_LABELS[type] || type}</span>
                      <span className="font-mono">{count}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                  <p className="text-xs font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>By priority</p>
                  {Object.entries(ticketStats.byPriority).map(([priority, count]) => (
                    <div key={priority} className="flex justify-between text-sm py-0.5">
                      <span>{PRIORITY_LABELS[priority] || priority}</span>
                      <span className="font-mono">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Project rollup */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-lg">Project rollup</h2>
              <button onClick={handleExportProjectsCSV} className="print:hidden text-sm rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                Download CSV
              </button>
            </div>

            {projects.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No active projects.</p>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => {
                  const counts = taskCountsByProject[project.id] || { done: 0, total: 0 }
                  const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0
                  const invoicedEntries = Object.entries(invoicedByProject[project.id] || {})

                  return (
                    <div key={project.id} className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <TallyDot status={project.status} showLabel={false} />
                          <span className="font-medium text-sm truncate">{project.name}</span>
                        </div>
                        <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                          {invoicedEntries.length > 0
                            ? invoicedEntries.map(([c, amt]) => formatMoney(amt, c)).join(' · ')
                            : 'No invoices this period'}
                        </span>
                      </div>
                      <Scrubber percent={percent} tone={project.status === 'completed' ? 'done' : 'progress'} label={`${project.name} progress`} />
                      <p className="text-xs font-mono mt-1" style={{ color: 'var(--ink-muted)' }}>{counts.done}/{counts.total} tasks done</p>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
