import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function TicketForm() {
  const { ticketId } = useParams()
  const isEditing = Boolean(ticketId)
  const { activeOrgId } = useAuth()
  const navigate = useNavigate()

  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('request')
  const [priority, setPriority] = useState('medium')
  const [projectId, setProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeOrgId) return
    Promise.all([
      supabase.from('projects').select('id, name').eq('org_id', activeOrgId).neq('status', 'archived').order('name'),
      supabase.from('org_members').select('user_id, profiles ( id, full_name )').eq('org_id', activeOrgId),
    ]).then(([{ data: projectData }, { data: memberData }]) => {
      setProjects(projectData || [])
      setMembers((memberData || []).map((m) => m.profiles).filter(Boolean))
    })
  }, [activeOrgId])

  const loadExisting = useCallback(async () => {
    if (!isEditing) return
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('tickets').select('*').eq('id', ticketId).single()
    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setTitle(data.title || '')
    setDescription(data.description || '')
    setType(data.type || 'request')
    setPriority(data.priority || 'medium')
    setProjectId(data.project_id || '')
    setAssigneeId(data.assignee_id || '')
    setLoading(false)
  }, [ticketId, isEditing])

  useEffect(() => { loadExisting() }, [loadExisting])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Give the ticket a title.')
      return
    }

    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()

    const payload = {
      org_id: activeOrgId,
      project_id: projectId || null,
      title: title.trim(),
      description: description.trim() || null,
      type,
      priority,
      assignee_id: assigneeId || null,
    }

    if (isEditing) {
      const { error: updateError } = await supabase.from('tickets').update(payload).eq('id', ticketId)
      setSaving(false)
      if (updateError) {
        setError(updateError.message)
        return
      }
      navigate(`/tickets/${ticketId}`)
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('tickets')
        .insert({ ...payload, created_by: userData?.user?.id })
        .select('id')
        .single()
      setSaving(false)
      if (insertError) {
        setError(insertError.message)
        return
      }
      navigate(`/tickets/${inserted.id}`)
    }
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  return (
    <div className="max-w-xl">
      <Link to="/tickets" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; All tickets</Link>

      <h1 className="font-display font-bold text-2xl mb-6">{isEditing ? 'Edit ticket' : 'New ticket'}</h1>

      <form onSubmit={handleSubmit} className="rounded-lg border p-5 space-y-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div>
          <label htmlFor="ticket-title" className="block text-sm font-medium mb-1">Title</label>
          <input
            id="ticket-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
            required
          />
        </div>

        <div>
          <label htmlFor="ticket-desc" className="block text-sm font-medium mb-1">Description (optional)</label>
          <textarea
            id="ticket-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ticket-type" className="block text-sm font-medium mb-1">Type</label>
            <select
              id="ticket-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="bug">Bug</option>
              <option value="request">Request</option>
              <option value="question">Question</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="ticket-priority" className="block text-sm font-medium mb-1">Priority</label>
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ticket-project" className="block text-sm font-medium mb-1">Linked project (optional)</label>
            <select
              id="ticket-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ticket-assignee" className="block text-sm font-medium mb-1">Assignee (optional)</label>
            <select
              id="ticket-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Link
            to="/tickets"
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
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create ticket'}
          </button>
        </div>
      </form>
    </div>
  )
}
