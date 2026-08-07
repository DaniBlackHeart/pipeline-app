import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { QUICK_ROLES } from '../lib/roles'

export default function NewProject() {
  const { activeOrgId } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [members, setMembers] = useState([])
  const [assigneeByRole, setAssigneeByRole] = useState({})

  useEffect(() => {
    if (!activeOrgId) return
    supabase
      .from('org_members')
      .select('user_id, profiles ( id, full_name )')
      .eq('org_id', activeOrgId)
      .then(({ data }) => setMembers((data || []).map((m) => m.profiles).filter(Boolean)))
  }, [activeOrgId])

  const handleRoleChange = (role, userId) => {
    setAssigneeByRole((prev) => ({ ...prev, [role]: userId }))
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
        org_id: activeOrgId,
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

    const membersToAdd = Object.entries(assigneeByRole).filter(([, userId]) => userId)
    if (membersToAdd.length > 0) {
      // Best-effort: the project itself is already created successfully at
      // this point, so a failure here shouldn't block navigation — members
      // can still be added from the project's own page afterward.
      await supabase.from('project_assignees').insert(
        membersToAdd.map(([role, userId]) => ({
          project_id: inserted.id,
          user_id: userId,
          role_label: role,
          org_id: activeOrgId,
        }))
      )
    }

    setSubmitting(false)
    navigate(`/projects/${inserted.id}`)
  }

  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; Projects</Link>

      <h1 className="font-display font-bold text-2xl mb-6">New project</h1>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="mb-4">
            <label htmlFor="proj-name" className="block text-sm font-medium mb-1">Project name</label>
            <input
              id="proj-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>

          <div className="mb-4">
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

          <div className="grid sm:grid-cols-2 gap-4 mb-4">
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
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg mb-1">Assigned members</h2>
          <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>Optional — can also be set from the project's own page later.</p>
          <ul className="space-y-2">
            {QUICK_ROLES.map((role) => (
              <li key={role} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm font-medium flex-shrink-0">{role}</span>
                <label htmlFor={`new-proj-role-${role}`} className="sr-only">{role}</label>
                <select
                  id={`new-proj-role-${role}`}
                  value={assigneeByRole[role] || ''}
                  onChange={(e) => handleRoleChange(role, e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">Choose a member…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <Link
            to="/"
            className="rounded-md px-4 py-2 text-sm font-medium border"
            style={{ borderColor: 'var(--border)' }}
          >
            Cancel
          </Link>
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
  )
}
