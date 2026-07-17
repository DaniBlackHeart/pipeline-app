import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/currency'

const INTERVAL_LABELS = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }

export default function RecurringInvoices() {
  const { activeOrgId } = useAuth()
  const [templates, setTemplates] = useState([])
  const [totalsByTemplate, setTotalsByTemplate] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [generatingId, setGeneratingId] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: templateRows, error: templateError }, { data: itemRows, error: itemError }] = await Promise.all([
      supabase
        .from('recurring_invoice_templates')
        .select('id, client_name, currency, recurrence_interval, next_run_date, active')
        .eq('org_id', activeOrgId)
        .order('created_at', { ascending: false }),
      supabase.from('recurring_invoice_items').select('template_id, quantity, rate').eq('org_id', activeOrgId),
    ])

    if (templateError || itemError) {
      setError((templateError || itemError).message)
      setLoading(false)
      return
    }

    const totals = {}
    for (const item of itemRows || []) {
      totals[item.template_id] = (totals[item.template_id] || 0) + item.quantity * item.rate
    }

    setTemplates(templateRows || [])
    setTotalsByTemplate(totals)
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const handleGenerateNow = async (templateId) => {
    setGeneratingId(templateId)
    setError('')
    setNotice('')
    const { data: newInvoiceId, error: rpcError } = await supabase.rpc('generate_invoice_from_template', {
      template_id_param: templateId,
    })
    setGeneratingId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setNotice(`Invoice generated.`)
    load()
    return newInvoiceId
  }

  const toggleActive = async (template) => {
    setTemplates((prev) => prev.map((t) => (t.id === template.id ? { ...t, active: !t.active } : t)))
    const { error: updateError } = await supabase
      .from('recurring_invoice_templates')
      .update({ active: !template.active })
      .eq('id', template.id)
    if (updateError) setError(updateError.message)
  }

  const isDue = (nextRunDate) => nextRunDate <= new Date().toISOString().slice(0, 10)

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <Link to="/invoices" className="text-sm" style={{ color: 'var(--ink-muted)' }}>&larr; All invoices</Link>
          <h1 className="font-display font-bold text-2xl tracking-tight mt-1">Recurring invoices</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            For retainer clients — set it up once, generate each period with one click (or fully automate it, see SETUP.md).
          </p>
        </div>
        <Link
          to="/invoices/recurring/new"
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          + New recurring invoice
        </Link>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">No recurring invoices yet</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            Set one up for a retainer client and stop re-entering the same invoice every month.
          </p>
          <Link
            to="/invoices/recurring/new"
            className="inline-block rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            + New recurring invoice
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => {
            const due = template.active && isDue(template.next_run_date)
            const amount = totalsByTemplate[template.id] || 0
            return (
              <li key={template.id} className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{template.client_name}</span>
                      {!template.active && (
                        <span className="text-xs font-mono uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>
                          Paused
                        </span>
                      )}
                      {due && (
                        <span className="text-xs font-mono uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: 'var(--tally-progress-soft)', color: 'var(--tally-progress)' }}>
                          Due now
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      {INTERVAL_LABELS[template.recurrence_interval]} · {formatMoney(amount, template.currency)} · next {new Date(template.next_run_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(template)}
                      className="text-xs rounded-md border px-2.5 py-1.5"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {template.active ? 'Pause' : 'Resume'}
                    </button>
                    <Link
                      to={`/invoices/recurring/${template.id}/edit`}
                      className="text-xs rounded-md border px-2.5 py-1.5"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleGenerateNow(template.id)}
                      disabled={generatingId === template.id || !template.active}
                      className="text-xs rounded-md px-3 py-1.5 font-medium disabled:opacity-60"
                      style={{ background: 'var(--ink)', color: 'var(--panel)' }}
                    >
                      {generatingId === template.id ? 'Generating…' : 'Generate now'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
