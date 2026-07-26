import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function NewProjectDialog({ orgId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const firstFieldRef = useRef(null)

  const [members, setMembers] = useState([])
  const [assignees, setAssignees] = useState([]) // [{ userId, roleLabel }]
  const [newAssigneeId, setNewAssigneeId] = useState('')
  const [newAssigneeRole, setNewAssigneeRole] = useState('')

  useEffect(() => { firstFieldRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('org_members')
      .select('user_id, profiles ( id, full_name )')
      .eq('org_id', orgId)
      .then(({ data }) => setMembers((data || []).map((m) => m.profiles).filter(Boolean)))
  }, [orgId])

  const handleAddAssignee = () => {
    if (!newAssigneeId) return
    setAssignees((prev) => [...prev, { userId: newAssigneeId, roleLabel: newAssigneeRole.trim() || null }])
    setNewAssigneeId('')
    setNewAssigneeRole('')
  }

  const handleRemoveAssignee = (userId) => {
    setAssignees((prev) => prev.filter((a) => a.userId !== userId))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Give the project a name.')
      return
    }
    if (!clientName.trim()) {
      setError('Enter the client name.')
      return
    }
    if (!startDate) {
      setError('Pick a start date.')
      return
    }
    if (!dueDate) {
      setError('Pick a due date.')
      return
    }

    setSubmitting(true)
    const { data: userData } = await supabase.auth.getUser()
    const { data: inserted, error: insertError } = await supabase
      .from('projects')
      .insert({
        org_id: orgId,
        name: name.trim(),
        client_name: clientName.trim(),
        start_date: startDate,
        due_date: dueDate,
        description: description.trim() || null,
        created_by: userData?.user?.id,
      })
      .select('id')
      .single()

    if (insertError) {
      setSubmitting(false)
      setError(insertError.message)
      return
    }

    if (assignees.length > 0) {
      const { error: assigneeError } = await supabase.from('project_assignees').insert(
        assignees.map((a) => ({
          project_id: inserted.id,
          user_id: a.userId,
          role_label: a.roleLabel,
          org_id: orgId,
        }))
      )
      if (assigneeError) {
        // Project itself was created successfully — don't block on this,
        // just surface it. Assignees can still be added from the project
        // page afterward.
        setError(`Project created, but couldn't add assignees: ${assigneeError.message}`)
        setSubmitting(false)
        onCreated()
        return
      }
    }

    setSubmitting(false)
    onCreated()
  }

  const availableMembers = members.filter((m) => !assignees.some((a) => a.userId === m.id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(20, 23, 26, 0.4)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg p-6 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--panel)' }}>
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
            <label htmlFor="proj-client" className="block text-sm font-medium mb-1">Client</label>
            <input
              id="proj-client"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="proj-start" className="block text-sm font-medium mb-1">Start date</label>
              <input
                id="proj-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                required
              />
            </div>
            <div>
              <label htmlFor="proj-due" className="block text-sm font-medium mb-1">Due date</label>
              <input
                id="proj-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                required
              />
            </div>
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

          <div>
            <label className="block text-sm font-medium mb-1">Assign members (optional)</label>
            {assignees.length > 0 && (
              <ul className="space-y-1.5 mb-2">
                {assignees.map((a) => {
                  const person = members.find((m) => m.id === a.userId)
                  return (
                    <li key={a.userId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-sm">
                        {person?.full_name || 'Member'}
                        {a.roleLabel && <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>({a.roleLabel})</span>}
                      </span>
                      <button type="button" onClick={() => handleRemoveAssignee(a.userId)} className="text-xs flex-shrink-0" style={{ color: 'var(--tally-alert)' }}>
                        Remove
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={newAssigneeId}
                onChange={(e) => setNewAssigneeId(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm flex-1"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">Choose a member…</option>
                {availableMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>)}
              </select>
              <input
                type="text"
                value={newAssigneeRole}
                onChange={(e) => setNewAssigneeRole(e.target.value)}
                placeholder="Role (optional)"
                className="rounded-md border px-3 py-2 text-sm flex-1"
                style={{ borderColor: 'var(--border)' }}
              />
              <button
                type="button"
                onClick={handleAddAssignee}
                disabled={!newAssigneeId}
                className="rounded-md px-4 py-2 text-sm font-medium border disabled:opacity-60 flex-shrink-0"
                style={{ borderColor: 'var(--border)' }}
              >
                Add
              </button>
            </div>
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
