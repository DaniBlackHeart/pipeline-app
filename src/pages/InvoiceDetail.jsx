import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/currency'
import { friendlyError } from '../lib/errorMessages'
import { getStripeStatus, generateStripePaymentLink } from '../lib/stripe'
import ActivityLog from '../components/ActivityLog'
import TallyDot from '../components/TallyDot'

export default function InvoiceDetail() {
  const { invoiceId } = useParams()
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [org, setOrg] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [taskInfo, setTaskInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [stripeConnected, setStripeConnected] = useState(false)
  const [stripeLinkBusy, setStripeLinkBusy] = useState(false)
  const [stripeLinkError, setStripeLinkError] = useState('')

  useEffect(() => {
    if (!activeOrgId) return
    getStripeStatus(activeOrgId).then((s) => setStripeConnected(s.connected)).catch(() => {})
  }, [activeOrgId])

  const handleGenerateStripeLink = async () => {
    setStripeLinkBusy(true)
    setStripeLinkError('')
    try {
      const { url } = await generateStripePaymentLink(activeOrgId, invoiceId)
      setInvoice((prev) => ({ ...prev, stripe_payment_link: url, stripe_link_amount: prev.total_amount, stripe_link_currency: prev.currency }))
    } catch (err) {
      setStripeLinkError(err.message)
    }
    setStripeLinkBusy(false)
  }

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: invoiceRow, error: invoiceError }, { data: itemRows, error: itemsError }, { data: orgRow, error: orgError }] =
      await Promise.all([
        supabase.from('invoices').select('*').eq('id', invoiceId).single(),
        supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('position', { ascending: true }),
        supabase.from('organizations').select('name, wise_payment_link, biller_name, biller_company, biller_address').eq('id', activeOrgId).single(),
      ])

    if (invoiceError || itemsError || orgError) {
      setError(friendlyError(invoiceError || itemsError || orgError))
      setLoading(false)
      return
    }

    setInvoice(invoiceRow)
    setItems(itemRows || [])
    setOrg(orgRow)

    if (invoiceRow.project_id) {
      const { data: projectRow } = await supabase.from('projects').select('name').eq('id', invoiceRow.project_id).single()
      setProjectName(projectRow?.name || '')
    } else if (invoiceRow.task_id) {
      const { data: taskRow } = await supabase.from('tasks').select('id, title, deleted_at').eq('id', invoiceRow.task_id).single()
      setTaskInfo(taskRow || null)
    }

    setLoading(false)
  }, [invoiceId, activeOrgId])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (status) => {
    const fields = { status, paid_at: status === 'paid' ? new Date().toISOString() : null }
    setInvoice((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('invoices').update(fields).eq('id', invoiceId)
    if (updateError) setError(friendlyError(updateError))
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
          {isAdmin ? (
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
          ) : (
            <TallyDot status={isOverdue ? 'overdue' : invoice.status} />
          )}
          {isAdmin && (
            <Link
              to={`/invoices/${invoiceId}/edit`}
              className="text-sm rounded-md border px-3 py-1.5"
              style={{ borderColor: 'var(--border)' }}
            >
              Edit
            </Link>
          )}
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
        <p className="text-sm rounded-md px-3 py-2 mb-4 print:hidden" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {isOverdue && (
        <p className="text-sm rounded-md px-3 py-2 mb-4 print:hidden" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }}>
          This invoice is overdue.
        </p>
      )}

      {/* Printable invoice body */}
      <div className="rounded-lg border p-8 print:border-0 print:rounded-none print:p-0" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
          <div>
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
          <div className="text-right">
            <p className="font-display font-bold text-2xl tracking-wide">{org?.biller_name || org?.name}</p>
            {org?.biller_company && (
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{org.biller_company}</p>
            )}
            {org?.biller_address && (
              <p className="text-xs whitespace-pre-line mt-1" style={{ color: 'var(--ink-muted)' }}>{org.biller_address}</p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Bill to</p>
            <p className="text-sm font-medium">{invoice.client_name}</p>
            {invoice.client_email && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{invoice.client_email}</p>}
            {invoice.client_id && (
              <p className="text-sm print:hidden">
                <Link to={`/clients/${invoice.client_id}`} className="underline">View client</Link>
              </p>
            )}
          </div>
          {projectName && (
            <div className="sm:text-right">
              <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Project</p>
              <p className="text-sm">{projectName}</p>
            </div>
          )}
          {taskInfo && (
            <div className="sm:text-right">
              <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Task</p>
              <Link to={`/tasks/${taskInfo.id}`} className="text-sm underline">
                {taskInfo.title}{taskInfo.deleted_at ? ' (deleted)' : ''}
              </Link>
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

        <div className="space-y-3">
          {org?.wise_payment_link && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel-sunken)' }}>
              <p className="text-sm font-medium mb-1">Pay via Wise</p>
              <p className="text-sm mb-2">
                <a href={org.wise_payment_link} target="_blank" rel="noreferrer" className="underline break-all">
                  {org.wise_payment_link}
                </a>
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Please include <span className="font-mono">{invoice.invoice_number}</span> as the payment reference so it can be matched to this invoice.
              </p>
            </div>
          )}

          {(stripeConnected || invoice.stripe_payment_link) && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel-sunken)' }}>
              {(() => {
                const linkIsCurrent = invoice.stripe_payment_link
                  && Number(invoice.stripe_link_amount) === Number(invoice.total_amount)
                  && invoice.stripe_link_currency === invoice.currency
                if (linkIsCurrent) {
                  return (
                    <>
                      <p className="text-sm font-medium mb-1">Pay with Stripe</p>
                      <p className="text-sm mb-2">
                        <a href={invoice.stripe_payment_link} target="_blank" rel="noreferrer" className="underline break-all">
                          {invoice.stripe_payment_link}
                        </a>
                      </p>
                      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                        No reference to remember — Stripe marks this exact invoice paid automatically the moment this
                        link is paid.
                      </p>
                    </>
                  )
                }
                if (invoice.stripe_payment_link) {
                  return (
                    <p className="text-sm print:hidden" style={{ color: 'var(--tally-alert)' }}>
                      This invoice's Stripe link was generated for a different amount — regenerate it below before sending.
                    </p>
                  )
                }
                return (
                  <p className="text-sm print:hidden" style={{ color: 'var(--ink-muted)' }}>
                    No Stripe payment link on this invoice yet.
                  </p>
                )
              })()}
              {isAdmin && stripeConnected && (
                <div className="print:hidden mt-2">
                  <button
                    type="button"
                    onClick={handleGenerateStripeLink}
                    disabled={stripeLinkBusy}
                    className="text-sm rounded-md border px-3 py-1.5 disabled:opacity-60"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {stripeLinkBusy ? 'Generating…' : invoice.stripe_payment_link ? 'Regenerate Stripe payment link' : 'Generate Stripe payment link'}
                  </button>
                  {stripeLinkError && (
                    <p className="text-xs mt-2" style={{ color: 'var(--tally-alert)' }}>{stripeLinkError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {!org?.wise_payment_link && !stripeConnected && !invoice.stripe_payment_link && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel-sunken)' }}>
              <p className="text-sm print:hidden" style={{ color: 'var(--ink-muted)' }}>
                No payment link on file yet. Add either your Wise or Stripe payment link in{' '}
                <Link to="/settings" className="underline">Settings</Link> to have it appear here automatically.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="print:hidden">
        <ActivityLog entityType="invoice" entityId={invoiceId} />
      </div>
    </div>
  )
}
