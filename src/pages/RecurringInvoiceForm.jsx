import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CURRENCIES } from '../lib/currency'
import { friendlyError } from '../lib/errorMessages'
import ClientPicker from '../components/ClientPicker'

let tempIdCounter = 0
const nextTempId = () => `temp-${++tempIdCounter}`
const emptyItem = () => ({ id: nextTempId(), description: '', quantity: 1, rate: 0 })

export default function RecurringInvoiceForm() {
  const { templateId } = useParams()
  const isEditing = Boolean(templateId)
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'
  const navigate = useNavigate()

  const [projects, setProjects] = useState([])
  const [allTasks, setAllTasks] = useState([])
  const [linkType, setLinkType] = useState('project') // 'project' | 'task'
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  // Same pattern as InvoiceForm.jsx: true once the email shown came from
  // the selected client's own record (renders read-only), false when it's
  // either untouched, typed by hand, or loaded from an existing template
  // that may predate this client link or no longer match the client's
  // current email.
  const [clientEmailFromRecord, setClientEmailFromRecord] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [currency, setCurrency] = useState('PHP')
  const [interval, setInterval] = useState('monthly')
  const [dueDays, setDueDays] = useState(14)
  const [nextRunDate, setNextRunDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeOrgId) return
    supabase
      .from('projects')
      .select('id, name')
      .eq('org_id', activeOrgId)
      .neq('status', 'archived')
      .order('name')
      .then(({ data }) => setProjects(data || []))
    supabase
      .from('tasks')
      .select('id, title, project_id, projects ( name )')
      .eq('org_id', activeOrgId)
      .is('deleted_at', null)
      .order('title')
      .then(({ data }) => setAllTasks(data || []))
  }, [activeOrgId])

  const loadExisting = useCallback(async () => {
    if (!isEditing) return
    setLoading(true)
    const [{ data: tmpl, error: tmplError }, { data: itemRows, error: itemError }] = await Promise.all([
      supabase.from('recurring_invoice_templates').select('*').eq('id', templateId).single(),
      supabase.from('recurring_invoice_items').select('*').eq('template_id', templateId).order('position'),
    ])
    if (tmplError || itemError) {
      setError(friendlyError(tmplError || itemError))
      setLoading(false)
      return
    }
    setClientId(tmpl.client_id || '')
    setClientName(tmpl.client_name || '')
    setClientEmail(tmpl.client_email || '')
    setClientEmailFromRecord(false)
    setProjectId(tmpl.project_id || '')
    setTaskId(tmpl.task_id || '')
    setLinkType(tmpl.task_id ? 'task' : 'project')
    setCurrency(tmpl.currency || 'PHP')
    setInterval(tmpl.recurrence_interval || 'monthly')
    setDueDays(tmpl.due_days ?? 14)
    setNextRunDate(tmpl.next_run_date || new Date().toISOString().slice(0, 10))
    setNotes(tmpl.notes || '')
    setItems((itemRows || []).length > 0 ? itemRows.map((it) => ({ id: it.id, description: it.description, quantity: it.quantity, rate: it.rate })) : [emptyItem()])
    setLoading(false)
  }, [templateId, isEditing])

  useEffect(() => { loadExisting() }, [loadExisting])

  const updateItem = (id, field, value) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)))
  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const removeItem = (id) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev))
  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!clientName.trim()) {
      setError('Choose a client (or add a new one).')
      return
    }
    if (!clientEmail.trim()) {
      setError('Enter the client email.')
      return
    }
    if (linkType === 'project' && !projectId) {
      setError('Choose which project this is for.')
      return
    }
    if (linkType === 'task' && !taskId) {
      setError('Choose which task this is for.')
      return
    }
    const validItems = items.filter((it) => it.description.trim())
    if (validItems.length === 0) {
      setError('Add at least one line item.')
      return
    }

    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()

    const payload = {
      org_id: activeOrgId,
      project_id: linkType === 'project' ? projectId : null,
      task_id: linkType === 'task' ? taskId : null,
      client_id: clientId || null,
      client_name: clientName.trim(),
      client_email: clientEmail.trim(),
      currency,
      recurrence_interval: interval,
      due_days: Number(dueDays) || 14,
      next_run_date: nextRunDate,
      notes: notes.trim() || null,
    }

    let targetId = templateId
    if (isEditing) {
      const { error: updateError } = await supabase.from('recurring_invoice_templates').update(payload).eq('id', templateId)
      if (updateError) { setError(friendlyError(updateError)); setSaving(false); return }
      const { error: deleteError } = await supabase.from('recurring_invoice_items').delete().eq('template_id', templateId)
      if (deleteError) { setError(friendlyError(deleteError)); setSaving(false); return }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('recurring_invoice_templates')
        .insert({ ...payload, created_by: userData?.user?.id })
        .select('id')
        .single()
      if (insertError) { setError(friendlyError(insertError)); setSaving(false); return }
      targetId = inserted.id
    }

    const itemRows = validItems.map((it, index) => ({
      template_id: targetId,
      org_id: activeOrgId,
      description: it.description.trim(),
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      position: index,
    }))
    const { error: itemsError } = await supabase.from('recurring_invoice_items').insert(itemRows)
    setSaving(false)
    if (itemsError) { setError(friendlyError(itemsError)); return }

    navigate('/invoices/recurring')
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  if (!isAdmin) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>
          {isEditing ? 'Only admins can edit recurring invoices.' : 'Only admins can create new recurring invoices.'}
        </p>
        <Link to="/invoices/recurring" className="text-sm underline">Back to recurring invoices</Link>
      </div>
    )
  }

  return (
    <div>
      <Link to="/invoices/recurring" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; Recurring invoices</Link>
      <h1 className="font-display font-bold text-2xl mb-6">{isEditing ? 'Edit recurring invoice' : 'New recurring invoice'}</h1>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <ClientPicker
                id="rec-client"
                orgId={activeOrgId}
                value={clientId}
                onSelect={(c) => {
                  setClientId(c?.id || '')
                  setClientName(c?.name || '')
                  setClientEmail(c?.email || '')
                  setClientEmailFromRecord(Boolean(c?.email))
                }}
                label="Client name"
              />
            </div>
            <div>
              <label htmlFor="rec-email" className="block text-sm font-medium mb-1">Client email</label>
              {clientEmailFromRecord ? (
                <>
                  <p id="rec-email" className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--panel-sunken)' }}>
                    {clientEmail}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                    From {clientName}'s client record.{' '}
                    {clientId && (
                      <Link to={`/clients/${clientId}`} className="underline">Wrong email? Update it here.</Link>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <input id="rec-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} required />
                  {clientId && (
                    <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                      This client has no email on file yet — entering one here only applies to this template.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-1">This is for</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setLinkType('project')}
                  className="text-xs font-mono uppercase tracking-wide rounded-full px-3 py-1 border transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    background: linkType === 'project' ? 'var(--ink)' : 'transparent',
                    color: linkType === 'project' ? 'var(--panel)' : 'var(--ink-muted)',
                  }}
                >
                  A project
                </button>
                <button
                  type="button"
                  onClick={() => setLinkType('task')}
                  className="text-xs font-mono uppercase tracking-wide rounded-full px-3 py-1 border transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    background: linkType === 'task' ? 'var(--ink)' : 'transparent',
                    color: linkType === 'task' ? 'var(--panel)' : 'var(--ink-muted)',
                  }}
                >
                  A specific task
                </button>
              </div>
              {linkType === 'project' ? (
                <select id="rec-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} required>
                  <option value="">Choose a project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <select id="rec-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} required>
                  <option value="">Choose a task…</option>
                  {allTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}{t.projects?.name ? ` (${t.projects.name})` : ' (standalone)'}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label htmlFor="rec-currency" className="block text-sm font-medium mb-1">Currency</label>
              <select id="rec-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rec-interval" className="block text-sm font-medium mb-1">Repeats</label>
              <select id="rec-interval" value={interval} onChange={(e) => setInterval(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label htmlFor="rec-due-days" className="block text-sm font-medium mb-1">Due (days after issue)</label>
              <input id="rec-due-days" type="number" min="0" value={dueDays} onChange={(e) => setDueDays(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono" style={{ borderColor: 'var(--border)' }} />
            </div>
            <div>
              <label htmlFor="rec-next-run" className="block text-sm font-medium mb-1">Next generation date</label>
              <input id="rec-next-run" type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} required />
              <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>Each generation automatically advances this to the next period.</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg mb-4">Line items (repeated every period)</h2>
          <div className="hidden sm:grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 text-xs font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>
            <span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span></span>
          </div>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-center">
                <input type="text" value={item.description} onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                  placeholder="Item description" className="rounded-md border px-2 py-1.5 text-sm min-w-0" style={{ borderColor: 'var(--border)' }} aria-label="Item description" />
                <input type="number" min="0" step="0.5" value={item.quantity} onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                  className="rounded-md border px-2 py-1.5 text-sm font-mono min-w-0" style={{ borderColor: 'var(--border)' }} aria-label="Quantity" />
                <input type="number" min="0" step="0.01" value={item.rate} onChange={(e) => updateItem(item.id, 'rate', e.target.value)}
                  className="rounded-md border px-2 py-1.5 text-sm font-mono min-w-0" style={{ borderColor: 'var(--border)' }} aria-label="Rate" />
                <span className="text-sm font-mono text-right">{((Number(item.quantity) || 0) * (Number(item.rate) || 0)).toFixed(2)}</span>
                <button type="button" onClick={() => removeItem(item.id)} className="text-xs justify-self-center" style={{ color: 'var(--tally-alert)' }} aria-label="Remove line item" disabled={items.length === 1}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addItem} className="text-sm mt-3 rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>+ Add line</button>
          <div className="flex justify-end mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="text-right">
              <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Amount per period</p>
              <p className="font-display font-bold text-xl">{currency} {total.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <label htmlFor="rec-notes" className="block text-sm font-medium mb-1">Notes (optional)</label>
          <textarea id="rec-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
        </div>

        {error && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <Link to="/invoices/recurring" className="rounded-md px-4 py-2 text-sm font-medium border" style={{ borderColor: 'var(--border)' }}>Cancel</Link>
          <button type="submit" disabled={saving} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--ink)', color: 'var(--panel)' }}>
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create recurring invoice'}
          </button>
        </div>
      </form>
    </div>
  )
}
