import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errorMessages'

export default function TaskTemplateDetail() {
  const { templateId } = useParams()
  const { activeOrgId, activeOrg } = useAuth()
  const navigate = useNavigate()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [template, setTemplate] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newTitle, setNewTitle] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [addingItem, setAddingItem] = useState(false)

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: templateRow, error: templateError }, { data: itemRows, error: itemError }] = await Promise.all([
      supabase.from('task_templates').select('*').eq('id', templateId).single(),
      supabase.from('task_template_items').select('*').eq('template_id', templateId).order('position', { ascending: true }),
    ])

    if (templateError || itemError) {
      setError(friendlyError(templateError || itemError))
      setLoading(false)
      return
    }

    setTemplate(templateRow)
    setItems(itemRows || [])
    setLoading(false)
  }, [templateId, activeOrgId])

  useEffect(() => { load() }, [load])

  const updateTemplateField = async (fields) => {
    setTemplate((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('task_templates').update(fields).eq('id', templateId)
    if (updateError) setError(friendlyError(updateError))
  }

  const handleDeleteTemplate = async () => {
    const { error: deleteError } = await supabase.from('task_templates').delete().eq('id', templateId)
    if (deleteError) {
      setError(friendlyError(deleteError))
      return
    }
    navigate('/task-templates')
  }

  const handleAddItem = async (e) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setAddingItem(true)
    const { error: insertError } = await supabase.from('task_template_items').insert({
      template_id: templateId,
      org_id: activeOrgId,
      title: newTitle.trim(),
      role_label: newRole.trim() || null,
      description: newDescription.trim() || null,
      position: items.length,
    })
    setAddingItem(false)
    if (insertError) {
      setError(friendlyError(insertError))
      return
    }
    setNewTitle('')
    setNewRole('')
    setNewDescription('')
    load()
  }

  const updateItemField = async (itemId, fields) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...fields } : i)))
    const { error: updateError } = await supabase.from('task_template_items').update(fields).eq('id', itemId)
    if (updateError) setError(friendlyError(updateError))
  }

  const handleRemoveItem = async (itemId) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    const { error: deleteError } = await supabase.from('task_template_items').delete().eq('id', itemId)
    if (deleteError) setError(friendlyError(deleteError))
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
  }

  if (!template) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Template not found, or you don't have access.</p>
        <Link to="/task-templates" className="text-sm underline">Back to Task Templates</Link>
      </div>
    )
  }

  return (
    <div>
      <Link to="/task-templates" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; Task Templates</Link>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <label htmlFor="template-name" className="sr-only">Template name</label>
          {isAdmin ? (
            <input
              id="template-name"
              type="text"
              defaultValue={template.name}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== template.name) updateTemplateField({ name: v })
                else if (!v) setTemplate((prev) => ({ ...prev, name: template.name })) // don't allow blanking it out
              }}
              className="w-full font-display font-bold text-xl rounded-md border-none px-0 py-1 bg-transparent"
            />
          ) : (
            <h1 className="font-display font-bold text-xl">{template.name}</h1>
          )}
          {isAdmin && (
            <button onClick={handleDeleteTemplate} className="text-xs flex-shrink-0" style={{ color: 'var(--tally-alert)' }}>
              Delete template
            </button>
          )}
        </div>

        <label htmlFor="template-description" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>
          Description
        </label>
        {isAdmin ? (
          <textarea
            id="template-description"
            defaultValue={template.description || ''}
            onBlur={(e) => updateTemplateField({ description: e.target.value.trim() || null })}
            rows={2}
            placeholder="What this template is for…"
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        ) : (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{template.description || 'No description.'}</p>
        )}
      </div>

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Tasks</h2>

        {items.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>No tasks in this template yet.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {items.map((item, index) => (
              <li key={item.id} className="rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xs font-mono mt-2 flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>{index + 1}.</span>
                  <label htmlFor={`item-title-${item.id}`} className="sr-only">Task title</label>
                  {isAdmin ? (
                    <input
                      id={`item-title-${item.id}`}
                      type="text"
                      defaultValue={item.title}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== item.title) updateItemField(item.id, { title: v })
                      }}
                      className="flex-1 min-w-0 text-sm font-medium rounded-md border px-2 py-1.5"
                      style={{ borderColor: 'var(--border)' }}
                    />
                  ) : (
                    <span className="flex-1 min-w-0 text-sm font-medium py-1.5">{item.title}</span>
                  )}
                  <label htmlFor={`item-role-${item.id}`} className="sr-only">Suggested role</label>
                  {isAdmin ? (
                    <input
                      id={`item-role-${item.id}`}
                      type="text"
                      defaultValue={item.role_label || ''}
                      onBlur={(e) => updateItemField(item.id, { role_label: e.target.value.trim() || null })}
                      placeholder="Role (optional)"
                      className="w-36 flex-shrink-0 text-sm rounded-md border px-2 py-1.5"
                      style={{ borderColor: 'var(--border)' }}
                    />
                  ) : (
                    item.role_label && (
                      <span className="text-xs flex-shrink-0 mt-2" style={{ color: 'var(--ink-muted)' }}>{item.role_label}</span>
                    )
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-xs flex-shrink-0 mt-2"
                      style={{ color: 'var(--tally-alert)' }}
                      aria-label={`Remove ${item.title}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <label htmlFor={`item-desc-${item.id}`} className="sr-only">Task description</label>
                {isAdmin ? (
                  <textarea
                    id={`item-desc-${item.id}`}
                    defaultValue={item.description || ''}
                    onBlur={(e) => updateItemField(item.id, { description: e.target.value.trim() || null })}
                    rows={2}
                    placeholder="Notes for this task (optional)…"
                    className="w-full text-sm rounded-md border px-2 py-1.5 ml-6"
                    style={{ borderColor: 'var(--border)', width: 'calc(100% - 1.5rem)' }}
                  />
                ) : (
                  item.description && (
                    <p className="text-sm ml-6" style={{ color: 'var(--ink-muted)' }}>{item.description}</p>
                  )
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin ? (
          <form onSubmit={handleAddItem} className="rounded-md border border-dashed p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <label htmlFor="new-item-title" className="sr-only">New task title</label>
              <input
                id="new-item-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task…"
                className="flex-1 min-w-[140px] rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
              <label htmlFor="new-item-role" className="sr-only">Suggested role</label>
              <input
                id="new-item-role"
                type="text"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="Role (optional)"
                className="w-36 flex-shrink-0 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
              <button
                type="submit"
                disabled={addingItem}
                className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex-shrink-0"
                style={{ background: 'var(--ink)', color: 'var(--panel)' }}
              >
                Add
              </button>
            </div>
            <label htmlFor="new-item-desc" className="sr-only">Task description</label>
            <textarea
              id="new-item-desc"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              placeholder="Notes for this task (optional)…"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </form>
        ) : (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--panel-sunken)', color: 'var(--ink-muted)' }}>
            Only workspace admins can edit templates.
          </p>
        )}
      </div>
    </div>
  )
}
