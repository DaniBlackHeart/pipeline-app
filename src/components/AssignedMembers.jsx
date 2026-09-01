import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { QUICK_ROLES } from '../lib/roles'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'

let tempIdCounter = 0
const nextTempId = () => `temp-${++tempIdCounter}`

const TABLE = { project: 'project_assignees', task: 'task_assignees' }
const FK_COLUMN = { project: 'project_id', task: 'task_id' }

// Shared "Assigned members" block for a project's or task's own page.
// Keeps the original three fixed role slots (Graphics Designer, Project
// Manager, Developer — one dropdown each), and adds an unlimited list of
// extra rows below via "+ Add member": a free-text role label plus a
// member dropdown, for anyone who doesn't fit those three canned roles.
//
// Both the fixed slots and the extra rows write to the same underlying
// table (project_assignees/task_assignees), keyed by a surrogate `id`
// with a (parent_id, user_id, role_label) uniqueness constraint -- one
// row per person *per role*, not one row per person overall. That means
// the same person can hold more than one role at once (every fixed slot,
// or a mix of fixed slots and extra rows) -- useful when just one person
// is doing the whole project. The only thing still blocked is a literal
// duplicate: the same person assigned to the exact same role twice.
export default function AssignedMembers({ orgId, parentType, parentId, members }) {
  const table = TABLE[parentType]
  const fk = FK_COLUMN[parentType]

  const [assignees, setAssignees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState('')

  // Rows added via "+ Add member" that don't have a person picked yet --
  // never written to the database until a member is actually chosen.
  const [drafts, setDrafts] = useState([])

  const load = useCallback(async () => {
    if (!parentId) return
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from(table)
      .select(`id, user_id, role_label, created_at, profiles ( id, full_name, nickname )`)
      .eq(fk, parentId)
      .order('created_at', { ascending: true })
    if (fetchError) setError(friendlyError(fetchError))
    setAssignees(data || [])
    setLoading(false)
  }, [table, fk, parentId])

  useEffect(() => { load() }, [load])

  const extraRows = assignees.filter((a) => !QUICK_ROLES.includes(a.role_label))

  const handleQuickRoleChange = async (role, userId) => {
    setSavingKey(`quick:${role}`)
    setError('')
    // Only clear whoever currently holds *this* role slot -- not any other
    // role the incoming person might already hold elsewhere on this
    // project/task. One person can now hold more than one role at once.
    const { error: deleteError } = await supabase.from(table).delete().eq(fk, parentId).eq('role_label', role)
    if (deleteError) {
      setError(friendlyError(deleteError))
      setSavingKey('')
      return
    }
    if (userId) {
      const { error: insertError } = await supabase.from(table).insert({
        [fk]: parentId,
        user_id: userId,
        role_label: role,
        org_id: orgId,
      })
      if (insertError) {
        setError(friendlyError(insertError))
        setSavingKey('')
        return
      }
    }
    await load()
    setSavingKey('')
  }

  const handleAddDraft = () => {
    setDrafts((prev) => [...prev, { localId: nextTempId(), roleLabel: '' }])
  }

  const handleDraftRoleTextChange = (localId, text) => {
    setDrafts((prev) => prev.map((d) => (d.localId === localId ? { ...d, roleLabel: text } : d)))
  }

  const handleRemoveDraft = (localId) => {
    setDrafts((prev) => prev.filter((d) => d.localId !== localId))
  }

  // A person picked for a still-unsaved draft row -- commits the insert.
  // They can already hold other roles on this project/task; that's fine
  // now. Only a literal duplicate (same person, same role text) is
  // rejected, by the DB's own uniqueness constraint.
  const handleDraftMemberChange = async (draft, userId) => {
    if (!userId) return
    setSavingKey(`draft:${draft.localId}`)
    setError('')
    const { error: insertError } = await supabase.from(table).insert({
      [fk]: parentId,
      user_id: userId,
      role_label: draft.roleLabel.trim() || null,
      org_id: orgId,
    })
    setSavingKey('')
    if (insertError) {
      setError(friendlyError(insertError))
      return
    }
    setDrafts((prev) => prev.filter((d) => d.localId !== draft.localId))
    await load()
  }

  // Editing the role text on an already-saved extra row -- commits on
  // blur. Identified by the row's own id, not user_id -- the same person
  // can now have more than one row, so user_id alone would touch all of
  // their rows instead of just this one.
  const handleSavedRoleTextBlur = async (rowId, text) => {
    setError('')
    const { error: updateError } = await supabase
      .from(table)
      .update({ role_label: text.trim() || null })
      .eq('id', rowId)
    if (updateError) {
      setError(friendlyError(updateError))
      return
    }
    await load()
  }

  // Swapping the person on an already-saved extra row. Also identified by
  // the row's own id -- freeing the old person only removes this one row,
  // not any other role they hold, and placing the new person here doesn't
  // touch any other role *they* already hold either.
  const handleSavedMemberChange = async (rowId, roleLabel, newUserId) => {
    setSavingKey(`saved:${rowId}`)
    setError('')
    const { error: deleteError } = await supabase.from(table).delete().eq('id', rowId)
    if (deleteError) {
      setError(friendlyError(deleteError))
      setSavingKey('')
      return
    }
    if (!newUserId) {
      setSavingKey('')
      await load()
      return
    }
    const { error: insertError } = await supabase.from(table).insert({
      [fk]: parentId,
      user_id: newUserId,
      role_label: roleLabel || null,
      org_id: orgId,
    })
    setSavingKey('')
    if (insertError) {
      setError(friendlyError(insertError))
      return
    }
    await load()
  }

  const handleRemoveSaved = async (rowId) => {
    setSavingKey(`saved:${rowId}`)
    setError('')
    const { error: deleteError } = await supabase.from(table).delete().eq('id', rowId)
    setSavingKey('')
    if (deleteError) {
      setError(friendlyError(deleteError))
      return
    }
    await load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-lg">Assigned members</h2>
        <button
          type="button"
          onClick={handleAddDraft}
          className="text-sm rounded-md border px-3 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          + Add member
        </button>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {QUICK_ROLES.map((role) => {
          const current = assignees.find((a) => a.role_label === role)
          const key = `quick:${role}`
          return (
            <li key={role} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-medium flex-shrink-0">{role}</span>
              <label htmlFor={`assignee-${parentType}-${parentId}-${role}`} className="sr-only">{role}</label>
              <select
                id={`assignee-${parentType}-${parentId}-${role}`}
                value={current?.user_id || ''}
                onChange={(e) => handleQuickRoleChange(role, e.target.value)}
                disabled={savingKey === key || loading}
                className="rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">Choose a member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>)}
              </select>
            </li>
          )
        })}

        {extraRows.map((row) => {
          const key = `saved:${row.id}`
          return (
            <li key={row.id} className="flex items-center gap-2 rounded-md border px-3 py-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
              <label htmlFor={`extra-role-${row.id}`} className="sr-only">Role</label>
              <input
                id={`extra-role-${row.id}`}
                type="text"
                defaultValue={row.role_label || ''}
                onBlur={(e) => handleSavedRoleTextBlur(row.id, e.target.value)}
                placeholder="Role (optional)"
                className="flex-1 min-w-[120px] rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
              <label htmlFor={`extra-member-${row.id}`} className="sr-only">Member</label>
              <select
                id={`extra-member-${row.id}`}
                value={row.user_id}
                onChange={(e) => handleSavedMemberChange(row.id, row.role_label, e.target.value)}
                disabled={savingKey === key}
                className="rounded-md border px-3 py-2 text-sm disabled:opacity-60 flex-shrink-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>)}
              </select>
              <button
                type="button"
                onClick={() => handleRemoveSaved(row.id)}
                disabled={savingKey === key}
                className="text-xs flex-shrink-0 disabled:opacity-60"
                style={{ color: 'var(--tally-alert)' }}
                aria-label={`Remove ${getDisplayName(row.profiles, 'this member')}`}
              >
                Remove
              </button>
            </li>
          )
        })}

        {drafts.map((draft) => {
          const key = `draft:${draft.localId}`
          return (
            <li key={draft.localId} className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
              <label htmlFor={`draft-role-${draft.localId}`} className="sr-only">Role</label>
              <input
                id={`draft-role-${draft.localId}`}
                type="text"
                value={draft.roleLabel}
                onChange={(e) => handleDraftRoleTextChange(draft.localId, e.target.value)}
                placeholder="Role (optional)"
                className="flex-1 min-w-[120px] rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
              <label htmlFor={`draft-member-${draft.localId}`} className="sr-only">Member</label>
              <select
                id={`draft-member-${draft.localId}`}
                value=""
                onChange={(e) => handleDraftMemberChange(draft, e.target.value)}
                disabled={savingKey === key}
                className="rounded-md border px-3 py-2 text-sm disabled:opacity-60 flex-shrink-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">Choose a member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>)}
              </select>
              <button
                type="button"
                onClick={() => handleRemoveDraft(draft.localId)}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--tally-alert)' }}
                aria-label="Remove this row"
              >
                Remove
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
