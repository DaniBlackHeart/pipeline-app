import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errorMessages'

// Everything moved to trash from a per-row "Trash" button or the bulk
// action bar (ProjectDetail.jsx, TaskDetail.jsx) lands here -- a soft
// delete just sets deleted_at, so nothing shown on this page has actually
// left the database yet. Restoring is available to any workspace member
// (matching the fact that moving a task here in the first place already
// was); permanently deleting is admin-only, since that's the one
// irreversible step in the whole flow.
export default function Trash() {
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')
    const { data, error: fetchError } = await supabase
      .from('tasks')
      .select('id, title, status, project_id, deleted_at, projects ( id, name )')
      .eq('org_id', activeOrgId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (fetchError) {
      setError(friendlyError(fetchError))
      setLoading(false)
      return
    }
    setTasks(data || [])
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const handleRestore = async (taskId) => {
    setBusyId(taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    const { error: updateError } = await supabase.from('tasks').update({ deleted_at: null }).eq('id', taskId)
    if (updateError) setError(friendlyError(updateError))
    setBusyId(null)
  }

  const handlePermanentlyDelete = async (task) => {
    if (!window.confirm(`Permanently delete "${task.title}"? This cannot be undone.`)) return
    setBusyId(task.id)
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id)
    if (deleteError) setError(friendlyError(deleteError))
    setBusyId(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Trash</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
            Tasks moved to trash from a project or task page. Restore them, or remove them for good.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading trash…</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="font-display font-bold text-lg mb-1">Trash is empty</p>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Tasks you delete show up here until restored or permanently removed.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3 flex-wrap sm:flex-nowrap"
              style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
            >
              <Link
                to={`/tasks/${task.id}`}
                className="flex-1 text-sm min-w-0 truncate order-1 sm:order-none w-full sm:w-auto underline"
                style={{ color: 'var(--ink-muted)' }}
              >
                {task.title}
              </Link>

              {task.projects?.id ? (
                <span className="text-xs font-mono flex-shrink-0 truncate max-w-[140px]" style={{ color: 'var(--ink-muted)' }}>
                  {task.projects.name}
                </span>
              ) : (
                <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>Standalone</span>
              )}

              <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                deleted {new Date(task.deleted_at).toLocaleDateString()}
              </span>

              <button
                onClick={() => handleRestore(task.id)}
                disabled={busyId === task.id}
                className="text-xs flex-shrink-0 underline"
              >
                Restore
              </button>

              {isAdmin && (
                <button
                  onClick={() => handlePermanentlyDelete(task)}
                  disabled={busyId === task.id}
                  className="text-xs flex-shrink-0"
                  style={{ color: 'var(--tally-alert)' }}
                >
                  Delete permanently
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
