import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'
import PriorityBadge from '../components/PriorityBadge'

const TYPE_LABELS = { bug: 'Bug', request: 'Request', question: 'Question', other: 'Other' }
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 }

export default function Tickets() {
  const { activeOrgId } = useAuth()
  const [tickets, setTickets] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('open_and_progress')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: ticketRows, error: ticketError }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase
        .from('tickets')
        .select('id, title, type, priority, status, assignee_id, created_at, submitted_by_client')
        .eq('org_id', activeOrgId)
        .order('created_at', { ascending: false }),
      supabase.from('org_members').select('user_id, profiles ( id, full_name )').eq('org_id', activeOrgId),
    ])

    if (ticketError || memberError) {
      setError((ticketError || memberError).message)
      setLoading(false)
      return
    }
    setTickets(ticketRows || [])
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || 'Unassigned'

  const filtered = tickets
    .filter((t) => {
      if (statusFilter === 'all') return true
      if (statusFilter === 'open_and_progress') return t.status === 'open' || t.status === 'in_progress'
      return t.status === statusFilter
    })
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

  const openCount = tickets.filter((t) => t.status === 'open').length
  const inProgressCount = tickets.filter((t) => t.status === 'in_progress').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Tickets</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {openCount} open · {inProgressCount} in progress
          </p>
        </div>
        <Link
          to="/tickets/new"
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          + New ticket
        </Link>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: 'open_and_progress', label: 'Active' },
          { key: 'open', label: 'Open' },
          { key: 'in_progress', label: 'In progress' },
          { key: 'resolved', label: 'Resolved' },
          { key: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className="text-xs font-mono uppercase tracking-wide rounded-full px-3 py-1 border transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: statusFilter === f.key ? 'var(--ink)' : 'transparent',
              color: statusFilter === f.key ? 'var(--panel)' : 'var(--ink-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading tickets…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">Nothing here</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            {statusFilter === 'all' ? 'File your first ticket to get started.' : 'Try a different filter.'}
          </p>
          <Link
            to="/tickets/new"
            className="inline-block rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            + New ticket
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((ticket) => (
            <li key={ticket.id}>
              <Link
                to={`/tickets/${ticket.id}`}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 hover:shadow-sm transition-shadow flex-wrap sm:flex-nowrap"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              >
                <TallyDot status={ticket.status} showLabel={false} />
                <span className="flex-1 text-sm min-w-0 truncate order-1 sm:order-none w-full sm:w-auto">{ticket.title}</span>
                {ticket.submitted_by_client && (
                  <span
                    className="text-xs font-mono uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'var(--tally-progress-soft)', color: 'var(--tally-progress)' }}
                  >
                    Client
                  </span>
                )}
                <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                  {TYPE_LABELS[ticket.type]}
                </span>
                <PriorityBadge priority={ticket.priority} />
                <span className="text-xs flex-shrink-0 hidden sm:inline w-28 text-right truncate" style={{ color: 'var(--ink-muted)' }}>
                  {memberName(ticket.assignee_id)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
