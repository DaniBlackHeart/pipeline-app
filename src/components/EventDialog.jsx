import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// `initialDate` is a "YYYY-MM-DD" string used to pre-fill new events created
// from a specific day cell. `event` is the existing row when editing.
export default function EventDialog({ orgId, projects, initialDate, event, onClose, onSaved, onDeleted }) {
  const isEditing = Boolean(event)
  const [title, setTitle] = useState(event?.title || '')
  const [date, setDate] = useState(event ? event.start_at.slice(0, 10) : initialDate)
  const [allDay, setAllDay] = useState(event?.all_day ?? true)
  const [startTime, setStartTime] = useState(event && !event.all_day ? event.start_at.slice(11, 16) : '09:00')
  const [endTime, setEndTime] = useState(event?.end_at && !event.all_day ? event.end_at.slice(11, 16) : '10:00')
  const [location, setLocation] = useState(event?.location || '')
  const [description, setDescription] = useState(event?.description || '')
  const [projectId, setProjectId] = useState(event?.project_id || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const firstFieldRef = useRef(null)

  useEffect(() => { firstFieldRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Give the event a title.')
      return
    }
    if (!date) {
      setError('Pick a date.')
      return
    }

    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()

    const startAt = allDay ? `${date}T00:00:00` : `${date}T${startTime}:00`
    const endAt = allDay ? null : `${date}T${endTime}:00`

    const payload = {
      org_id: orgId,
      project_id: projectId || null,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start_at: startAt,
      end_at: endAt,
      all_day: allDay,
    }

    const { error: saveError } = isEditing
      ? await supabase.from('calendar_events').update(payload).eq('id', event.id)
      : await supabase.from('calendar_events').insert({ ...payload, created_by: userData?.user?.id })

    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    onSaved()
  }

  const handleDelete = async () => {
    setSaving(true)
    const { error: deleteError } = await supabase.from('calendar_events').delete().eq('id', event.id)
    setSaving(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    onDeleted()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(20, 23, 26, 0.4)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg p-6 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--panel)' }}>
        <h2 id="event-dialog-title" className="font-display font-bold text-lg mb-4">
          {isEditing ? 'Edit event' : 'New event'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="event-title" className="block text-sm font-medium mb-1">Title</label>
            <input
              id="event-title"
              ref={firstFieldRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>

          <div>
            <label htmlFor="event-date" className="block text-sm font-medium mb-1">Date</label>
            <input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="event-start" className="block text-sm font-medium mb-1">Start time</label>
                <input
                  id="event-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="event-end" className="block text-sm font-medium mb-1">End time</label>
                <input
                  id="event-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="event-project" className="block text-sm font-medium mb-1">Linked project (optional)</label>
            <select
              id="event-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">No linked project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="event-location" className="block text-sm font-medium mb-1">Location (optional)</label>
            <input
              id="event-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <label htmlFor="event-desc" className="block text-sm font-medium mb-1">Notes (optional)</label>
            <textarea
              id="event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          {error && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-3 justify-between pt-2">
            {isEditing ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="text-sm"
                style={{ color: 'var(--tally-alert)' }}
              >
                Delete event
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm font-medium border"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                style={{ background: 'var(--ink)', color: 'var(--panel)' }}
              >
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create event'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
