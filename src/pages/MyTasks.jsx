import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'

const STATUS_CYCLE = ['todo', 'in_progress', 'done']

export default function MyTasks() {
  const { activeOrgId, activeOrg, user } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('active')

  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [newAssigneeId, setNewAssigneeId] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!activeOrgId || !user) return
    setLoading(true)
    setError('')

    const { data, error: fetchError } = await supabase
      .from('tasks')
      .select('id, title, status, due_date, project_id, projects ( id, name )')
      .eq('org_id', activeOrgId)
      .eq('assignee_id', user.id)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setTasks(data || [])
    setLoading(false)
  }, [activeOrgId, user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!activeOrgId || !isAdmin) return
    Promise.all([
      supabase.from('projects').select('id, name').eq('org_id', activeOrgId).neq('status', 'archived').order('name'),
      supabase.from('org_members').select('user_id, profiles ( id, full_name )').eq('org_id', activeOrgId),
    ]).then(([{ data: projectData }, { data: memberData }]) => {
      setProjects(projectData || [])
      setMembers((memberData || []).map((m) => m.profiles).filter(Boolean))
    })
  }, [activeOrgId, isAdmin])

  const cycleStatus = async (task) => {
    const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length]
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ status: nextStatus }).eq('id', task.id)
    if (updateError) setError(updateError.message)
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    setError('')
    if (!newTitle.trim()) {
      setError('Give the task a title.')
      return
    }
    setCreating(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('tasks').insert({
      org_id: activeOrgId,
      project_id: newProjectId || null,
      title: newTitle.trim(),
      assignee_id: newAssigneeId || null,
      due_date: newDueDate || null,
      created_by: userData?.user?.id,
    })
    setCreating(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNewTitle('')
    setNewProjectId('')
    setNewAssigneeId('')
    setNewDueDate('')
    setShowNewTask(false)
    load()
  }

  const isOverdue = (dueDate, status) =>
    dueDate && status !== 'done' && dueDate < new Date().toISOString().slice(0, 10)

  const filtered = tasks.filter((t) => {
    if (filter === 'all') return true
    if (filter === 'done') return t.status === 'done'
    return t.status !== 'done' // 'active'
  })

  const activeCount = tasks.filter((t) => t.status !== 'done').length
  const overdueCount = tasks.filter((t) => isOverdue(t.due_date, t.status)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h1 className="font-display font-bold text-2xl tracking-tight">My Tasks</h1>
        {isAdmin && (
          <button
            onClick={() => setShowNewTask((s) => !s)}
            className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            + New task
          </button>
        )}
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        {activeCount} active{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''} — across every project in this workspace.
      </p>

      {showNewTask && (
        <form onSubmit={handleCreateTask} className="rounded-lg border p-4 mb-6 space-y-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Creates a task here directly — pick a project to attach it to one, or leave it standalone (e.g. for internal work not tied to a client project).
          </p>
          <div>
            <label htmlFor="new-task-title" className="sr-only">Task title</label>
            <input
              id="new-task-title"
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Task title…"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <select
              value={newProjectId}
              onChange={(e) => setNewProjectId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">No project (standalone)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={newAssigneeId}
              onChange={(e) => setNewAssigneeId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>)}
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowNewTask(false)}
              className="rounded-md px-4 py-2 text-sm font-medium border"
              style={{ borderColor: 'var(--border)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              {creating ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: 'active', label: 'Active' },
          { key: 'done', label: 'Done' },
          { key: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="text-xs font-mono uppercase tracking-wide rounded-full px-3 py-1 border transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: filter === f.key ? 'var(--ink)' : 'transparent',
              color: filter === f.key ? 'var(--panel)' : 'var(--ink-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading your tasks…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">Nothing here</p>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            {filter === 'active' ? "You're all caught up — no active tasks assigned to you." : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((task) => {
            const overdue = isOverdue(task.due_date, task.status)
            return (
              <li
                key={task.id}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 flex-wrap sm:flex-nowrap"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              >
                <button
                  onClick={() => cycleStatus(task)}
                  className="flex-shrink-0"
                  aria-label={`Cycle status for ${task.title}, currently ${task.status.replace('_', ' ')}`}
                  title="Click to change status"
                >
                  <TallyDot status={overdue ? 'on_hold' : task.status} showLabel={false} />
                </button>

                <Link
                  to={`/tasks/${task.id}`}
                  className="flex-1 text-sm min-w-0 truncate order-1 sm:order-none w-full sm:w-auto underline"
                  style={task.status === 'done' ? { textDecoration: 'line-through', color: 'var(--ink-muted)' } : undefined}
                >
                  {task.title}
                </Link>

                {task.projects?.id ? (
                  <Link
                    to={`/projects/${task.projects.id}`}
                    className="text-xs font-mono flex-shrink-0 underline truncate max-w-[140px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {task.projects.name}
                  </Link>
                ) : (
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    Standalone
                  </span>
                )}

                {task.due_date && (
                  <span
                    className="text-xs font-mono flex-shrink-0"
                    style={overdue ? { color: 'var(--tally-alert)' } : { color: 'var(--ink-muted)' }}
                  >
                    {overdue ? 'overdue ' : 'due '}{new Date(task.due_date).toLocaleDateString()}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
