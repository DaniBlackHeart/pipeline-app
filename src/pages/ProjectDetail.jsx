import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Scrubber from '../components/Scrubber'
import TallyDot from '../components/TallyDot'
import TaskAttachmentsDialog from '../components/TaskAttachmentsDialog'

const STATUS_CYCLE = ['todo', 'in_progress', 'done']

export default function ProjectDetail() {
  const { projectId } = useParams()
  const { activeOrgId } = useAuth()

  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [attachmentsTask, setAttachmentsTask] = useState(null)
  const [attachmentCounts, setAttachmentCounts] = useState({})

  const loadAttachmentCounts = useCallback(async (taskRows) => {
    const ids = (taskRows || tasks).map((t) => t.id)
    if (ids.length === 0) return
    const { data, error: countError } = await supabase
      .from('attachments')
      .select('parent_id')
      .eq('parent_type', 'task')
      .in('parent_id', ids)
    if (countError) return
    const counts = {}
    for (const row of data || []) counts[row.parent_id] = (counts[row.parent_id] || 0) + 1
    setAttachmentCounts(counts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [{ data: projectRow, error: projectError }, { data: taskRows, error: taskError }, { data: memberRows, error: memberError }] =
      await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('tasks').select('*').eq('project_id', projectId).order('position', { ascending: true }),
        supabase.from('org_members').select('user_id, profiles ( id, full_name )').eq('org_id', activeOrgId),
      ])

    if (projectError || taskError || memberError) {
      setError((projectError || taskError || memberError).message)
      setLoading(false)
      return
    }

    setProject(projectRow)
    setTasks(taskRows || [])
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))
    setLoading(false)
    loadAttachmentCounts(taskRows || [])
  }, [projectId, activeOrgId, loadAttachmentCounts])

  useEffect(() => { load() }, [load])

  const handleAddTask = async (e) => {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    setAddingTask(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('tasks').insert({
      project_id: projectId,
      org_id: activeOrgId,
      title: newTaskTitle.trim(),
      position: tasks.length,
      created_by: userData?.user?.id,
    })
    setAddingTask(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNewTaskTitle('')
    load()
  }

  const cycleStatus = async (task) => {
    const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length]
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ status: nextStatus }).eq('id', task.id)
    if (updateError) setError(updateError.message)
  }

  const updateTaskField = async (taskId, fields) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...fields } : t)))
    const { error: updateError } = await supabase.from('tasks').update(fields).eq('id', taskId)
    if (updateError) setError(updateError.message)
  }

  const deleteTask = async (taskId) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', taskId)
    if (deleteError) setError(deleteError.message)
  }

  const updateProjectStatus = async (status) => {
    setProject((prev) => ({ ...prev, status }))
    const { error: updateError } = await supabase.from('projects').update({ status }).eq('id', projectId)
    if (updateError) setError(updateError.message)
  }

  const handleCopyShareLink = async () => {
    const url = `${window.location.origin}/share/${project.public_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      setError('Could not copy automatically — the link is: ' + url)
    }
  }

  const handleRegenerateLink = async () => {
    const { data: newToken, error: rpcError } = await supabase.rpc('regenerate_project_share_token', {
      project_id_param: projectId,
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setProject((prev) => ({ ...prev, public_token: newToken }))
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
  }

  if (!project) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Project not found, or you don't have access.</p>
        <Link to="/" className="text-sm underline">Back to projects</Link>
      </div>
    )
  }

  const done = tasks.filter((t) => t.status === 'done').length
  const percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  return (
    <div>
      <Link to="/" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; All projects</Link>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <span className="font-mono text-xs" style={{ color: 'var(--ink-muted)' }}>
            PRJ-{project.id.slice(0, 4).toUpperCase()}
          </span>
          <select
            value={project.status}
            onChange={(e) => updateProjectStatus(e.target.value)}
            className="text-xs font-mono uppercase rounded-md border px-2 py-1"
            style={{ borderColor: 'var(--border)' }}
            aria-label="Project status"
          >
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <h1 className="font-display font-bold text-2xl mb-1">{project.name}</h1>
        {project.client_name && <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>{project.client_name}</p>}
        {project.description && <p className="text-sm mb-4">{project.description}</p>}

        <Scrubber percent={percent} tone={project.status === 'completed' ? 'done' : 'progress'} label="Project progress" />
        <p className="text-xs font-mono mt-2" style={{ color: 'var(--ink-muted)' }}>{done}/{tasks.length} tasks done</p>
      </div>

      <div className="rounded-lg border p-4 mb-6 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--panel-sunken)', borderColor: 'var(--border)' }}>
        <div className="min-w-0">
          <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Client link</p>
          <p className="text-sm truncate" style={{ color: 'var(--ink-muted)' }}>
            Read-only status page — no login needed. Anyone with this link can view it.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleCopyShareLink}
            className="text-sm rounded-md border px-3 py-1.5"
            style={{ borderColor: 'var(--border)' }}
          >
            {copiedLink ? 'Copied!' : 'Copy link'}
          </button>
          <button
            onClick={handleRegenerateLink}
            className="text-sm rounded-md border px-3 py-1.5"
            style={{ borderColor: 'var(--border)' }}
            title="Invalidates the old link and creates a new one"
          >
            Reset link
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      <h2 className="font-display font-bold text-lg mb-3">Tasks</h2>

      <form onSubmit={handleAddTask} className="flex gap-2 mb-4">
        <label htmlFor="new-task" className="sr-only">New task title</label>
        <input
          id="new-task"
          type="text"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        />
        <button
          type="submit"
          disabled={addingTask}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          Add
        </button>
      </form>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No tasks yet — add the first one above.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
              style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
            >
              <button
                onClick={() => cycleStatus(task)}
                className="flex-shrink-0"
                aria-label={`Cycle status for ${task.title}, currently ${task.status.replace('_', ' ')}`}
                title="Click to change status"
              >
                <TallyDot status={task.status} showLabel={false} />
              </button>

              <span
                className="flex-1 text-sm min-w-0 truncate"
                style={task.status === 'done' ? { textDecoration: 'line-through', color: 'var(--ink-muted)' } : undefined}
              >
                {task.title}
              </span>

              <select
                value={task.assignee_id || ''}
                onChange={(e) => updateTaskField(task.id, { assignee_id: e.target.value || null })}
                className="text-xs rounded-md border px-2 py-1 hidden sm:block flex-shrink-0 max-w-[120px]"
                style={{ borderColor: 'var(--border)' }}
                aria-label={`Assignee for ${task.title}`}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>
                ))}
              </select>

              <input
                type="date"
                value={task.due_date || ''}
                onChange={(e) => updateTaskField(task.id, { due_date: e.target.value || null })}
                className="text-xs font-mono rounded-md border px-2 py-1 hidden sm:block flex-shrink-0"
                style={{ borderColor: 'var(--border)' }}
                aria-label={`Due date for ${task.title}`}
              />

              <button
                onClick={() => setAttachmentsTask(task)}
                className="text-xs flex-shrink-0 rounded-md border px-2 py-1"
                style={{ borderColor: 'var(--border)' }}
                aria-label={`Links for ${task.title}`}
              >
                🔗{attachmentCounts[task.id] ? ` ${attachmentCounts[task.id]}` : ''}
              </button>

              <button
                onClick={() => deleteTask(task.id)}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--tally-alert)' }}
                aria-label={`Delete ${task.title}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachmentsTask && (
        <TaskAttachmentsDialog
          orgId={activeOrgId}
          task={attachmentsTask}
          onClose={() => { setAttachmentsTask(null); loadAttachmentCounts() }}
        />
      )}
    </div>
  )
}
