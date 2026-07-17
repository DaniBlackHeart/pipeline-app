import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'
import { formatMoney } from '../lib/currency'

function deriveDisplayStatus(invoice) {
  if (invoice.status === 'sent' && invoice.due_date && new Date(invoice.due_date) < new Date(new Date().toDateString())) {
    return 'overdue'
  }
  return invoice.status
}

export default function Invoices() {
  const { activeOrgId } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')
    const { data, error: fetchError } = await supabase
      .from('invoices')
      .select('id, invoice_number, client_name, status, currency, total_amount, due_date, issue_date')
      .eq('org_id', activeOrgId)
      .order('issue_date', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setInvoices(data || [])
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const filtered = invoices.filter((inv) => {
    if (filter === 'all') return true
    return deriveDisplayStatus(inv) === filter
  })

  const totals = invoices.reduce(
    (acc, inv) => {
      const status = deriveDisplayStatus(inv)
      if (status === 'paid') acc.paid += inv.total_amount
      else if (status === 'overdue') acc.overdue += inv.total_amount
      else if (status === 'sent') acc.outstanding += inv.total_amount
      return acc
    },
    { paid: 0, outstanding: 0, overdue: 0 }
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Invoices</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Track what's out, what's paid, what's overdue.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to="/invoices/recurring"
            className="rounded-md px-4 py-2 text-sm font-medium border"
            style={{ borderColor: 'var(--border)' }}
          >
            Recurring
          </Link>
          <Link
            to="/invoices/new"
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            + New invoice
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Outstanding</p>
          <p className="font-display font-bold text-lg mt-1">{formatMoney(totals.outstanding)}</p>
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--tally-alert)' }}>Overdue</p>
          <p className="font-display font-bold text-lg mt-1" style={{ color: 'var(--tally-alert)' }}>{formatMoney(totals.overdue)}</p>
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--tally-done)' }}>Paid</p>
          <p className="font-display font-bold text-lg mt-1" style={{ color: 'var(--tally-done)' }}>{formatMoney(totals.paid)}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {['all', 'draft', 'sent', 'overdue', 'paid', 'cancelled'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="text-xs font-mono uppercase tracking-wide rounded-full px-3 py-1 border transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: filter === f ? 'var(--ink)' : 'transparent',
              color: filter === f ? 'var(--panel)' : 'var(--ink-muted)',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading invoices…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">No invoices here</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            {filter === 'all' ? 'Create your first invoice to get started.' : 'Try a different filter.'}
          </p>
          {filter === 'all' && (
            <Link
              to="/invoices/new"
              className="inline-block rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              + New invoice
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((invoice) => {
            const displayStatus = deriveDisplayStatus(invoice)
            return (
              <li key={invoice.id}>
                <Link
                  to={`/invoices/${invoice.id}`}
                  className="flex items-center gap-4 rounded-lg border px-4 py-3 hover:shadow-sm transition-shadow"
                  style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
                >
                  <span className="font-mono text-sm flex-shrink-0 w-24">{invoice.invoice_number}</span>
                  <span className="flex-1 text-sm truncate min-w-0">{invoice.client_name}</span>
                  <span className="hidden sm:inline text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {invoice.due_date ? `due ${new Date(invoice.due_date).toLocaleDateString()}` : '—'}
                  </span>
                  <span className="text-sm font-medium flex-shrink-0 w-24 text-right">
                    {formatMoney(invoice.total_amount, invoice.currency)}
                  </span>
                  <span className="flex-shrink-0 w-24 flex justify-end">
                    <TallyDot status={displayStatus} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
