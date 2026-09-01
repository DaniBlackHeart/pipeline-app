import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errorMessages'

export default function TaskTemplates() {
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [templates, setTemplates] = useState([])
  const [counts, setCounts] = useState({}) // { [template_id]: itemCount }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: templateRows, error: templateError }, { data: itemRows, error: itemError }] = await Promise.all([
      supabase.from('task_templates').select('id, name, description').eq('org_id', activeOrgId).order('name', { ascending: true }),
      supabase.from('task_template_items').select('template_id').eq('org_id', activeOrgId),
    ])

    if (templateError || itemError) {
      setError(friendlyError(templateError || itemError))
      setLoading(false)
      return
    }

    const next = {}
    for (const row of itemRows || []) next[row.template_id] = (next[row.template_id] || 0) + 1

    setTemplates(templateRows || [])
    setCounts(next)
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!name.trim()) {
      setFormError('Give the template a name.')
      return
    }
    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('task_templates').insert({
      org_id: activeOrgId,
      name: name.trim(),
      description: description.trim() || null,
      created_by: userData?.user?.id,
    })
    setSaving(false)
    if (insertError) {
      setFormError(friendlyError(insertError))
      return
    }
    setName('')
    setDescription('')
    setShowForm(false)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Task Templates</h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {showForm ? 'Cancel' : '+ New template'}
          </button>
        )}
      </div>

      {!isAdmin && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--panel-sunken)', color: 'var(--ink-muted)' }}>
          Only workspace admins can create or edit templates. Any member can still apply one to a
          project.
        </p>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-lg border p-5 space-y-4 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div>
            <label htmlFor="new-template-name" className="block text-sm font-medium mb-1">Template name</label>
            <input
              id="new-template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>
          <div>
            <label htmlFor="new-template-desc" className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              id="new-template-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
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
            {saving ? 'Adding…' : 'Add template'}
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading templates…</p>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">No task templates yet</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            {isAdmin ? 'Add your first one — it takes about ten seconds.' : 'Ask a workspace admin to add one.'}
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-block rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              + New template
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {templates.map((template) => (
            <Link
              key={template.id}
              to={`/task-templates/${template.id}`}
              className="block rounded-lg border p-5 hover:shadow-sm transition-shadow"
              style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
            >
              <h2 className="font-display font-bold text-lg leading-snug mb-1">{template.name}</h2>
              {template.description && (
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{template.description}</p>
              )}
              <p className="text-xs font-mono mt-4" style={{ color: 'var(--ink-muted)' }}>
                {counts[template.id] || 0} task{(counts[template.id] || 0) === 1 ? '' : 's'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
