import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/currency'

export default function InvoiceDetail() {
  const { invoiceId } = useParams()
  const { activeOrgId } = useAuth()

  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [org, setOrg] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: invoiceRow, error: invoiceError }, { data: itemRows, error: itemsError }, { data: orgRow, error: orgError }] =
      await Promise.all([
        supabase.from('invoices').select('*').eq('id', invoiceId).single(),
        supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('position', { ascending: true }),
        supabase.from('organizations').select('name, wise_payment_link').eq('id', activeOrgId).single(),
      ])

    if (invoiceError || itemsError || orgError) {
      setError((invoiceError || itemsError || orgError).message)
      setLoading(false)
      return
    }

    setInvoice(invoiceRow)
    setItems(itemRows || [])
    setOrg(orgRow)

    if (invoiceRow.project_id) {
      const { data: projectRow } = await supabase.from('projects').select('name').eq('id', invoiceRow.project_id).single()
      setProjectName(projectRow?.name || '')
    }

    setLoading(false)
  }, [invoiceId, activeOrgId])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (status) => {
    const fields = { status, paid_at: status === 'paid' ? new Date().toISOString() : null }
    setInvoice((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('invoices').update(fields).eq('id', invoiceId)
    if (updateError) setError(updateError.message)
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  if (!invoice) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Invoice not found, or you don't have access.</p>
        <Link to="/invoices" className="text-sm underline">Back to invoices</Link>
      </div>
    )
  }

  const isOverdue = invoice.status === 'sent' && invoice.due_date && new Date(invoice.due_date) < new Date(new Date().toDateString())

  return (
    <div>
      <div className="print:hidden flex items-center justify-between mb-4 flex-wrap gap-3">
        <Link to="/invoices" className="text-sm" style={{ color: 'var(--ink-muted)' }}>&larr; All invoices</Link>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={invoice.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="text-xs font-mono uppercase rounded-md border px-2 py-1.5"
            style={{ borderColor: 'var(--border)' }}
            aria-label="Invoice status"
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Link
            to={`/invoices/${invoiceId}/edit`}
            className="text-sm rounded-md border px-3 py-1.5"
            style={{ borderColor: 'var(--border)' }}
          >
            Edit
          </Link>
          <button
            onClick={() => window.print()}
            className="text-sm rounded-md px-3 py-1.5"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4 print:hidden" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      {isOverdue && (
        <p className="text-sm rounded-md px-3 py-2 mb-4 print:hidden" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }}>
          This invoice is overdue.
        </p>
      )}

      {/* Printable invoice body */}
      <div className="rounded-lg border p-8 print:border-0 print:rounded-none print:p-0" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
          <div>
            <p className="font-display font-bold text-2xl">{org?.name || 'Invoice'}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-medium">{invoice.invoice_number}</p>
            <p className="text-xs font-mono mt-1" style={{ color: 'var(--ink-muted)' }}>
              Issued {new Date(invoice.issue_date).toLocaleDateString()}
            </p>
            {invoice.due_date && (
              <p className="text-xs font-mono" style={{ color: isOverdue ? 'var(--tally-alert)' : 'var(--ink-muted)' }}>
                Due {new Date(invoice.due_date).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Bill to</p>
            <p className="text-sm font-medium">{invoice.client_name}</p>
            {invoice.client_email && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{invoice.client_email}</p>}
          </div>
          {projectName && (
            <div className="sm:text-right">
              <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Project</p>
              <p className="text-sm">{projectName}</p>
            </div>
          )}
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
              <th className="text-left font-mono text-xs uppercase tracking-wide py-2" style={{ color: 'var(--ink-muted)' }}>Description</th>
              <th className="text-right font-mono text-xs uppercase tracking-wide py-2" style={{ color: 'var(--ink-muted)' }}>Qty</th>
              <th className="text-right font-mono text-xs uppercase tracking-wide py-2" style={{ color: 'var(--ink-muted)' }}>Rate</th>
              <th className="text-right font-mono text-xs uppercase tracking-wide py-2" style={{ color: 'var(--ink-muted)' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                <td className="py-2 pr-2">{item.description}</td>
                <td className="py-2 text-right font-mono">{item.quantity}</td>
                <td className="py-2 text-right font-mono">{formatMoney(item.rate, invoice.currency)}</td>
                <td className="py-2 text-right font-mono">{formatMoney(item.quantity * item.rate, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <div className="text-right">
            <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Total due</p>
            <p className="font-display font-bold text-2xl">{formatMoney(invoice.total_amount, invoice.currency)}</p>
          </div>
        </div>

        {invoice.notes && (
          <div className="mb-8 text-sm">
            <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Notes</p>
            <p>{invoice.notes}</p>
          </div>
        )}

        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel-sunken)' }}>
          {org?.wise_payment_link ? (
            <>
              <p className="text-sm font-medium mb-1">Pay via Wise</p>
              <p className="text-sm mb-2">
                <a href={org.wise_payment_link} target="_blank" rel="noreferrer" className="underline break-all">
                  {org.wise_payment_link}
                </a>
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Please include <span className="font-mono">{invoice.invoice_number}</span> as the payment reference so it can be matched to this invoice.
              </p>
            </>
          ) : (
            <p className="text-sm print:hidden" style={{ color: 'var(--ink-muted)' }}>
              No payment link on file yet. Add your Wise payment link in{' '}
              <Link to="/settings" className="underline">Settings</Link> to have it appear here automatically.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
