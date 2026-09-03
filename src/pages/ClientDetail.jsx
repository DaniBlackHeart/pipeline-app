import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import AttachmentsList from '../components/AttachmentsList'
import ActivityLog from '../components/ActivityLog'
import TallyDot from '../components/TallyDot'
import { formatMoney } from '../lib/currency'
import { friendlyError } from '../lib/errorMessages'

function deriveInvoiceDisplayStatus(invoice) {
  if (invoice.status === 'sent' && invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10)) {
    return 'overdue'
  }
  return invoice.status
}

export default function ClientDetail() {
  const { clientId } = useParams()
  const { activeOrgId } = useAuth()
  const navigate = useNavigate()

  const [client, setClient] = useState(null)
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [guidelinesInput, setGuidelinesInput] = useState('')
  const [guidelinesSaving, setGuidelinesSaving] = useState(false)
  const [guidelinesError, setGuidelinesError] = useState('')
  const [guidelinesSaved, setGuidelinesSaved] = useState(false)

  useEffect(() => {
    if (!client) return
    setGuidelinesInput(client.brand_guidelines || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id])

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const { data: clientRow, error: clientError } = await supabase
      .from('clients').select('*').eq('id', clientId).single()

    if (clientError) {
      setError(friendlyError(clientError))
      setLoading(false)
      return
    }
    setClient(clientRow)

    const [{ data: projectRows }, { data: directTaskRows }, { data: invoiceRows }] = await Promise.all([
      supabase.from('projects').select('id, name, status, due_date').eq('client_id', clientId).order('created_at', { ascending: false }),
      // Standalone tasks linked directly to this client.
      supabase.from('tasks').select('id, title, status, project_id, projects ( name )').eq('client_id', clientId).is('deleted_at', null),
      supabase.from('invoices').select('id, invoice_number, status, currency, total_amount, due_date').eq('client_id', clientId).order('issue_date', { ascending: false }),
    ])

    // Plus tasks that belong to one of this client's projects -- a task
    // doesn't carry its own client_id when it's only linked via its
    // project, so this is a separate query, merged and deduped below.
    const projectIds = (projectRows || []).map((p) => p.id)
    let viaProjectTaskRows = []
    if (projectIds.length > 0) {
      const { data } = await supabase
        .from('tasks').select('id, title, status, project_id, projects ( name )')
        .in('project_id', projectIds)
        .is('deleted_at', null)
      viaProjectTaskRows = data || []
    }
    const taskMap = new Map()
    for (const t of [...(directTaskRows || []), ...viaProjectTaskRows]) taskMap.set(t.id, t)

    setProjects(projectRows || [])
    setTasks([...taskMap.values()])
    setInvoices(invoiceRows || [])
    setLoading(false)
  }, [clientId, activeOrgId])

  useEffect(() => { load() }, [load])

  const updateField = async (fields) => {
    setClient((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('clients').update(fields).eq('id', clientId)
    if (updateError) setError(friendlyError(updateError))
  }

  const handleSaveGuidelines = async (e) => {
    e.preventDefault()
    setGuidelinesError('')
    setGuidelinesSaved(false)
    setGuidelinesSaving(true)
    const trimmed = guidelinesInput.trim() || null
    const { error: updateError } = await supabase.from('clients').update({ brand_guidelines: trimmed }).eq('id', clientId)
    setGuidelinesSaving(false)
    if (updateError) {
      setGuidelinesError(friendlyError(updateError))
      return
    }
    setClient((prev) => ({ ...prev, brand_guidelines: trimmed }))
    setGuidelinesInput(trimmed || '')
    setGuidelinesSaved(true)
  }

  const handleDelete = async () => {
    const { error: deleteError } = await supabase.from('clients').delete().eq('id', clientId)
    if (deleteError) {
      setError(friendlyError(deleteError))
      return
    }
    navigate('/clients')
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  if (!client) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Client not found, or you don't have access.</p>
        <Link to="/clients" className="text-sm underline">Back to clients</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/clients" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; All clients</Link>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-end mb-3">
          <button onClick={handleDelete} className="text-xs flex-shrink-0" style={{ color: 'var(--tally-alert)' }}>
            Delete client
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="client-name" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Client name</label>
            <input
              id="client-name"
              type="text"
              defaultValue={client.name}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== client.name) updateField({ name: v })
                else if (!v) setClient((prev) => ({ ...prev, name: client.name })) // don't allow blanking it out
              }}
              className="w-full font-display font-bold rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="client-email" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Email</label>
            <input
              id="client-email"
              type="email"
              defaultValue={client.email || ''}
              onBlur={(e) => updateField({ email: e.target.value.trim() || null })}
              placeholder="Used to auto-fill invoices"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <label htmlFor="client-company-email" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Company email</label>
            <input
              id="client-company-email"
              type="email"
              defaultValue={client.company_email || ''}
              onBlur={(e) => updateField({ company_email: e.target.value.trim() || null })}
              placeholder="General/company inbox, if different"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="client-company" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Company</label>
            <input
              id="client-company"
              type="text"
              defaultValue={client.company || ''}
              onBlur={(e) => updateField({ company: e.target.value.trim() || null })}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="client-website" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Website</label>
            <input
              id="client-website"
              type="text"
              defaultValue={client.website || ''}
              onBlur={(e) => updateField({ website: e.target.value.trim() || null })}
              placeholder="https://…"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
            {client.website && (
              <a href={client.website} target="_blank" rel="noreferrer" className="text-xs underline break-all mt-1 inline-block">
                {client.website}
              </a>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="client-phone" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Phone number</label>
          <input
            id="client-phone"
            type="tel"
            defaultValue={client.phone || ''}
            onBlur={(e) => updateField({ phone: e.target.value.trim() || null })}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        <div>
          <label htmlFor="client-address" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Address</label>
          <textarea
            id="client-address"
            defaultValue={client.address || ''}
            onBlur={(e) => updateField({ address: e.target.value.trim() || null })}
            rows={2}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6 mb-6">
        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg mb-3">Projects</h2>
          {projects.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No projects linked to this client yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:shadow-sm transition-shadow"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-sm min-w-0 truncate">{p.name}</span>
                    <TallyDot status={p.status} showLabel={false} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg mb-3">Invoices</h2>
          {invoices.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No invoices linked to this client yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {invoices.map((inv) => {
                const displayStatus = deriveInvoiceDisplayStatus(inv)
                return (
                  <li key={inv.id}>
                    <Link
                      to={`/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:shadow-sm transition-shadow"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span className="text-sm min-w-0 truncate font-mono">{inv.invoice_number}</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-medium">{formatMoney(inv.total_amount, inv.currency)}</span>
                        <TallyDot status={displayStatus} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No tasks linked to this client yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/tasks/${t.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:shadow-sm transition-shadow"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="text-sm min-w-0 truncate">
                    {t.title}
                    {t.projects?.name && <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>({t.projects.name})</span>}
                  </span>
                  <TallyDot status={t.status} showLabel={false} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSaveGuidelines} className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <label htmlFor="client-guidelines" className="block text-sm font-medium mb-1">Brand guidelines</label>
        <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
          Notes on how this client's brand should be used — hex codes, font names, tone,
          whatever's useful. Logo files and other brand assets go in Files below instead of
          here.
        </p>
        <textarea
          id="client-guidelines"
          value={guidelinesInput}
          onChange={(e) => setGuidelinesInput(e.target.value)}
          rows={3}
          placeholder="No brand guidelines yet."
          className="w-full rounded-md border px-3 py-2 text-sm mb-3"
          style={{ borderColor: 'var(--border)' }}
        />

        {guidelinesError && (
          <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
            {guidelinesError}
          </p>
        )}
        {guidelinesSaved && (
          <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done-text)' }} role="status">
            Brand guidelines saved.
          </p>
        )}

        <button
          type="submit"
          disabled={guidelinesSaving || guidelinesInput === (client.brand_guidelines || '')}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          {guidelinesSaving ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Files</h2>
        <AttachmentsList orgId={activeOrgId} parentType="client" parentId={clientId} />
      </div>

      <ActivityLog entityType="client" entityId={clientId} />
    </div>
  )
}
