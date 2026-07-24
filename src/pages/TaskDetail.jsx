import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'
import AttachmentsList from '../components/AttachmentsList'
import ActivityLog from '../components/ActivityLog'
import { formatMoney } from '../lib/currency'

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
  const [assignees, setAssignees] = useState([])
  const [comments, setComments] = useState([])
  const [invoices, setInvoices] = useState([])
  const [relations, setRelations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newAssigneeId, setNewAssigneeId] = useState('')
  const [newAssigneeRole, setNewAssigneeRole] = useState('')
  const [addingAssignee, setAddingAssignee] = useState(false)

  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  const [relationSearch, setRelationSearch] = useState('')
  const [relationResults, setRelationResults] = useState([])

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const { data: taskRow, error: taskError } = await supabase
      .from('tasks').select('*').eq('id', taskId).single()

    if (taskError) {
      setError(taskError.message)
      setLoading(false)
      return
    }
    setTask(taskRow)

    const [
      { data: projectRow },
      { data: memberRows },
      { data: assigneeRows },
      { data: commentRows },
      { data: relationRows },
    ] = await Promise.all([
      taskRow.project_id
        ? supabase.from('projects').select('id, name, client_name, client_website, description, status').eq('id', taskRow.project_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('org_members').select('user_id, profiles ( id, full_name )').eq('org_id', activeOrgId),
      supabase.from('task_assignees').select('user_id, role_label, created_at, profiles ( id, full_name )').eq('task_id', taskId).order('created_at', { ascending: true }),
      supabase.from('task_comments').select('id, body, author_id, created_at, profiles ( full_name )').eq('task_id', taskId).order('created_at', { ascending: true }),
      supabase.from('task_relations').select('related_task_id, tasks!task_relations_related_task_id_fkey ( id, title, status, project_id, projects ( name ) )').eq('task_id', taskId),
    ])

    setProject(projectRow || null)
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))
    setAssignees(assigneeRows || [])
    setComments(commentRows || [])
    setRelations(relationRows || [])

    // Invoices: whichever is tied specifically to this task, plus whichever
    // is tied to the whole project this task belongs to (if any).
    let invoiceQuery = supabase.from('invoices').select('id, invoice_number, client_name, status, currency, total_amount, due_date, task_id')
    invoiceQuery = taskRow.project_id
      ? invoiceQuery.or(`task_id.eq.${taskId},project_id.eq.${taskRow.project_id}`)
      : invoiceQuery.eq('task_id', taskId)
    const { data: invoiceRows } = await invoiceQuery
    setInvoices(invoiceRows || [])

    setLoading(false)
  }, [taskId, activeOrgId])

  useEffect(() => { load() }, [load])

  const updateField = async (fields) => {
    setTask((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('tasks').update(fields).eq('id', taskId)
    if (updateError) setError(updateError.message)
  }

  const handleDeleteTask = async () => {
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', taskId)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    navigate(task.project_id ? `/projects/${task.project_id}` : '/my-tasks')
  }

  const handleAddAssignee = async (e) => {
    e.preventDefault()
    if (!newAssigneeId) return
    setAddingAssignee(true)
    const { error: insertError } = await supabase.from('task_assignees').insert({
      task_id: taskId,
      user_id: newAssigneeId,
      role_label: newAssigneeRole.trim() || null,
      org_id: activeOrgId,
    })
    setAddingAssignee(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNewAssigneeId('')
    setNewAssigneeRole('')
    load()
  }

  const handleRemoveAssignee = async (userId) => {
    setAssignees((prev) => prev.filter((a) => a.user_id !== userId))
    const { error: deleteError } = await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', userId)
    if (deleteError) setError(deleteError.message)
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
      setError(insertError.message)
      return
    }
    setNewComment('')
    load()
  }

  const handleDeleteComment = async (commentId) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    const { error: deleteError } = await supabase.from('task_comments').delete().eq('id', commentId)
    if (deleteError) setError(deleteError.message)
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
      setError(insertError.message)
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

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  if (!task) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Task not found, or you don't have access.</p>
        <Link to="/my-tasks" className="text-sm underline">Back to My Tasks</Link>
      </div>
    )
  }

  const assignedUserIds = new Set(assignees.map((a) => a.user_id))
  const availableMembers = members.filter((m) => !assignedUserIds.has(m.id))

  return (
    <div className="max-w-2xl">
      <Link
        to={task.project_id ? `/projects/${task.project_id}` : '/my-tasks'}
        className="text-sm inline-block mb-4"
        style={{ color: 'var(--ink-muted)' }}
      >
        &larr; {task.project_id ? 'Back to project' : 'Back to My Tasks'}
      </Link>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
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
              <option value="done">Done</option>
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

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
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
              This is a standalone task — not linked to any project. Fill in client details directly if relevant.
            </p>
            <div>
              <label htmlFor="client-name" className="block text-sm font-medium mb-1">Client name</label>
              <input
                id="client-name"
                type="text"
                defaultValue={task.client_name || ''}
                onBlur={(e) => updateField({ client_name: e.target.value.trim() || null })}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="client-website" className="block text-sm font-medium mb-1">Client website</label>
              <input
                id="client-website"
                type="text"
                defaultValue={task.client_website || ''}
                onBlur={(e) => updateField({ client_website: e.target.value.trim() || null })}
                placeholder="https://…"
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="brand-guidelines" className="block text-sm font-medium mb-1">Project details / brand guidelines</label>
              <textarea
                id="brand-guidelines"
                defaultValue={task.brand_guidelines || ''}
                onBlur={(e) => updateField({ brand_guidelines: e.target.value.trim() || null })}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Assigned members</h2>
        {assignees.length === 0 ? (
          <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>Nobody added yet.</p>
        ) : (
          <ul className="space-y-1.5 mb-3">
            {assignees.map((a) => (
              <li key={a.user_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm">
                  {a.profiles?.full_name || 'Member'}
                  {a.role_label && <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>({a.role_label})</span>}
                </span>
                <button onClick={() => handleRemoveAssignee(a.user_id)} className="text-xs flex-shrink-0" style={{ color: 'var(--tally-alert)' }}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddAssignee} className="flex flex-col sm:flex-row gap-2">
          <label htmlFor="new-assignee" className="sr-only">Add a member</label>
          <select
            id="new-assignee"
            value={newAssigneeId}
            onChange={(e) => setNewAssigneeId(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm flex-1"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">Choose a member…</option>
            {availableMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>)}
          </select>
          <label htmlFor="new-assignee-role" className="sr-only">Role (optional)</label>
          <input
            id="new-assignee-role"
            type="text"
            value={newAssigneeRole}
            onChange={(e) => setNewAssigneeRole(e.target.value)}
            placeholder="Role (optional), e.g. Graphic Designer"
            className="rounded-md border px-3 py-2 text-sm flex-1"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            type="submit"
            disabled={addingAssignee || !newAssigneeId}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex-shrink-0"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            Add
          </button>
        </form>
      </div>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Attachments</h2>
        <AttachmentsList orgId={activeOrgId} parentType="task" parentId={taskId} />
      </div>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
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

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
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
                  className="w-full text-left text-sm rounded-md border px-3 py-2 hover:bg-black/5 transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  + {t.title} {t.projects?.name && <span style={{ color: 'var(--ink-muted)' }}>({t.projects.name})</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Notes</h2>
        {comments.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>No notes yet.</p>
        ) : (
          <ul className="space-y-3 mb-4">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{comment.profiles?.full_name || 'Someone'}</span>
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

      <ActivityLog entityType="task" entityId={taskId} />
    </div>
  )
}
