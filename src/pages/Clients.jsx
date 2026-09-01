import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errorMessages'

export default function Clients() {
  const { activeOrgId } = useAuth()
  const [clients, setClients] = useState([])
  const [counts, setCounts] = useState({}) // { [client_id]: { projects, tasks, invoices } }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [
      { data: clientRows, error: clientError },
      { data: projectRows, error: projectError },
      { data: taskRows, error: taskError },
      { data: invoiceRows, error: invoiceError },
    ] = await Promise.all([
      supabase.from('clients').select('id, name, email, company, website').eq('org_id', activeOrgId).order('name', { ascending: true }),
      supabase.from('projects').select('client_id').eq('org_id', activeOrgId).not('client_id', 'is', null),
      supabase.from('tasks').select('client_id').eq('org_id', activeOrgId).not('client_id', 'is', null).is('deleted_at', null),
      supabase.from('invoices').select('client_id').eq('org_id', activeOrgId).not('client_id', 'is', null),
    ])

    if (clientError || projectError || taskError || invoiceError) {
      setError(friendlyError(clientError || projectError || taskError || invoiceError))
      setLoading(false)
      return
    }

    const next = {}
    const bump = (rows, key) => {
      for (const row of rows || []) {
        next[row.client_id] ??= { projects: 0, tasks: 0, invoices: 0 }
        next[row.client_id][key] += 1
      }
    }
    bump(projectRows, 'projects')
    bump(taskRows, 'tasks')
    bump(invoiceRows, 'invoices')

    setClients(clientRows || [])
    setCounts(next)
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!name.trim()) {
      setFormError('Enter a client name.')
      return
    }
    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('clients').insert({
      org_id: activeOrgId,
      name: name.trim(),
      email: email.trim() || null,
      company: company.trim() || null,
      website: website.trim() || null,
      created_by: userData?.user?.id,
    })
    setSaving(false)
    if (insertError) {
      setFormError(friendlyError(insertError))
      return
    }
    setName('')
    setEmail('')
    setCompany('')
    setWebsite('')
    setShowForm(false)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Clients</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          {showForm ? 'Cancel' : '+ New client'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-lg border p-5 space-y-4 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="new-client-name" className="block text-sm font-medium mb-1">Client name</label>
              <input
                id="new-client-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                required
              />
            </div>
            <div>
              <label htmlFor="new-client-email" className="block text-sm font-medium mb-1">Email</label>
              <input
                id="new-client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Used to auto-fill invoices"
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="new-client-company" className="block text-sm font-medium mb-1">Company</label>
              <input
                id="new-client-company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="new-client-website" className="block text-sm font-medium mb-1">Website</label>
              <input
                id="new-client-website"
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          </div>

          {formError && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {saving ? 'Adding…' : 'Add client'}
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading clients…</p>
      ) : clients.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">No clients yet</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            Add your first one — it takes about ten seconds.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-block rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            + New client
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {clients.map((client) => {
            const c = counts[client.id] || { projects: 0, tasks: 0, invoices: 0 }
            return (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="block rounded-lg border p-5 hover:shadow-sm transition-shadow"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              >
                <h2 className="font-display font-bold text-lg leading-snug mb-1">{client.name}</h2>
                {client.email && <p className="text-sm truncate" style={{ color: 'var(--ink-muted)' }}>{client.email}</p>}
                {client.company && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{client.company}</p>}
                {client.website && (
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>{client.website}</p>
                )}

                <div className="flex items-center gap-3 text-xs font-mono mt-4" style={{ color: 'var(--ink-muted)' }}>
                  <span>{c.projects} project{c.projects === 1 ? '' : 's'}</span>
                  <span>{c.tasks} task{c.tasks === 1 ? '' : 's'}</span>
                  <span>{c.invoices} invoice{c.invoices === 1 ? '' : 's'}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
