import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'
import { formatMoney } from '../lib/currency'
import { listUnmatchedWiseTransactions, confirmWiseTransactionMatch, ignoreWiseTransaction } from '../lib/wiseReconcile'
import { listUnmatchedStripeEvents, confirmStripeEventMatch, ignoreStripeEvent } from '../lib/stripe'
import { friendlyError } from '../lib/errorMessages'

function deriveDisplayStatus(invoice) {
  if (invoice.status === 'sent' && invoice.due_date && new Date(invoice.due_date) < new Date(new Date().toDateString())) {
    return 'overdue'
  }
  return invoice.status
}

// Renders one line per currency present in the bucket, each formatted with
// its own symbol -- not one combined figure. The common case (everything
// billed in one currency) still renders as a single line exactly like
// before; a workspace mixing currencies gets a short stack instead of one
// wrong number under one arbitrary symbol.
function MoneyStat({ byCurrency, color }) {
  const entries = Object.entries(byCurrency)
  if (entries.length === 0) {
    return <p className="font-display font-bold text-lg mt-1" style={color ? { color } : undefined}>{formatMoney(0)}</p>
  }
  return (
    <div className="mt-1 space-y-0.5">
      {entries.map(([currency, amount]) => (
        <p key={currency} className="font-display font-bold text-lg" style={color ? { color } : undefined}>
          {formatMoney(amount, currency)}
        </p>
      ))}
    </div>
  )
}

export default function Invoices() {
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'
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
      setError(friendlyError(fetchError))
      setLoading(false)
      return
    }
    setInvoices(data || [])
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const [unmatched, setUnmatched] = useState([])
  const [matchPicks, setMatchPicks] = useState({}) // { [transactionId]: invoiceId }
  const [reconcileBusyId, setReconcileBusyId] = useState('')
  const [reconcileError, setReconcileError] = useState('')

  const loadUnmatched = useCallback(async () => {
    if (!activeOrgId || !isAdmin) return
    try {
      setUnmatched(await listUnmatchedWiseTransactions(activeOrgId))
    } catch {
      // Most likely no Wise connection set up (or not eligible) — this
      // panel just stays empty rather than showing an error for
      // something that isn't set up, same philosophy as the Google
      // Calendar card checking `connected` before rendering anything.
    }
  }, [activeOrgId, isAdmin])

  useEffect(() => { loadUnmatched() }, [loadUnmatched])

  const handleConfirmMatch = async (transactionId) => {
    const invoiceId = matchPicks[transactionId]
    if (!invoiceId) return
    setReconcileBusyId(transactionId)
    setReconcileError('')
    try {
      await confirmWiseTransactionMatch(transactionId, invoiceId)
      await Promise.all([loadUnmatched(), load()])
    } catch (err) {
      setReconcileError(friendlyError(err))
    }
    setReconcileBusyId('')
  }

  const handleIgnoreTransaction = async (transactionId) => {
    setReconcileBusyId(transactionId)
    setReconcileError('')
    try {
      await ignoreWiseTransaction(transactionId)
      await loadUnmatched()
    } catch (err) {
      setReconcileError(friendlyError(err))
    }
    setReconcileBusyId('')
  }

  const [unmatchedStripe, setUnmatchedStripe] = useState([])
  const [stripeMatchPicks, setStripeMatchPicks] = useState({}) // { [eventId]: invoiceId }
  const [stripeReconcileBusyId, setStripeReconcileBusyId] = useState('')
  const [stripeReconcileError, setStripeReconcileError] = useState('')

  const loadUnmatchedStripe = useCallback(async () => {
    if (!activeOrgId || !isAdmin) return
    try {
      setUnmatchedStripe(await listUnmatchedStripeEvents(activeOrgId))
    } catch {
      // Same philosophy as loadUnmatched above — most likely just means
      // Stripe isn't connected for this org yet, not a real error.
    }
  }, [activeOrgId, isAdmin])

  useEffect(() => { loadUnmatchedStripe() }, [loadUnmatchedStripe])

  const handleConfirmStripeMatch = async (eventId) => {
    const invoiceId = stripeMatchPicks[eventId]
    if (!invoiceId) return
    setStripeReconcileBusyId(eventId)
    setStripeReconcileError('')
    try {
      await confirmStripeEventMatch(eventId, invoiceId)
      await Promise.all([loadUnmatchedStripe(), load()])
    } catch (err) {
      setStripeReconcileError(friendlyError(err))
    }
    setStripeReconcileBusyId('')
  }

  const handleIgnoreStripeEvent = async (eventId) => {
    setStripeReconcileBusyId(eventId)
    setStripeReconcileError('')
    try {
      await ignoreStripeEvent(eventId)
      await loadUnmatchedStripe()
    } catch (err) {
      setStripeReconcileError(friendlyError(err))
    }
    setStripeReconcileBusyId('')
  }

  const filtered = invoices.filter((inv) => {
    if (filter === 'all') return true
    return deriveDisplayStatus(inv) === filter
  })

  // Bucketed by currency, not summed across currencies -- invoices can be
  // billed in different currencies (see the ClientPicker/InvoiceForm
  // currency field), and adding raw totals together regardless of
  // currency would produce a number that's mathematically meaningless,
  // then get rendered with one arbitrary currency symbol. A workspace
  // billing everyone in the same currency (the common case) still sees a
  // single figure exactly as before; a mixed-currency one sees one line
  // per currency instead of a wrong number.
  const totals = invoices.reduce(
    (acc, inv) => {
      const status = deriveDisplayStatus(inv)
      const bucket = status === 'paid' ? 'paid' : status === 'overdue' ? 'overdue' : status === 'sent' ? 'outstanding' : null
      if (!bucket) return acc
      const currency = inv.currency || 'PHP'
      acc[bucket][currency] = (acc[bucket][currency] || 0) + inv.total_amount
      return acc
    },
    { paid: {}, outstanding: {}, overdue: {} }
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Invoices</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to="/invoices/recurring"
            className="rounded-md px-4 py-2 text-sm font-medium border"
            style={{ borderColor: 'var(--border)' }}
          >
            Recurring
          </Link>
          {isAdmin && (
            <Link
              to="/invoices/new"
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              + New invoice
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Outstanding</p>
          <MoneyStat byCurrency={totals.outstanding} />
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--tally-alert)' }}>Overdue</p>
          <MoneyStat byCurrency={totals.overdue} color="var(--tally-alert)" />
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--tally-done)' }}>Paid</p>
          <MoneyStat byCurrency={totals.paid} color="var(--tally-done)" />
        </div>
      </div>

      {isAdmin && unmatched.length > 0 && (
        <div className="rounded-lg border p-4 mb-6" style={{ background: 'var(--tally-alert-soft)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-base mb-1">Unmatched Wise transactions</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-muted)' }}>
            Money came in but couldn't be matched to an invoice automatically — pick which one it pays for, or ignore it if it's unrelated (a non-invoice deposit, a refund, etc.).
          </p>
          {reconcileError && (
            <p className="text-sm rounded-md px-3 py-2 mb-2" style={{ background: 'var(--panel)', color: 'var(--tally-alert)' }} role="alert">
              {reconcileError}
            </p>
          )}
          <ul className="space-y-2">
            {unmatched.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <span className="text-sm font-mono flex-shrink-0">{formatMoney(t.amount, t.currency)}</span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{new Date(t.transaction_date).toLocaleDateString()}</span>
                {t.reference && <span className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>— "{t.reference}"</span>}
                <select
                  value={matchPicks[t.id] || ''}
                  onChange={(e) => setMatchPicks((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  className="text-sm rounded-md border px-2 py-1.5 ml-auto"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">Match to invoice…</option>
                  {invoices.filter((i) => i.status === 'sent').map((i) => (
                    <option key={i.id} value={i.id}>{i.invoice_number} — {i.client_name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleConfirmMatch(t.id)}
                  disabled={!matchPicks[t.id] || reconcileBusyId === t.id}
                  className="text-xs rounded-md px-3 py-1.5 font-medium disabled:opacity-60"
                  style={{ background: 'var(--ink)', color: 'var(--panel)' }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => handleIgnoreTransaction(t.id)}
                  disabled={reconcileBusyId === t.id}
                  className="text-xs disabled:opacity-60"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  Ignore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && unmatchedStripe.length > 0 && (
        <div className="rounded-lg border p-4 mb-6" style={{ background: 'var(--tally-alert-soft)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-base mb-1">Unmatched Stripe events</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-muted)' }}>
            A Stripe payment came in but couldn't be matched to an invoice automatically — this only happens for a
            payment made through a Stripe Payment Link created outside Pipeline (e.g. by hand in the Stripe
            Dashboard), since links generated from an invoice's own page always match. Pick which invoice it pays
            for, or ignore it if it's unrelated.
          </p>
          {stripeReconcileError && (
            <p className="text-sm rounded-md px-3 py-2 mb-2" style={{ background: 'var(--panel)', color: 'var(--tally-alert)' }} role="alert">
              {stripeReconcileError}
            </p>
          )}
          <ul className="space-y-2">
            {unmatchedStripe.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <span className="text-sm font-mono flex-shrink-0">{e.amount != null ? formatMoney(e.amount, e.currency) : '—'}</span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{new Date(e.created_at).toLocaleDateString()}</span>
                <select
                  value={stripeMatchPicks[e.id] || ''}
                  onChange={(ev) => setStripeMatchPicks((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                  className="text-sm rounded-md border px-2 py-1.5 ml-auto"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">Match to invoice…</option>
                  {invoices.filter((i) => i.status === 'sent').map((i) => (
                    <option key={i.id} value={i.id}>{i.invoice_number} — {i.client_name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleConfirmStripeMatch(e.id)}
                  disabled={!stripeMatchPicks[e.id] || stripeReconcileBusyId === e.id}
                  className="text-xs rounded-md px-3 py-1.5 font-medium disabled:opacity-60"
                  style={{ background: 'var(--ink)', color: 'var(--panel)' }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => handleIgnoreStripeEvent(e.id)}
                  disabled={stripeReconcileBusyId === e.id}
                  className="text-xs disabled:opacity-60"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  Ignore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading invoices…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">No invoices here</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            {filter === 'all'
              ? (isAdmin ? 'Create your first invoice to get started.' : 'No invoices have been created yet.')
              : 'Try a different filter.'}
          </p>
          {filter === 'all' && isAdmin && (
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
