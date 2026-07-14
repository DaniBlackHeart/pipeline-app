import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CURRENCIES } from '../lib/currency'

let tempIdCounter = 0
const nextTempId = () => `temp-${++tempIdCounter}`

const emptyItem = () => ({ id: nextTempId(), description: '', quantity: 1, rate: 0 })

export default function InvoiceForm() {
  const { invoiceId } = useParams()
  const isEditing = Boolean(invoiceId)
  const { activeOrgId } = useAuth()
  const navigate = useNavigate()

  const [projects, setProjects] = useState([])
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [projectId, setProjectId] = useState('')
  const [currency, setCurrency] = useState('PHP')
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadExisting = useCallback(async () => {
    if (!isEditing) return
    setLoading(true)
    const [{ data: invoice, error: invoiceError }, { data: invoiceItems, error: itemsError }] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('position', { ascending: true }),
    ])
    if (invoiceError || itemsError) {
      setError((invoiceError || itemsError).message)
      setLoading(false)
      return
    }
    setClientName(invoice.client_name || '')
    setClientEmail(invoice.client_email || '')
    setProjectId(invoice.project_id || '')
    setCurrency(invoice.currency || 'PHP')
    setIssueDate(invoice.issue_date || '')
    setDueDate(invoice.due_date || '')
    setNotes(invoice.notes || '')
    setItems(
      (invoiceItems || []).length > 0
        ? invoiceItems.map((it) => ({ id: it.id, description: it.description, quantity: it.quantity, rate: it.rate }))
        : [emptyItem()]
    )
    setLoading(false)
  }, [invoiceId, isEditing])

  useEffect(() => {
    if (!activeOrgId) return
    supabase
      .from('projects')
      .select('id, name')
      .eq('org_id', activeOrgId)
      .neq('status', 'archived')
      .order('name', { ascending: true })
      .then(({ data, error: projectError }) => {
        if (projectError) setError(projectError.message)
        else setProjects(data || [])
      })
  }, [activeOrgId])

  useEffect(() => { loadExisting() }, [loadExisting])

  const updateItem = (id, field, value) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)))
  }

  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const removeItem = (id) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev))

  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!clientName.trim()) {
      setError('Enter the client name.')
      return
    }
    const validItems = items.filter((it) => it.description.trim())
    if (validItems.length === 0) {
      setError('Add at least one line item.')
      return
    }

    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()

    const invoicePayload = {
      org_id: activeOrgId,
      project_id: projectId || null,
      client_name: clientName.trim(),
      client_email: clientEmail.trim() || null,
      currency,
      issue_date: issueDate,
      due_date: dueDate || null,
      notes: notes.trim() || null,
    }

    let targetInvoiceId = invoiceId

    if (isEditing) {
      const { error: updateError } = await supabase.from('invoices').update(invoicePayload).eq('id', invoiceId)
      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
      // Simplest reliable sync for a small line-item list: replace all items.
      const { error: deleteError } = await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)
      if (deleteError) {
        setError(deleteError.message)
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('invoices')
        .insert({ ...invoicePayload, created_by: userData?.user?.id })
        .select('id')
        .single()
      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
      targetInvoiceId = inserted.id
    }

    const itemRows = validItems.map((it, index) => ({
      invoice_id: targetInvoiceId,
      org_id: activeOrgId,
      description: it.description.trim(),
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      position: index,
    }))

    const { error: itemsInsertError } = await supabase.from('invoice_items').insert(itemRows)
    setSaving(false)
    if (itemsInsertError) {
      setError(itemsInsertError.message)
      return
    }

    navigate(`/invoices/${targetInvoiceId}`)
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  return (
    <div>
      <Link to="/invoices" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; All invoices</Link>

      <h1 className="font-display font-bold text-2xl mb-6">{isEditing ? 'Edit invoice' : 'New invoice'}</h1>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="client-name" className="block text-sm font-medium mb-1">Client name</label>
              <input
                id="client-name"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                required
              />
            </div>
            <div>
              <label htmlFor="client-email" className="block text-sm font-medium mb-1">Client email (optional)</label>
              <input
                id="client-email"
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="linked-project" className="block text-sm font-medium mb-1">Linked project (optional)</label>
              <select
                id="linked-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">No linked project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="currency" className="block text-sm font-medium mb-1">Currency</label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="issue-date" className="block text-sm font-medium mb-1">Issue date</label>
              <input
                id="issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                required
              />
            </div>
            <div>
              <label htmlFor="due-date" className="block text-sm font-medium mb-1">Due date (optional)</label>
              <input
                id="due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg mb-4">Line items</h2>

          <div className="hidden sm:grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 text-xs font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>
            <span>Description</span>
            <span>Qty</span>
            <span>Rate</span>
            <span>Amount</span>
            <span></span>
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-center">
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                  placeholder="Item description"
                  className="rounded-md border px-2 py-1.5 text-sm min-w-0"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Item description"
                />
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={item.quantity}
                  onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                  className="rounded-md border px-2 py-1.5 text-sm font-mono min-w-0"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Quantity"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.rate}
                  onChange={(e) => updateItem(item.id, 'rate', e.target.value)}
                  className="rounded-md border px-2 py-1.5 text-sm font-mono min-w-0"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Rate"
                />
                <span className="text-sm font-mono text-right">
                  {((Number(item.quantity) || 0) * (Number(item.rate) || 0)).toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-xs justify-self-center"
                  style={{ color: 'var(--tally-alert)' }}
                  aria-label="Remove line item"
                  disabled={items.length === 1}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="text-sm mt-3 rounded-md border px-3 py-1.5"
            style={{ borderColor: 'var(--border)' }}
          >
            + Add line
          </button>

          <div className="flex justify-end mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="text-right">
              <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Total</p>
              <p className="font-display font-bold text-xl">{currency} {total.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <label htmlFor="notes" className="block text-sm font-medium mb-1">Notes (optional)</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Payment terms, thank-you note, anything the client should see."
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        {error && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <Link
            to="/invoices"
            className="rounded-md px-4 py-2 text-sm font-medium border"
            style={{ borderColor: 'var(--border)' }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create invoice'}
          </button>
        </div>
      </form>
    </div>
  )
}
