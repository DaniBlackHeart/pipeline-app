import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function NewProjectDialog({ orgId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const firstFieldRef = useRef(null)

  useEffect(() => { firstFieldRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Give the project a name.')
      return
    }
    setSubmitting(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('projects').insert({
      org_id: orgId,
      name: name.trim(),
      client_name: clientName.trim() || null,
      due_date: dueDate || null,
      description: description.trim() || null,
      created_by: userData?.user?.id,
    })
    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    onCreated()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(20, 23, 26, 0.4)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg p-6" style={{ background: 'var(--panel)' }}>
        <h2 id="new-project-title" className="font-display font-bold text-lg mb-4">New project</h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="proj-name" className="block text-sm font-medium mb-1">Project name</label>
            <input
              id="proj-name"
              ref={firstFieldRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>

          <div>
            <label htmlFor="proj-client" className="block text-sm font-medium mb-1">Client (optional)</label>
            <input
              id="proj-client"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <label htmlFor="proj-due" className="block text-sm font-medium mb-1">Due date (optional)</label>
            <input
              id="proj-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <label htmlFor="proj-desc" className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          {error && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium border"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              {submitting ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
