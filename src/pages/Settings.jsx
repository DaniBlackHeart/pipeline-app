import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [wiseLink, setWiseLink] = useState('')
  const [invoicePrefix, setInvoicePrefix] = useState('INV')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('organizations')
      .select('wise_payment_link, invoice_prefix')
      .eq('id', activeOrgId)
      .single()
    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setWiseLink(data.wise_payment_link || '')
    setInvoicePrefix(data.invoice_prefix || 'INV')
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        wise_payment_link: wiseLink.trim() || null,
        invoice_prefix: invoicePrefix.trim() || 'INV',
      })
      .eq('id', activeOrgId)
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setSaved(true)
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  return (
    <div className="max-w-lg">
      <h1 className="font-display font-bold text-2xl mb-1">Settings</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>Workspace: {activeOrg?.name}</p>

      {!isAdmin && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-progress-soft)', color: 'var(--ink)' }}>
          Only workspace owners/admins can change these settings. You can view them here.
        </p>
      )}

      <form onSubmit={handleSubmit} className="rounded-lg border p-5 space-y-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div>
          <label htmlFor="wise-link" className="block text-sm font-medium mb-1">Wise payment link</label>
          <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
            Your permanent Wise Business payment link (from Wise → Payments → "Your open link"). It gets embedded
            on every invoice, along with a reminder for the client to reference the invoice number when they pay.
          </p>
          <input
            id="wise-link"
            type="url"
            value={wiseLink}
            onChange={(e) => setWiseLink(e.target.value)}
            placeholder="https://wise.com/pay/business/yourname"
            disabled={!isAdmin}
            className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        <div>
          <label htmlFor="invoice-prefix" className="block text-sm font-medium mb-1">Invoice number prefix</label>
          <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
            New invoices are numbered automatically, e.g. {invoicePrefix || 'INV'}-0001, {invoicePrefix || 'INV'}-0002…
          </p>
          <input
            id="invoice-prefix"
            type="text"
            value={invoicePrefix}
            onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
            disabled={!isAdmin}
            maxLength={8}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        {error && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
            Settings saved.
          </p>
        )}

        {isAdmin && (
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </form>
    </div>
  )
}
