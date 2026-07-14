import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Scrubber from '../components/Scrubber'
import TallyDot from '../components/TallyDot'
import NewProjectDialog from '../components/NewProjectDialog'

export default function Dashboard() {
  const { activeOrgId } = useAuth()
  const [projects, setProjects] = useState([])
  const [taskCounts, setTaskCounts] = useState({}) // { [project_id]: { total, done } }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: projectRows, error: projectError }, { data: taskRows, error: taskError }] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, client_name, status, due_date')
        .eq('org_id', activeOrgId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select('project_id, status')
        .eq('org_id', activeOrgId),
    ])

    if (projectError || taskError) {
      setError((projectError || taskError).message)
      setLoading(false)
      return
    }

    const counts = {}
    for (const row of taskRows || []) {
      counts[row.project_id] ??= { total: 0, done: 0 }
      counts[row.project_id].total += 1
      if (row.status === 'done') counts[row.project_id].done += 1
    }

    setProjects(projectRows || [])
    setTaskCounts(counts)
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const isOverdue = (dueDate, status) =>
    dueDate && status !== 'completed' && new Date(dueDate) < new Date(new Date().toDateString())

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Projects</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Everything in flight, at a glance.
          </p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          + New project
        </button>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading projects…</p>
      ) : projects.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-10 text-center"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="font-display font-bold text-lg mb-1">No projects yet</p>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
            Start your first one — it takes about ten seconds.
          </p>
          <button
            onClick={() => setShowNewProject(true)}
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            + New project
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => {
            const counts = taskCounts[project.id] || { total: 0, done: 0 }
            const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0
            const overdue = isOverdue(project.due_date, project.status)
            const tone = overdue ? 'alert' : project.status === 'completed' ? 'done' : 'progress'

            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="block rounded-lg border p-5 hover:shadow-sm transition-shadow"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-mono text-xs tracking-wide" style={{ color: 'var(--ink-muted)' }}>
                    PRJ-{project.id.slice(0, 4).toUpperCase()}
                  </span>
                  <TallyDot status={overdue ? 'on_hold' : project.status} showLabel={false} />
                </div>
                <h2 className="font-display font-bold text-lg leading-snug mb-1">{project.name}</h2>
                {project.client_name && (
                  <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>{project.client_name}</p>
                )}

                <Scrubber percent={percent} tone={tone} label={`${project.name} progress`} />

                <div className="flex items-center justify-between mt-2 text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                  <span>{counts.done}/{counts.total} tasks done</span>
                  {project.due_date && (
                    <span style={overdue ? { color: 'var(--tally-alert)' } : undefined}>
                      due {new Date(project.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {showNewProject && (
        <NewProjectDialog
          orgId={activeOrgId}
          onClose={() => setShowNewProject(false)}
          onCreated={() => { setShowNewProject(false); load() }}
        />
      )}
    </div>
  )
}
