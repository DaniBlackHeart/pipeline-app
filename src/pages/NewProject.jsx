import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { QUICK_ROLES } from '../lib/roles'
import { MAX_FILE_BYTES, humanizeBytes, sanitizeFilename } from '../lib/files'
import { LinkIcon, UploadIcon } from '../components/icons'
import { getDisplayName } from '../lib/displayName'

let tempIdCounter = 0
const nextTempId = () => `temp-${++tempIdCounter}`

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

  // Pending attachments — the project doesn't exist yet, so nothing here
  // touches Storage or the database until the project itself is created.
  // Links just sit in state; files are held as raw File objects and only
  // actually uploaded after a real project id exists.
  const [pendingAttachments, setPendingAttachments] = useState([])
  const [pendingUrl, setPendingUrl] = useState('')
  const [attachError, setAttachError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!activeOrgId) return
    supabase
      .from('org_members')
      .select('user_id, profiles ( id, full_name, nickname )')
      .eq('org_id', activeOrgId)
      .then(({ data }) => setMembers((data || []).map((m) => m.profiles).filter(Boolean)))
  }, [activeOrgId])

  const handleRoleChange = (role, userId) => {
    setAssigneeByRole((prev) => ({ ...prev, [role]: userId }))
  }

  const handleAddPendingLink = (e) => {
    e.preventDefault()
    setAttachError('')
    if (!pendingUrl.trim()) return
    let normalizedUrl = pendingUrl.trim()
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`
    setPendingAttachments((prev) => [...prev, { tempId: nextTempId(), kind: 'link', url: normalizedUrl, label: normalizedUrl }])
    setPendingUrl('')
  }

  const handlePendingFileSelected = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setAttachError('')
    if (file.size > MAX_FILE_BYTES) {
      setAttachError(`That file is ${humanizeBytes(file.size)} — the limit here is 25 MB. For anything bigger (like video masters), use a link instead.`)
      return
    }
    setPendingAttachments((prev) => [...prev, { tempId: nextTempId(), kind: 'file', file, label: file.name, size: file.size }])
  }

  const handleRemovePending = (tempId) => {
    setPendingAttachments((prev) => prev.filter((a) => a.tempId !== tempId))
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

    // Same best-effort philosophy for attachments — actually upload files
    // and insert rows now that a real project id exists. One at a time
    // (not batched) so one bad file doesn't take the rest down with it.
    for (const a of pendingAttachments) {
      if (a.kind === 'link') {
        await supabase.from('attachments').insert({
          org_id: activeOrgId,
          parent_type: 'project',
          parent_id: inserted.id,
          kind: 'link',
          label: a.url,
          url: a.url,
          created_by: userData?.user?.id,
        })
      } else {
        const storagePath = `${activeOrgId}/${crypto.randomUUID()}-${sanitizeFilename(a.file.name)}`
        const { error: uploadError } = await supabase.storage.from('attachments').upload(storagePath, a.file)
        if (uploadError) continue // it can be re-uploaded from the project page
        await supabase.from('attachments').insert({
          org_id: activeOrgId,
          parent_type: 'project',
          parent_id: inserted.id,
          kind: 'file',
          label: a.file.name,
          storage_path: storagePath,
          file_size: a.file.size,
          mime_type: a.file.type || null,
          created_by: userData?.user?.id,
        })
      }
    }

    setSubmitting(false)
    navigate(`/projects/${inserted.id}`)
  }

  return (
    <div className="max-w-2xl mx-auto">
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
                  {members.map((m) => <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg mb-1">Attachments</h2>
          <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>Optional — can also be added from the project's own page later.</p>

          {pendingAttachments.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {pendingAttachments.map((a, i) => (
                <li key={a.tempId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                      File {i + 1}
                    </span>
                    <span className="flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>-</span>
                    <span className="text-sm truncate min-w-0">
                      {a.label}
                      {a.kind === 'file' && (
                        <span className="ml-1.5 text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                          ({humanizeBytes(a.size)})
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemovePending(a.tempId)}
                    className="text-xs flex-shrink-0"
                    style={{ color: 'var(--tally-alert)' }}
                    aria-label={`Remove File ${i + 1}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {attachError && (
            <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
              {attachError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <label htmlFor="new-proj-attach-url" className="sr-only">Paste a link and press enter to add it</label>
              <input
                id="new-proj-attach-url"
                type="text"
                value={pendingUrl}
                onChange={(e) => setPendingUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddPendingLink(e) }}
                placeholder="Paste a Drive, Frame.io, or other link…"
                className="w-full rounded-md border pl-3 pr-9 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
              <button
                type="button"
                onClick={handleAddPendingLink}
                aria-label="Add link"
                title="Add link"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1"
                style={{ color: 'var(--ink-muted)' }}
              >
                <LinkIcon />
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handlePendingFileSelected}
              className="hidden"
              aria-label="Upload a file"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload a file"
              title="Upload a file"
              className="flex-shrink-0 rounded-md border p-2.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <UploadIcon />
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>
            25 MB max — for bigger files (video masters, etc.), use a link instead.
          </p>
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
