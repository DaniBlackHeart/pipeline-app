import { getDisplayName } from '../lib/displayName'

// Shown above a task list once one or more rows are checked. Each action
// applies to every selected task in a single Supabase call (`.in('id', ids)`)
// rather than looping one request per task -- fewer round trips, and RLS is
// already row-level (`is_org_member(org_id)` evaluated per row) so a
// multi-row update/delete works the same as the single-row version already
// used elsewhere on these pages.
//
// Each control is optional via its handler prop -- a page passes only the
// actions that make sense for it (e.g. MyTasks omits assignee/delete since
// neither exists there as a per-row action today either).
export default function BulkTaskActionBar({
  count,
  busy,
  onClear,
  onStatus,
  onDueDate,
  onAssignee,
  members,
  onDelete,
}) {
  if (count === 0) return null

  const resetAfter = (fn) => (e) => {
    const value = e.target.value
    if (!value) return
    fn(value)
    e.target.value = ''
  }

  return (
    <div
      className="flex items-center gap-2 flex-wrap rounded-lg border px-3 py-2 mb-2"
      style={{ background: 'var(--panel-sunken)', borderColor: 'var(--border)' }}
      role="toolbar"
      aria-label="Bulk task actions"
    >
      <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
        {count} selected
      </span>

      {onStatus && (
        <select
          defaultValue=""
          disabled={busy}
          onChange={resetAfter(onStatus)}
          className="text-xs rounded-md border px-2 py-1"
          style={{ borderColor: 'var(--border)' }}
          aria-label="Set status for selected tasks"
        >
          <option value="" disabled>Set status…</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      )}

      {onDueDate && (
        <input
          type="date"
          disabled={busy}
          defaultValue=""
          onChange={resetAfter(onDueDate)}
          className="text-xs font-mono rounded-md border px-2 py-1"
          style={{ borderColor: 'var(--border)' }}
          aria-label="Set due date for selected tasks"
        />
      )}

      {onAssignee && (
        <select
          defaultValue=""
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value
            if (!value) return
            onAssignee(value === '__unassign__' ? null : value)
            e.target.value = ''
          }}
          className="text-xs rounded-md border px-2 py-1 max-w-[140px]"
          style={{ borderColor: 'var(--border)' }}
          aria-label="Set assignee for selected tasks"
        >
          <option value="" disabled>Set assignee…</option>
          <option value="__unassign__">Unassigned</option>
          {(members || []).map((m) => (
            <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>
          ))}
        </select>
      )}

      {onDelete && (
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="text-xs ml-auto flex-shrink-0"
          style={{ color: 'var(--tally-alert)' }}
        >
          Delete selected
        </button>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={onClear}
        className="text-xs flex-shrink-0"
        style={{ color: 'var(--ink-muted)', marginLeft: onDelete ? undefined : 'auto' }}
      >
        Clear
      </button>
    </div>
  )
}
