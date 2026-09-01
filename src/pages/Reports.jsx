import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { dateKey } from '../lib/calendarUtils'
import { getPresetRange, RANGE_PRESETS, formatRangeLabel } from '../lib/dateRange'
import { downloadCSV } from '../lib/csv'
import { formatMoney } from '../lib/currency'
import Scrubber from '../components/Scrubber'
import TallyDot from '../components/TallyDot'
import GanttChart from '../components/GanttChart'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'

const TYPE_LABELS = { bug: 'Bug', request: 'Request', question: 'Question', other: 'Other' }
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }
const STATUS_GROUPS = [
  { key: 'todo', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Completed' },
]
const TABS = [
  { key: 'financial', label: 'Financial summary' },
  { key: 'tickets', label: 'Ticket activity' },
  { key: 'projects', label: 'Project rollup' },
  { key: 'timeline', label: 'Timeline' },
]

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
  const { activeOrgId, activeOrg, user } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [activeTab, setActiveTab] = useState('financial')
  const [preset, setPreset] = useState('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [invoices, setInvoices] = useState([])
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [taskAssignees, setTaskAssignees] = useState([])
  const [notesCounts, setNotesCounts] = useState({})
  const [members, setMembers] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expandedProjects, setExpandedProjects] = useState({})
  const [standaloneExpanded, setStandaloneExpanded] = useState(false)

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

    const [
      { data: invoiceRows, error: invoiceError },
      { data: projectRows, error: projectError },
      { data: taskRows, error: taskError },
      { data: assigneeRows, error: assigneeError },
      { data: commentRows, error: commentError },
      { data: memberRows, error: memberError },
      { data: ticketRows, error: ticketError },
    ] = await Promise.all([
      invoiceQuery,
      supabase.from('projects').select('id, name, status, start_date, due_date').eq('org_id', activeOrgId).neq('status', 'archived'),
      supabase.from('tasks').select('id, title, status, project_id, start_date, due_date, assignee_id').eq('org_id', activeOrgId),
      supabase.from('task_assignees').select('task_id, user_id, role_label, profiles ( full_name, nickname )').eq('org_id', activeOrgId),
      supabase.from('task_comments').select('task_id').eq('org_id', activeOrgId),
      supabase.from('org_members').select('user_id, profiles ( id, full_name, nickname )').eq('org_id', activeOrgId),
      supabase.from('tickets').select('id, title, type, priority, status, project_id, created_at, resolved_at').eq('org_id', activeOrgId),
    ])

    const firstError = invoiceError || projectError || taskError || assigneeError || commentError || memberError || ticketError
    if (firstError) {
      setError(friendlyError(firstError))
      setLoading(false)
      return
    }

    setInvoices(invoiceRows || [])
    setProjects(projectRows || [])
    setTasks(taskRows || [])
    setTaskAssignees(assigneeRows || [])
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))

    const counts = {}
    for (const row of commentRows || []) counts[row.task_id] = (counts[row.task_id] || 0) + 1
    setNotesCounts(counts)

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

  // ---- Task grouping + visibility ----
  const taskAssigneesByTaskId = useMemo(() => {
    const map = {}
    for (const row of taskAssignees) {
      map[row.task_id] ??= []
      map[row.task_id].push({ user_id: row.user_id, role_label: row.role_label, name: getDisplayName(row.profiles, 'Member') })
    }
    return map
  }, [taskAssignees])

  const membersById = useMemo(() => {
    const map = {}
    for (const m of members) map[m.id] = getDisplayName(m, 'Member')
    return map
  }, [members])

  const isTaskVisible = useCallback((task) => {
    if (isAdmin) return true
    if (!user) return false
    if (task.assignee_id === user.id) return true
    return (taskAssigneesByTaskId[task.id] || []).some((a) => a.user_id === user.id)
  }, [isAdmin, user, taskAssigneesByTaskId])

  const getAssigneeDisplay = useCallback((task) => {
    const names = []
    if (task.assignee_id) names.push(membersById[task.assignee_id] || 'Member')
    for (const a of (taskAssigneesByTaskId[task.id] || [])) {
      if (a.user_id === task.assignee_id) continue
      names.push(a.role_label ? `${a.name} (${a.role_label})` : a.name)
    }
    return names.length > 0 ? names.join(', ') : 'Unassigned'
  }, [membersById, taskAssigneesByTaskId])

  const visibleTasks = useMemo(() => tasks.filter(isTaskVisible), [tasks, isTaskVisible])

  const tasksByProjectId = useMemo(() => {
    const map = {}
    for (const t of visibleTasks) {
      const key = t.project_id || '__standalone__'
      map[key] ??= []
      map[key].push(t)
    }
    return map
  }, [visibleTasks])

  const taskCountsByProject = useMemo(() => {
    // Counts for the Scrubber always reflect the WHOLE project (every
    // member's tasks), even for a non-admin whose drill-down list below is
    // filtered to just their own — otherwise the progress bar would look
    // wrong/inconsistent with reality.
    const counts = {}
    for (const t of tasks) {
      counts[t.project_id] ??= { done: 0, total: 0 }
      counts[t.project_id].total += 1
      if (t.status === 'done') counts[t.project_id].done += 1
    }
    return counts
  }, [tasks])

  const groupTasksByStatus = (list) => {
    const groups = { todo: [], in_progress: [], done: [] }
    for (const t of list) groups[t.status]?.push(t)
    return groups
  }

  const standaloneTasks = tasksByProjectId['__standalone__'] || []

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

  // ---- Timeline (Gantt) ----
  // True if [itemStart, itemEnd] (date-key strings) overlaps the selected
  // report range at all — same "null bound = unbounded" rule withinRange
  // above uses, just applied to a span instead of a single date.
  const rangesOverlap = (itemStart, itemEnd, rangeStart, rangeEnd) => {
    if (rangeEnd && itemStart > rangeEnd) return false
    if (rangeStart && itemEnd < rangeStart) return false
    return true
  }

  const projectNameById = useMemo(() => {
    const map = {}
    for (const p of projects) map[p.id] = p.name
    return map
  }, [projects])

  const fmtShort = (isoOrKey) => new Date(dateKey(isoOrKey)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  const ganttLanes = useMemo(() => {
    const todayKey = dateKey(new Date())

    const projectItems = projects
      .filter((p) => rangesOverlap(p.start_date, p.due_date, range.start, range.end))
      .map((p) => ({
        id: p.id,
        label: p.name,
        status: p.status,
        href: `/projects/${p.id}`,
        start: p.start_date,
        end: p.due_date,
        tooltip: `${p.name} — ${fmtShort(p.start_date)} to ${fmtShort(p.due_date)}`,
      }))

    const taskItems = tasks
      .filter((t) => t.start_date || t.due_date) // no dates at all -> nothing to plot
      .map((t) => {
        const start = t.start_date || t.due_date
        const end = t.due_date || t.start_date
        return { t, start, end: end < start ? start : end }
      })
      .filter(({ start, end }) => rangesOverlap(start, end, range.start, range.end))
      .map(({ t, start, end }) => ({
        id: t.id,
        label: t.title,
        status: t.status,
        href: `/tasks/${t.id}`,
        start,
        end,
        tooltip: `${t.title} (${t.project_id ? projectNameById[t.project_id] || 'project' : 'Standalone'}) — ${fmtShort(start)} to ${fmtShort(end)}`,
      }))

    const ticketItems = tickets
      .map((tk) => {
        const start = dateKey(tk.created_at)
        const end = tk.resolved_at ? dateKey(tk.resolved_at) : todayKey
        return { tk, start, end }
      })
      .filter(({ start, end }) => rangesOverlap(start, end, range.start, range.end))
      .map(({ tk, start, end }) => ({
        id: tk.id,
        label: tk.title,
        status: tk.status,
        href: `/tickets/${tk.id}`,
        start,
        end,
        tooltip: `${tk.title} — filed ${fmtShort(start)}${tk.resolved_at ? `, resolved ${fmtShort(end)}` : ' (still open)'}`,
      }))

    const invoiceItems = invoices.map((inv) => {
      const start = inv.issue_date
      const end = inv.due_date && inv.due_date > start ? inv.due_date : start
      const effectiveStatus = inv.status === 'sent' && inv.due_date && inv.due_date < todayKey ? 'overdue' : inv.status
      return {
        id: inv.id,
        label: `${inv.invoice_number} · ${inv.client_name}`,
        status: effectiveStatus,
        href: `/invoices/${inv.id}`,
        start,
        end,
        tooltip: `${inv.invoice_number} · ${inv.client_name} — issued ${fmtShort(start)}${inv.due_date ? `, due ${fmtShort(inv.due_date)}` : ''}`,
      }
    })
    // invoices are already loaded pre-filtered to the selected range by issue_date server-side

    return [
      { key: 'projects', label: 'Projects', items: projectItems },
      { key: 'tasks', label: 'Tasks', items: taskItems },
      { key: 'tickets', label: 'Tickets', items: ticketItems },
      { key: 'invoices', label: 'Invoices', items: invoiceItems },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, tasks, tickets, invoices, projectNameById, range.start, range.end])

  const ganttBounds = useMemo(() => {
    if (range.start && range.end) return { start: range.start, end: range.end }
    const allDates = []
    for (const lane of ganttLanes) for (const item of lane.items) { allDates.push(item.start, item.end) }
    const valid = allDates.filter(Boolean).sort()
    if (valid.length === 0) {
      const today = new Date()
      const start = new Date(today); start.setDate(start.getDate() - 15)
      const end = new Date(today); end.setDate(end.getDate() + 15)
      return { start: dateKey(start), end: dateKey(end) }
    }
    let start = range.start || valid[0]
    let end = range.end || valid[valid.length - 1]
    if (start > end) { const tmp = start; start = end; end = tmp }
    return { start, end }
  }, [range.start, range.end, ganttLanes])

  const currencies = Object.keys(financialByCurrency)

  // Non-admins only ever see the Project rollup (scoped to their own tasks) —
  // no Financial summary, no Ticket activity. Derived rather than stored so
  // there's no race with activeOrg's role loading in async.
  const effectiveTab = isAdmin ? activeTab : 'projects'

  const toggleProject = (projectId) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !prev[projectId] }))
  }

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

  const handleExportTasksCSV = () => {
    const projectNameById = {}
    for (const p of projects) projectNameById[p.id] = p.name
    downloadCSV('tasks.csv', visibleTasks.map((t) => ({
      project: t.project_id ? (projectNameById[t.project_id] || '') : 'Standalone',
      title: t.title,
      status: t.status,
      start_date: t.start_date || '',
      due_date: t.due_date || '',
      assigned_to: getAssigneeDisplay(t),
      notes: notesCounts[t.id] || 0,
    })))
  }

  const renderTaskRow = (task) => (
    <li key={task.id}>
      <Link
        to={`/tasks/${task.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 hover:shadow-sm transition-shadow text-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="min-w-0 truncate underline flex-shrink-0" style={{ maxWidth: '220px' }}>{task.title}</span>
        <TallyDot status={task.status} />
        <span style={{ color: 'var(--ink-muted)' }} className="text-xs truncate">{getAssigneeDisplay(task)}</span>
        {task.start_date && <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>from {new Date(task.start_date).toLocaleDateString()}</span>}
        {task.due_date && <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>due {new Date(task.due_date).toLocaleDateString()}</span>}
        {notesCounts[task.id] > 0 && (
          <span className="text-xs font-mono rounded-full px-2 py-0.5" style={{ background: 'var(--panel-sunken)', color: 'var(--ink-muted)' }}>
            {notesCounts[task.id]} note{notesCounts[task.id] === 1 ? '' : 's'}
          </span>
        )}
      </Link>
    </li>
  )

  const renderStatusGroups = (list) => {
    const groups = groupTasksByStatus(list)
    if (list.length === 0) {
      return <p className="text-sm py-2" style={{ color: 'var(--ink-muted)' }}>No tasks{!isAdmin ? ' assigned to you' : ''} here.</p>
    }
    return (
      <div className="space-y-4 mt-2">
        {STATUS_GROUPS.map((g) => (
          groups[g.key].length > 0 && (
            <div key={g.key}>
              <p className="text-xs font-mono uppercase tracking-wide mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                {g.label} · {groups[g.key].length}
              </p>
              <ul className="space-y-1.5">{groups[g.key].map(renderTaskRow)}</ul>
            </div>
          )
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="print:hidden flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Reports</h1>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          Print / Save as PDF
        </button>
      </div>

      {isAdmin && (
      <div className="print:hidden flex items-center gap-2 mb-4 flex-wrap">
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
      )}

      {isAdmin && (
        <div className="print:hidden flex items-center gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="text-sm px-3 py-2.5 border-b-2 transition-colors"
              style={{
                borderColor: activeTab === tab.key ? 'var(--ink)' : 'transparent',
                color: activeTab === tab.key ? 'var(--ink)' : 'var(--ink-muted)',
                fontWeight: activeTab === tab.key ? 500 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Print-only letterhead */}
      <div className="hidden print:block mb-6">
        <p className="font-display font-bold text-xl">{activeOrg?.name}</p>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Report for {formatRangeLabel(range.start, range.end)} — generated {new Date().toLocaleDateString()}
        </p>
        {!isAdmin && (
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>Task lists below are scoped to tasks assigned to you.</p>
        )}
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading report…</p>
      ) : (
        <div className="space-y-8">
          {/* Financial summary — admins only */}
          {isAdmin && (
          <section className={effectiveTab === 'financial' ? '' : 'hidden print:block'}>
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
          )}

          {/* Ticket activity — admins only */}
          {isAdmin && (
          <section className={effectiveTab === 'tickets' ? '' : 'hidden print:block'}>
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
          )}

          {/* Project rollup */}
          <section className={effectiveTab === 'projects' ? '' : 'hidden print:block'}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-lg">Project rollup</h2>
              <div className="flex gap-2 print:hidden">
                <button onClick={handleExportTasksCSV} className="text-sm rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                  Download tasks CSV
                </button>
                <button onClick={handleExportProjectsCSV} className="text-sm rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                  Download CSV
                </button>
              </div>
            </div>

            {!isAdmin && (
              <p className="text-xs mb-3 print:hidden" style={{ color: 'var(--ink-muted)' }}>
                Progress bars reflect the whole project; task lists below are scoped to tasks assigned to you.
              </p>
            )}

            {projects.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No active projects.</p>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => {
                  const counts = taskCountsByProject[project.id] || { done: 0, total: 0 }
                  const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0
                  const invoicedEntries = Object.entries(invoicedByProject[project.id] || {})
                  const projectTasks = tasksByProjectId[project.id] || []
                  const isExpanded = !!expandedProjects[project.id]

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
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>{counts.done}/{counts.total} tasks done</p>
                        <button
                          onClick={() => toggleProject(project.id)}
                          className="text-xs font-mono uppercase tracking-wide print:hidden"
                          style={{ color: 'var(--tally-progress)' }}
                        >
                          {isExpanded ? 'Hide tasks' : `Show tasks (${projectTasks.length})`}
                        </button>
                      </div>
                      <div className={isExpanded ? '' : 'hidden print:block'}>
                        {renderStatusGroups(projectTasks)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Standalone tasks */}
            <div className="rounded-lg border p-4 mt-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">Standalone tasks</span>
                <button
                  onClick={() => setStandaloneExpanded((v) => !v)}
                  className="text-xs font-mono uppercase tracking-wide print:hidden"
                  style={{ color: 'var(--tally-progress)' }}
                >
                  {standaloneExpanded ? 'Hide tasks' : `Show tasks (${standaloneTasks.length})`}
                </button>
              </div>
              <div className={standaloneExpanded ? '' : 'hidden print:block'}>
                {renderStatusGroups(standaloneTasks)}
              </div>
            </div>
          </section>

          {/* Timeline — admins only, same date-range preset above as its zoom control */}
          {isAdmin && (
          <section className={effectiveTab === 'timeline' ? '' : 'hidden print:block'}>
            <h2 className="font-display font-bold text-lg mb-3">Timeline</h2>
            <GanttChart lanes={ganttLanes} bounds={ganttBounds} />
          </section>
          )}
        </div>
      )}
    </div>
  )
}
