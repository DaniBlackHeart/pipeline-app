import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Scrubber from '../components/Scrubber'
import TallyDot from '../components/TallyDot'
import TaskAttachmentsDialog from '../components/TaskAttachmentsDialog'
import AttachmentsList from '../components/AttachmentsList'
import ActivityLog from '../components/ActivityLog'
import AssignedMembers from '../components/AssignedMembers'
import BulkTaskActionBar from '../components/BulkTaskActionBar'
import TemplatePicker from '../components/TemplatePicker'
import { QUICK_ROLES, reassignRole } from '../lib/roles'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'
import { formatMoney } from '../lib/currency'
import { applyTemplateToProject } from '../lib/taskTemplates'
import { resolveHourlyRate, formatDuration, minutesToHours, sumMinutes } from '../lib/timeTracking'

const STATUS_CYCLE = ['todo', 'in_progress', 'done']

function deriveInvoiceDisplayStatus(invoice) {
  if (invoice.status === 'sent' && invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10)) {
    return 'overdue'
  }
  return invoice.status
}

export default function ProjectDetail() {
  const { projectId } = useParams()
  const { activeOrgId, activeOrg } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [invoices, setInvoices] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newTaskMemberByRole, setNewTaskMemberByRole] = useState({})
  const [addingTask, setAddingTask] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [attachmentsTask, setAttachmentsTask] = useState(null)
  const [attachmentCounts, setAttachmentCounts] = useState({})
  const [descriptionInput, setDescriptionInput] = useState('')
  const [descriptionSaving, setDescriptionSaving] = useState(false)
  const [descriptionError, setDescriptionError] = useState('')
  const [descriptionSaved, setDescriptionSaved] = useState(false)
  const [showApplyTemplate, setShowApplyTemplate] = useState(false)
  const [templateSelection, setTemplateSelection] = useState({ templateId: '', roleAssignments: {} })
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [applyTemplateError, setApplyTemplateError] = useState('')

  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const [rateInput, setRateInput] = useState('')
  const [rateSaving, setRateSaving] = useState(false)
  const [rateSaved, setRateSaved] = useState(false)
  const [rateError, setRateError] = useState('')
  const [orgDefaultRate, setOrgDefaultRate] = useState(null)
  const [timeMinutes, setTimeMinutes] = useState({ billed: 0, unbilled: 0 })

  useEffect(() => {
    if (!project) return
    setDescriptionInput(project.description || '')
    setRateInput(project.hourly_rate != null ? String(project.hourly_rate) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

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
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: projectRow, error: projectError }, { data: taskRows, error: taskError }, { data: memberRows, error: memberError }, { data: orgRow }] =
      await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('tasks').select('*').eq('project_id', projectId).order('position', { ascending: true }),
        supabase.from('org_members').select('user_id, profiles ( id, full_name, nickname )').eq('org_id', activeOrgId),
        supabase.from('organizations').select('default_hourly_rate').eq('id', activeOrgId).single(),
      ])
    setOrgDefaultRate(orgRow?.default_hourly_rate ?? null)

    if (projectError || taskError || memberError) {
      setError(friendlyError(projectError || taskError || memberError))
      setLoading(false)
      return
    }

    setProject(projectRow)
    setTasks(taskRows || [])
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))

    // Invoices: whichever is tied to the project directly, plus whichever is
    // tied to one of the project's own tasks (the DB only ever sets one of
    // project_id/task_id, never both, so task-linked invoices wouldn't show
    // up under project_id alone).
    const taskIds = (taskRows || []).map((t) => t.id)
    const orParts = [`project_id.eq.${projectId}`]
    if (taskIds.length > 0) orParts.push(`task_id.in.(${taskIds.join(',')})`)
    const { data: invoiceRows } = await supabase
      .from('invoices')
      .select('id, invoice_number, client_name, status, currency, total_amount, due_date, task_id')
      .or(orParts.join(','))
    setInvoices(invoiceRows || [])

    if (taskIds.length > 0) {
      const { data: entryRows } = await supabase.from('time_entries').select('minutes, billed, started_at').in('task_id', taskIds)
      const completed = (entryRows || []).filter((e) => !e.started_at)
      setTimeMinutes({
        billed: sumMinutes(completed.filter((e) => e.billed)),
        unbilled: sumMinutes(completed.filter((e) => !e.billed)),
      })
    } else {
      setTimeMinutes({ billed: 0, unbilled: 0 })
    }

    setLoading(false)
    loadAttachmentCounts(taskRows || [])
  }, [projectId, activeOrgId, loadAttachmentCounts])

  useEffect(() => { load() }, [load])

  const handleTaskRoleChange = (role, userId) => {
    setNewTaskMemberByRole((prev) => reassignRole(prev, role, userId))
  }

  const handleAddTask = async (e) => {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    setAddingTask(true)
    const { data: userData } = await supabase.auth.getUser()
    const { data: inserted, error: insertError } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        org_id: activeOrgId,
        title: newTaskTitle.trim(),
        assignee_id: newTaskAssignee || null,
        start_date: new Date().toISOString().slice(0, 10),
        position: tasks.length,
        created_by: userData?.user?.id,
      })
      .select('id')
      .single()
    if (insertError) {
      setAddingTask(false)
      setError(friendlyError(insertError))
      return
    }
    const membersToAdd = Object.entries(newTaskMemberByRole).filter(([, userId]) => userId)
    if (membersToAdd.length > 0) {
      const { error: memberError } = await supabase.from('task_assignees').insert(
        membersToAdd.map(([role, userId]) => ({
          task_id: inserted.id,
          user_id: userId,
          role_label: role,
          org_id: activeOrgId,
        }))
      )
      if (memberError) {
        // Task itself was created fine -- don't block on this, just surface
        // it. Members can still be added from the task page afterward.
        setError(`Task created, but couldn't add members: ${friendlyError(memberError)}`)
        setAddingTask(false)
        setNewTaskTitle('')
        setNewTaskAssignee('')
        setNewTaskMemberByRole({})
        load()
        return
      }
    }
    setAddingTask(false)
    setNewTaskTitle('')
    setNewTaskAssignee('')
    setNewTaskMemberByRole({})
    load()
  }

  const cycleStatus = async (task) => {
    const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length]
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ status: nextStatus }).eq('id', task.id)
    if (updateError) setError(friendlyError(updateError))
  }

  const updateTaskField = async (taskId, fields) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...fields } : t)))
    const { error: updateError } = await supabase.from('tasks').update(fields).eq('id', taskId)
    if (updateError) setError(friendlyError(updateError))
  }

  const deleteTask = async (taskId) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', taskId)
    if (deleteError) setError(friendlyError(deleteError))
  }

  const toggleTaskSelected = (taskId) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const allTasksSelected = tasks.length > 0 && tasks.every((t) => selectedTaskIds.has(t.id))

  const toggleSelectAllTasks = () => {
    setSelectedTaskIds(allTasksSelected ? new Set() : new Set(tasks.map((t) => t.id)))
  }

  // Bulk actions apply to every selected row in one Supabase call
  // (`.in('id', ids)`) rather than one request per task -- RLS on
  // `tasks` is row-level (`is_org_member(org_id)`), so this works the
  // same way the single-row update above does, just batched. Selection
  // is left intact after a status/assignee/due-date change (so several
  // actions can be applied to the same batch in a row); it's cleared
  // after delete since the rows are gone.
  const bulkSetStatus = async (status) => {
    const ids = [...selectedTaskIds]
    setBulkBusy(true)
    setTasks((prev) => prev.map((t) => (selectedTaskIds.has(t.id) ? { ...t, status } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ status }).in('id', ids)
    if (updateError) setError(friendlyError(updateError))
    setBulkBusy(false)
  }

  const bulkSetDueDate = async (dueDate) => {
    const ids = [...selectedTaskIds]
    setBulkBusy(true)
    setTasks((prev) => prev.map((t) => (selectedTaskIds.has(t.id) ? { ...t, due_date: dueDate } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ due_date: dueDate }).in('id', ids)
    if (updateError) setError(friendlyError(updateError))
    setBulkBusy(false)
  }

  const bulkSetAssignee = async (assigneeId) => {
    const ids = [...selectedTaskIds]
    setBulkBusy(true)
    setTasks((prev) => prev.map((t) => (selectedTaskIds.has(t.id) ? { ...t, assignee_id: assigneeId } : t)))
    const { error: updateError } = await supabase.from('tasks').update({ assignee_id: assigneeId }).in('id', ids)
    if (updateError) setError(friendlyError(updateError))
    setBulkBusy(false)
  }

  const bulkDeleteTasks = async () => {
    const ids = [...selectedTaskIds]
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return
    setBulkBusy(true)
    setTasks((prev) => prev.filter((t) => !selectedTaskIds.has(t.id)))
    const { error: deleteError } = await supabase.from('tasks').delete().in('id', ids)
    if (deleteError) setError(friendlyError(deleteError))
    setSelectedTaskIds(new Set())
    setBulkBusy(false)
  }

  const updateProjectStatus = async (status) => {
    setProject((prev) => ({ ...prev, status }))
    const { error: updateError } = await supabase.from('projects').update({ status }).eq('id', projectId)
    if (updateError) setError(friendlyError(updateError))
  }

  const handleSaveDescription = async (e) => {
    e.preventDefault()
    setDescriptionError('')
    setDescriptionSaved(false)
    setDescriptionSaving(true)
    const trimmed = descriptionInput.trim() || null
    const { error: updateError } = await supabase.from('projects').update({ description: trimmed }).eq('id', projectId)
    setDescriptionSaving(false)
    if (updateError) {
      setDescriptionError(friendlyError(updateError))
      return
    }
    setProject((prev) => ({ ...prev, description: trimmed }))
    setDescriptionInput(trimmed || '')
    setDescriptionSaved(true)
  }

  const handleSaveRate = async (e) => {
    e.preventDefault()
    setRateError('')
    setRateSaved(false)
    const parsed = Number(rateInput)
    const value = rateInput.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null
    setRateSaving(true)
    const { error: updateError } = await supabase.from('projects').update({ hourly_rate: value }).eq('id', projectId)
    setRateSaving(false)
    if (updateError) {
      setRateError(friendlyError(updateError))
      return
    }
    setProject((prev) => ({ ...prev, hourly_rate: value }))
    setRateInput(value != null ? String(value) : '')
    setRateSaved(true)
  }

  const handleApplyTemplate = async () => {
    if (!templateSelection.templateId) return
    setApplyingTemplate(true)
    setApplyTemplateError('')
    const { data: userData } = await supabase.auth.getUser()
    const { error: applyError, taskCount } = await applyTemplateToProject({
      templateId: templateSelection.templateId,
      projectId,
      orgId: activeOrgId,
      existingTaskCount: tasks.length,
      roleAssignments: templateSelection.roleAssignments,
      createdBy: userData?.user?.id,
    })
    setApplyingTemplate(false)
    if (applyError) {
      const prefix = taskCount > 0 ? `Added ${taskCount} task${taskCount === 1 ? '' : 's'}, then stopped: ` : ''
      setApplyTemplateError(prefix + friendlyError(applyError))
      load()
      return
    }
    setShowApplyTemplate(false)
    setTemplateSelection({ templateId: '', roleAssignments: {} })
    load()
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
      setError(friendlyError(rpcError))
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
  const effectiveRate = resolveHourlyRate({ orgDefaultRate, projectRate: project.hourly_rate })
  const totalTimeMinutes = timeMinutes.billed + timeMinutes.unbilled

  return (
    <div>
      <Link to="/" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; All projects</Link>

      <div className="grid gap-6 sm:grid-cols-2 mb-6">
      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
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
        {project.client_name && (
          <p className="text-sm mb-1" style={{ color: 'var(--ink-muted)' }}>
            {project.client_name}
            {project.client_id && (
              <>{' · '}<Link to={`/clients/${project.client_id}`} className="underline">View client</Link></>
            )}
          </p>
        )}
        <p className="text-xs font-mono mb-3" style={{ color: 'var(--ink-muted)' }}>
          {project.start_date && `Starts ${new Date(project.start_date).toLocaleDateString()}`}
          {project.start_date && project.due_date && ' · '}
          {project.due_date && `Due ${new Date(project.due_date).toLocaleDateString()}`}
        </p>

        <Scrubber percent={percent} tone={project.status === 'completed' ? 'done' : 'progress'} label="Project progress" />
        <p className="text-xs font-mono mt-2 mb-3" style={{ color: 'var(--ink-muted)' }}>{done}/{tasks.length} tasks done</p>

        <form onSubmit={handleSaveRate} className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="project-hourly-rate" className="block text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>
              Hourly rate override
            </label>
            <input
              id="project-hourly-rate"
              type="number"
              min="0"
              step="0.01"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              placeholder={orgDefaultRate != null ? `Org default: ${orgDefaultRate}` : 'No org default set'}
              className="w-full rounded-md border px-2 py-1.5 text-sm font-mono"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <button
            type="submit"
            disabled={rateSaving}
            className="rounded-md px-3 py-1.5 text-sm font-medium border disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          >
            {rateSaving ? 'Saving…' : 'Save'}
          </button>
        </form>
        {rateError && <p className="text-xs mt-1" style={{ color: 'var(--tally-alert)' }}>{rateError}</p>}
        {rateSaved && <p className="text-xs mt-1" style={{ color: 'var(--tally-done)' }}>Saved.</p>}
      </div>

      <form onSubmit={handleSaveDescription} className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <label htmlFor="project-description" className="block text-sm font-medium mb-1">Description</label>
        <textarea
          id="project-description"
          value={descriptionInput}
          onChange={(e) => setDescriptionInput(e.target.value)}
          rows={3}
          placeholder="No description yet."
          className="w-full rounded-md border px-3 py-2 text-sm mb-3"
          style={{ borderColor: 'var(--border)' }}
        />

        {descriptionError && (
          <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
            {descriptionError}
          </p>
        )}
        {descriptionSaved && (
          <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done-text)' }} role="status">
            Description saved.
          </p>
        )}

        <button
          type="submit"
          disabled={descriptionSaving || descriptionInput === (project.description || '')}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          {descriptionSaving ? 'Saving…' : 'Save'}
        </button>
      </form>
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

      <div className="rounded-lg border p-4 mb-6 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="min-w-0">
          <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>Time logged (all tasks)</p>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            {formatDuration(timeMinutes.unbilled)} unbilled
            {timeMinutes.billed > 0 && ` · ${formatDuration(timeMinutes.billed)} already billed`}
          </p>
        </div>
        <p className="font-display font-bold text-lg flex-shrink-0">
          {formatDuration(totalTimeMinutes)}
          {effectiveRate != null && (
            <span className="ml-1.5 font-normal text-sm" style={{ color: 'var(--ink-muted)' }}>
              ({formatMoney(minutesToHours(totalTimeMinutes) * effectiveRate)} total)
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 mb-6">
      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <AssignedMembers orgId={activeOrgId} parentType="project" parentId={projectId} members={members} />
      </div>

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Attachments</h2>
        <AttachmentsList orgId={activeOrgId} parentType="project" parentId={projectId} />
      </div>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-display font-bold text-lg">Tasks</h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowApplyTemplate((v) => !v)}
            className="text-sm rounded-md border px-3 py-1.5"
            style={{ borderColor: 'var(--border)' }}
          >
            {showApplyTemplate ? 'Cancel' : 'Apply a template'}
          </button>
        )}
      </div>

      {isAdmin && showApplyTemplate && (
        <div className="rounded-lg border p-4 mb-4" style={{ borderColor: 'var(--border)' }}>
          <TemplatePicker
            orgId={activeOrgId}
            members={members}
            value={templateSelection}
            onChange={setTemplateSelection}
          />
          {applyTemplateError && (
            <p className="text-sm rounded-md px-3 py-2 mt-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
              {applyTemplateError}
            </p>
          )}
          <button
            type="button"
            onClick={handleApplyTemplate}
            disabled={!templateSelection.templateId || applyingTemplate}
            className="mt-3 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {applyingTemplate ? 'Adding tasks…' : 'Apply template'}
          </button>
        </div>
      )}

      {isAdmin ? (
        <div className="mb-4">
        <form onSubmit={handleAddTask} className="flex gap-2 mb-2 flex-wrap sm:flex-nowrap">
          <label htmlFor="new-task" className="sr-only">New task title</label>
          <input
            id="new-task"
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 min-w-[140px] rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
          />
          <label htmlFor="new-task-assignee" className="sr-only">Assignee</label>
          <select
            id="new-task-assignee"
            value={newTaskAssignee}
            onChange={(e) => setNewTaskAssignee(e.target.value)}
            className="rounded-md border px-2 py-2 text-sm flex-shrink-0"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={addingTask}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex-shrink-0"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            Add
          </button>
        </form>

        {newTaskTitle.trim() && (
          <div className="rounded-md border px-3 py-2.5 mb-2" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1.5" style={{ color: 'var(--ink-muted)' }}>Assigned members (optional)</p>
            <ul className="space-y-1.5">
              {QUICK_ROLES.map((role) => (
                <li key={role} className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm font-medium flex-shrink-0">{role}</span>
                  <label htmlFor={`new-task-role-${role}`} className="sr-only">{role}</label>
                  <select
                    id={`new-task-role-${role}`}
                    value={newTaskMemberByRole[role] || ''}
                    onChange={(e) => handleTaskRoleChange(role, e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <option value="">Choose a member…</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
      ) : (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--panel-sunken)', color: 'var(--ink-muted)' }}>
          Only workspace admins can add new tasks. You can still update status, assignee, and due date below.
        </p>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No tasks yet — add the first one above.</p>
        </div>
      ) : (
        <>
          <BulkTaskActionBar
            count={selectedTaskIds.size}
            busy={bulkBusy}
            onClear={() => setSelectedTaskIds(new Set())}
            onStatus={bulkSetStatus}
            onDueDate={bulkSetDueDate}
            onAssignee={bulkSetAssignee}
            members={members}
            onDelete={bulkDeleteTasks}
          />

          <div className="flex items-center gap-2 px-1 mb-1">
            <input
              type="checkbox"
              checked={allTasksSelected}
              onChange={toggleSelectAllTasks}
              aria-label="Select all tasks"
            />
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Select all</span>
          </div>

          <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
              style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
            >
              <input
                type="checkbox"
                checked={selectedTaskIds.has(task.id)}
                onChange={() => toggleTaskSelected(task.id)}
                className="flex-shrink-0"
                aria-label={`Select ${task.title}`}
              />

              <button
                onClick={() => cycleStatus(task)}
                className="flex-shrink-0"
                aria-label={`Cycle status for ${task.title}, currently ${task.status.replace('_', ' ')}`}
                title="Click to change status"
              >
                <TallyDot status={task.status} showLabel={false} />
              </button>

              <Link
                to={`/tasks/${task.id}`}
                className="flex-1 text-sm min-w-0 truncate underline"
                style={task.status === 'done' ? { textDecoration: 'line-through', color: 'var(--ink-muted)' } : undefined}
              >
                {task.title}
              </Link>

              <select
                value={task.assignee_id || ''}
                onChange={(e) => updateTaskField(task.id, { assignee_id: e.target.value || null })}
                className="text-xs rounded-md border px-2 py-1 hidden sm:block flex-shrink-0 max-w-[120px]"
                style={{ borderColor: 'var(--border)' }}
                aria-label={`Assignee for ${task.title}`}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>
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
                aria-label={`Attachments for ${task.title}`}
              >
                📎{attachmentCounts[task.id] ? ` ${attachmentCounts[task.id]}` : ''}
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
        </>
      )}

      {attachmentsTask && (
        <TaskAttachmentsDialog
          orgId={activeOrgId}
          task={attachmentsTask}
          onClose={() => { setAttachmentsTask(null); loadAttachmentCounts() }}
        />
      )}

      <div className="rounded-lg border p-5 mb-6 mt-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h2 className="font-display font-bold text-lg mb-3">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No invoices linked to this project or its tasks yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {invoices.map((inv) => {
              const displayStatus = deriveInvoiceDisplayStatus(inv)
              const forTask = inv.task_id ? tasks.find((t) => t.id === inv.task_id) : null
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
                      <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                        ({forTask ? `for ${forTask.title}` : 'for the project'})
                      </span>
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

      <ActivityLog projectId={projectId} />
    </div>
  )
}
