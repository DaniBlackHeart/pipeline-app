import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'

const STATUS_CYCLE = ['todo', 'in_progress', 'done']

export default function MyTasks() {
  const { activeOrgId, user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('active')

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

  const cycleStatus = async (task) => {
    const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length]
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ status: nextStatus }).eq('id', task.id)
    if (updateError) setError(updateError.message)
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
      <h1 className="font-display font-bold text-2xl tracking-tight mb-1">My Tasks</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        {activeCount} active{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''} — across every project in this workspace.
      </p>

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

                <span
                  className="flex-1 text-sm min-w-0 truncate order-1 sm:order-none w-full sm:w-auto"
                  style={task.status === 'done' ? { textDecoration: 'line-through', color: 'var(--ink-muted)' } : undefined}
                >
                  {task.title}
                </span>

                {task.projects?.id && (
                  <Link
                    to={`/projects/${task.projects.id}`}
                    className="text-xs font-mono flex-shrink-0 underline truncate max-w-[140px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {task.projects.name}
                  </Link>
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
