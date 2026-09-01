import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'
import AttachmentsList from '../components/AttachmentsList'
import ActivityLog from '../components/ActivityLog'
import ClientPicker from '../components/ClientPicker'
import AssignedMembers from '../components/AssignedMembers'
import { formatMoney } from '../lib/currency'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'
import {
  resolveHourlyRate,
  formatDuration,
  elapsedMinutesSince,
  fetchRunningEntry,
  startTimer,
  stopTimer,
  addManualEntry,
  deleteEntry,
  unbillEntries,
  fetchTaskEntries,
  sumMinutes,
  minutesToHours,
} from '../lib/timeTracking'

function deriveInvoiceDisplayStatus(invoice) {
  if (invoice.status === 'sent' && invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10)) {
    return 'overdue'
  }
  return invoice.status
}

export default function TaskDetail() {
  const { taskId } = useParams()
  const { activeOrgId, user } = useAuth()
  const navigate = useNavigate()

  const [task, setTask] = useState(null)
  const [project, setProject] = useState(null)
  const [members, setMembers] = useState([])
  const [comments, setComments] = useState([])
  const [invoices, setInvoices] = useState([])
  const [relations, setRelations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  const [relationSearch, setRelationSearch] = useState('')
  const [relationResults, setRelationResults] = useState([])

  const [timeEntries, setTimeEntries] = useState([])
  const [runningElsewhere, setRunningElsewhere] = useState(null)
  const [orgDefaultRate, setOrgDefaultRate] = useState(null)
  const [timerBusy, setTimerBusy] = useState(false)
  const [, setElapsedTick] = useState(0)
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [manualHours, setManualHours] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [addingManual, setAddingManual] = useState(false)
  const [timeError, setTimeError] = useState('')

  // Scoped to the current user specifically -- another org member's
  // running timer on this same task must never hide your own Start
  // button or become something your Stop button tries to act on (RLS
  // would reject that anyway, but the UI shouldn't offer it).
  const runningEntry = timeEntries.find((e) => e.started_at && e.user_id === user?.id) || null
  const othersRunning = timeEntries.filter((e) => e.started_at && e.user_id !== user?.id)
  const effectiveRate = resolveHourlyRate({ orgDefaultRate, projectRate: project?.hourly_rate })
  const completedMinutes = sumMinutes(timeEntries.filter((e) => !e.started_at))
  const runningMinutes = runningEntry ? elapsedMinutesSince(runningEntry.started_at) : 0
  const totalMinutes = completedMinutes + runningMinutes
  const totalHours = minutesToHours(totalMinutes)

  const anyoneRunning = runningEntry || othersRunning.length > 0
  useEffect(() => {
    if (!anyoneRunning) return
    const id = setInterval(() => setElapsedTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [anyoneRunning])

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const { data: taskRow, error: taskError } = await supabase
      .from('tasks').select('*').eq('id', taskId).single()

    if (taskError) {
      setError(friendlyError(taskError))
      setLoading(false)
      return
    }
    setTask(taskRow)

    const [
      { data: projectRow },
      { data: memberRows },
      { data: commentRows },
      { data: relationRows },
      { data: orgRow },
      { data: timeEntryRows },
      { data: runningRow },
    ] = await Promise.all([
      taskRow.project_id
        ? supabase.from('projects').select('id, name, client_id, client_name, client_website, description, status, hourly_rate').eq('id', taskRow.project_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('org_members').select('user_id, profiles ( id, full_name, nickname )').eq('org_id', activeOrgId),
      supabase.from('task_comments').select('id, body, author_id, created_at, profiles ( full_name, nickname )').eq('task_id', taskId).order('created_at', { ascending: true }),
      supabase.from('task_relations').select('related_task_id, tasks!task_relations_related_task_id_fkey ( id, title, status, project_id, projects ( name ) )').eq('task_id', taskId),
      supabase.from('organizations').select('default_hourly_rate').eq('id', activeOrgId).single(),
      fetchTaskEntries(taskId),
      user?.id ? fetchRunningEntry({ orgId: activeOrgId, userId: user.id }) : Promise.resolve({ data: null }),
    ])

    setProject(projectRow || null)
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))
    setComments(commentRows || [])
    setRelations(relationRows || [])
    setOrgDefaultRate(orgRow?.default_hourly_rate ?? null)
    setTimeEntries(timeEntryRows || [])
    setRunningElsewhere(runningRow && runningRow.task_id !== taskId ? runningRow : null)

    // Invoices: whichever is tied specifically to this task, plus whichever
    // is tied to the whole project this task belongs to (if any).
    let invoiceQuery = supabase.from('invoices').select('id, invoice_number, client_name, status, currency, total_amount, due_date, task_id')
    invoiceQuery = taskRow.project_id
      ? invoiceQuery.or(`task_id.eq.${taskId},project_id.eq.${taskRow.project_id}`)
      : invoiceQuery.eq('task_id', taskId)
    const { data: invoiceRows } = await invoiceQuery
    setInvoices(invoiceRows || [])

    setLoading(false)
  }, [taskId, activeOrgId, user?.id])

  useEffect(() => { load() }, [load])

  const updateField = async (fields) => {
    setTask((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('tasks').update(fields).eq('id', taskId)
    if (updateError) setError(friendlyError(updateError))
  }

  const handleDeleteTask = async () => {
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', taskId)
    if (deleteError) {
      setError(friendlyError(deleteError))
      return
    }
    navigate(task.project_id ? `/projects/${task.project_id}` : '/my-tasks')
  }

  const handlePostComment = async (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    setPostingComment(true)
    const { error: insertError } = await supabase.from('task_comments').insert({
      task_id: taskId,
      org_id: activeOrgId,
      author_id: user?.id,
      body: newComment.trim(),
    })
    setPostingComment(false)
    if (insertError) {
      setError(friendlyError(insertError))
      return
    }
    setNewComment('')
    load()
  }

  const handleDeleteComment = async (commentId) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    const { error: deleteError } = await supabase.from('task_comments').delete().eq('id', commentId)
    if (deleteError) setError(friendlyError(deleteError))
  }

  const handleSearchRelated = async (query) => {
    setRelationSearch(query)
    if (!query.trim()) {
      setRelationResults([])
      return
    }
    const linkedIds = relations.map((r) => r.related_task_id)
    const { data } = await supabase
      .from('tasks')
      .select('id, title, project_id, projects ( name )')
      .eq('org_id', activeOrgId)
      .ilike('title', `%${query.trim()}%`)
      .neq('id', taskId)
      .limit(8)
    setRelationResults((data || []).filter((t) => !linkedIds.includes(t.id)))
  }

  const handleAddRelation = async (otherTask) => {
    setError('')
    const { error: insertError } = await supabase.from('task_relations').insert([
      { task_id: taskId, related_task_id: otherTask.id, org_id: activeOrgId },
      { task_id: otherTask.id, related_task_id: taskId, org_id: activeOrgId },
    ])
    if (insertError) {
      setError(friendlyError(insertError))
      return
    }
    setRelationSearch('')
    setRelationResults([])
    load()
  }

  const handleRemoveRelation = async (relatedTaskId) => {
    setRelations((prev) => prev.filter((r) => r.related_task_id !== relatedTaskId))
    await supabase.from('task_relations').delete().eq('task_id', taskId).eq('related_task_id', relatedTaskId)
    await supabase.from('task_relations').delete().eq('task_id', relatedTaskId).eq('related_task_id', taskId)
  }

  const handleStartTimer = async () => {
    if (!user?.id || runningElsewhere) return
    setTimeError('')
    setTimerBusy(true)
    const { error: startError } = await startTimer({ orgId: activeOrgId, taskId, userId: user.id })
    setTimerBusy(false)
    if (startError) {
      setTimeError(friendlyError(startError))
      return
    }
    load()
  }

  const handleStopTimer = async () => {
    if (!runningEntry) return
    setTimeError('')
    setTimerBusy(true)
    const { error: stopError } = await stopTimer({ entryId: runningEntry.id, startedAt: runningEntry.started_at })
    setTimerBusy(false)
    if (stopError) {
      setTimeError(friendlyError(stopError))
      return
    }
    load()
  }

  const handleAddManualEntry = async (e) => {
    e.preventDefault()
    setTimeError('')
    const hours = Number(manualHours)
    if (!manualDate || !Number.isFinite(hours) || hours <= 0) {
      setTimeError('Enter a date and a number of hours greater than 0.')
      return
    }
    setAddingManual(true)
    const { error: insertError } = await addManualEntry({
      orgId: activeOrgId,
      taskId,
      userId: user.id,
      entryDate: manualDate,
      minutes: Math.round(hours * 60),
      note: manualNote,
    })
    setAddingManual(false)
    if (insertError) {
      setTimeError(friendlyError(insertError))
      return
    }
    setManualHours('')
    setManualNote('')
    load()
  }

  const handleDeleteEntry = async (entryId) => {
    setTimeEntries((prev) => prev.filter((e) => e.id !== entryId))
    const { error: deleteError } = await deleteEntry(entryId)
    if (deleteError) setTimeError(friendlyError(deleteError))
  }

  const handleUnbillEntry = async (entryId) => {
    setTimeError('')
    const { error: unbillError } = await unbillEntries([entryId])
    if (unbillError) {
      setTimeError(friendlyError(unbillError))
      return
    }
    load()
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  if (!task) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Task not found, or you don't have access.</p>
        <Link to="/my-tasks" className="text-sm underline">Back to My Tasks</Link>
      </div>
    )
  }

  return (
    <div>
      <Link
        to={task.project_id ? `/projects/${task.project_id}` : '/my-tasks'}
        className="text-sm inline-block mb-4"
        style={{ color: 'var(--ink-muted)' }}
      >
        &larr; {task.project_id ? 'Back to project' : 'Back to My Tasks'}
      </Link>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2 mb-6">
      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <TallyDot status={task.status} showLabel={false} />
            <select
              value={task.status}
              onChange={(e) => updateField({ status: e.target.value })}
              className="text-xs font-mono uppercase rounded-md border px-2 py-1"
              style={{ borderColor: 'var(--border)' }}
              aria-label="Task status"
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Completed</option>
            </select>
          </div>
          <button onClick={handleDeleteTask} className="text-xs flex-shrink-0" style={{ color: 'var(--tally-alert)' }}>
            Delete task
          </button>
        </div>

        <label htmlFor="task-title" className="sr-only">Task title</label>
        <input
          id="task-title"
          type="text"
          value={task.title}
          onChange={(e) => setTask((prev) => ({ ...prev, title: e.target.value }))}
          onBlur={(e) => updateField({ title: e.target.value })}
          className="w-full font-display font-bold text-xl mb-4 rounded-md border-none px-0 py-1 bg-transparent"
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="start-date" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Start date</label>
            <input
              id="start-date"
              type="date"
              value={task.start_date || ''}
              onChange={(e) => updateField({ start_date: e.target.value || null })}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="due-date" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Due date</label>
            <input
              id="due-date"
              type="date"
              value={task.due_date || ''}
              onChange={(e) => updateField({ due_date: e.target.value || null })}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Project & client</h2>
        {project ? (
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Project</span>
              <Link to={`/projects/${project.id}`} className="underline">{project.name}</Link>
            </div>
            {project.client_name && (
              <div>
                <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Client</span>
                <span>{project.client_name}</span>
                {project.client_id && (
                  <>{' '}<Link to={`/clients/${project.client_id}`} className="text-xs underline">(view client)</Link></>
                )}
              </div>
            )}
            {project.client_website && (
              <div>
                <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Client website</span>
                <a href={project.client_website} target="_blank" rel="noreferrer" className="underline break-all">{project.client_website}</a>
              </div>
            )}
            {project.description && (
              <div>
                <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Project details</span>
                <p className="whitespace-pre-wrap">{project.description}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              This is a standalone task — not linked to any project. Link it to a client if relevant.
            </p>
            <ClientPicker
              id="task-client"
              orgId={activeOrgId}
              value={task.client_id}
              required={false}
              onSelect={(c) => updateField({ client_id: c?.id || null, client_name: c?.name || null, client_website: c?.website || null })}
            />
            {task.client_id && (
              <Link to={`/clients/${task.client_id}`} className="text-xs underline inline-block">View client page &rarr;</Link>
            )}
          </div>
        )}
      </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 mb-6">
      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <AssignedMembers orgId={activeOrgId} parentType="task" parentId={taskId} members={members} />
      </div>

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Task description</h2>
        <label htmlFor="task-description" className="sr-only">Task description</label>
        <textarea
          id="task-description"
          defaultValue={task.description || ''}
          onBlur={(e) => updateField({ description: e.target.value.trim() || null })}
          rows={3}
          placeholder="Notes, requirements, or anything else specific to this task…"
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        />
      </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 mb-6">
      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Attachments</h2>
        <AttachmentsList orgId={activeOrgId} parentType="task" parentId={taskId} />
      </div>

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No invoices linked to this task or its project.</p>
        ) : (
          <ul className="space-y-1.5">
            {invoices.map((inv) => {
              const displayStatus = deriveInvoiceDisplayStatus(inv)
              return (
                <li key={inv.id}>
                  <Link
                    to={`/invoices/${inv.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:shadow-sm transition-shadow"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-sm min-w-0 truncate">
                      <span className="font-mono">{inv.invoice_number}</span>
                      {' · '}{inv.client_name}
                      {inv.task_id === taskId ? (
                        <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>(for this task)</span>
                      ) : (
                        <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>(for the project)</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-medium">{formatMoney(inv.total_amount, inv.currency)}</span>
                      <TallyDot status={displayStatus} />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 mb-6">
      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Related tasks</h2>
        {relations.length === 0 ? (
          <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>No related tasks linked yet.</p>
        ) : (
          <ul className="space-y-1.5 mb-3">
            {relations.map((r) => (
              <li key={r.related_task_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <Link to={`/tasks/${r.related_task_id}`} className="text-sm min-w-0 truncate underline">
                  {r.tasks?.title || 'Untitled task'}
                  {r.tasks?.projects?.name && <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>({r.tasks.projects.name})</span>}
                </Link>
                <button onClick={() => handleRemoveRelation(r.related_task_id)} className="text-xs flex-shrink-0" style={{ color: 'var(--tally-alert)' }}>
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="relation-search" className="sr-only">Search tasks to link</label>
        <input
          id="relation-search"
          type="text"
          value={relationSearch}
          onChange={(e) => handleSearchRelated(e.target.value)}
          placeholder="Search tasks by title to link as related…"
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        />
        {relationResults.length > 0 && (
          <ul className="mt-2 space-y-1">
            {relationResults.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => handleAddRelation(t)}
                  className="w-full text-left text-sm rounded-md border px-3 py-2 hover-surface transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  + {t.title} {t.projects?.name && <span style={{ color: 'var(--ink-muted)' }}>({t.projects.name})</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Notes</h2>
        {comments.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>No notes yet.</p>
        ) : (
          <ul className="space-y-3 mb-4">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{getDisplayName(comment.profiles)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                      {new Date(comment.created_at).toLocaleString()}
                    </span>
                    {comment.author_id === user?.id && (
                      <button onClick={() => handleDeleteComment(comment.id)} className="text-xs" style={{ color: 'var(--tally-alert)' }}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handlePostComment} className="flex gap-2">
          <label htmlFor="new-note" className="sr-only">Add a note</label>
          <textarea
            id="new-note"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={2}
            placeholder="Add a note…"
            className="flex-1 rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            type="submit"
            disabled={postingComment}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 self-start flex-shrink-0"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            Post
          </button>
        </form>
      </div>
      </div>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <h2 className="font-display font-bold text-lg">Time tracking</h2>
          <div className="text-right">
            <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Total logged</p>
            <p className="font-display font-bold">
              {formatDuration(totalMinutes)}
              {effectiveRate != null && (
                <span className="ml-1.5 font-normal text-sm" style={{ color: 'var(--ink-muted)' }}>
                  ({formatMoney(totalHours * effectiveRate)})
                </span>
              )}
            </p>
          </div>
        </div>

        {timeError && (
          <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
            {timeError}
          </p>
        )}

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {runningEntry ? (
            <>
              <span className="font-mono text-sm rounded-md px-2 py-1" style={{ background: 'var(--tally-progress-soft)', color: 'var(--tally-progress-text)' }}>
                Running: {formatDuration(runningMinutes)}
              </span>
              <button
                onClick={handleStopTimer}
                disabled={timerBusy}
                className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                style={{ background: 'var(--ink)', color: 'var(--panel)' }}
              >
                Stop timer
              </button>
            </>
          ) : runningElsewhere ? (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              You have a timer running on another task — stop it there before starting one here.
            </p>
          ) : (
            <button
              onClick={handleStartTimer}
              disabled={timerBusy}
              className="rounded-md px-4 py-2 text-sm font-medium border disabled:opacity-60"
              style={{ borderColor: 'var(--border)' }}
            >
              Start timer
            </button>
          )}
          {othersRunning.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {othersRunning.map((e) => getDisplayName(e.profiles)).join(', ')} also currently tracking time here.
            </p>
          )}
        </div>

        <form onSubmit={handleAddManualEntry} className="grid sm:grid-cols-[140px_100px_1fr_auto] gap-2 mb-4 items-end">
          <div>
            <label htmlFor="manual-entry-date" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Date</label>
            <input
              id="manual-entry-date"
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="manual-entry-hours" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Hours</label>
            <input
              id="manual-entry-hours"
              type="number"
              min="0"
              step="0.25"
              value={manualHours}
              onChange={(e) => setManualHours(e.target.value)}
              placeholder="1.5"
              className="w-full rounded-md border px-2 py-1.5 text-sm font-mono"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="manual-entry-note" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Note (optional)</label>
            <input
              id="manual-entry-note"
              type="text"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              placeholder="What you worked on"
              className="w-full rounded-md border px-2 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <button
            type="submit"
            disabled={addingManual}
            className="rounded-md px-4 py-1.5 text-sm font-medium border disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          >
            + Log time
          </button>
        </form>

        {timeEntries.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No time logged on this task yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {timeEntries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                <span className="min-w-0 truncate">
                  <span className="font-mono">{entry.entry_date}</span>
                  {' · '}
                  {getDisplayName(entry.profiles)}
                  {' · '}
                  {entry.started_at ? `Running: ${formatDuration(elapsedMinutesSince(entry.started_at))}` : formatDuration(entry.minutes)}
                  {entry.note && <span style={{ color: 'var(--ink-muted)' }}> — {entry.note}</span>}
                  {entry.billed && <span className="ml-1.5 text-xs font-mono uppercase" style={{ color: 'var(--ink-muted)' }}>(billed)</span>}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {entry.billed && (
                    <button onClick={() => handleUnbillEntry(entry.id)} className="text-xs underline" style={{ color: 'var(--ink-muted)' }}>
                      Mark unbilled
                    </button>
                  )}
                  {!entry.started_at && (
                    <button onClick={() => handleDeleteEntry(entry.id)} className="text-xs" style={{ color: 'var(--tally-alert)' }}>
                      Delete
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ActivityLog entityType="task" entityId={taskId} />
    </div>
  )
}
