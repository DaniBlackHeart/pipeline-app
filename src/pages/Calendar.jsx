import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import EventDialog from '../components/EventDialog'
import { buildMonthGrid, dateKey, todayKey, WEEKDAY_LABELS, formatTime, monthLabel } from '../lib/calendarUtils'

export default function Calendar() {
  const { activeOrgId } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [dialogState, setDialogState] = useState(null) // { mode: 'new' | 'edit', event? }

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')

    const [{ data: eventRows, error: eventsError }, { data: taskRows, error: tasksError }, { data: projectRows, error: projectsError }] =
      await Promise.all([
        supabase.from('calendar_events').select('*').eq('org_id', activeOrgId),
        supabase.from('tasks').select('id, project_id, title, status, due_date').eq('org_id', activeOrgId).not('due_date', 'is', null),
        supabase.from('projects').select('id, name, status, due_date').eq('org_id', activeOrgId).not('due_date', 'is', null),
      ])

    if (eventsError || tasksError || projectsError) {
      setError((eventsError || tasksError || projectsError).message)
      setLoading(false)
      return
    }

    setEvents(eventRows || [])
    setTasks(taskRows || [])
    setProjects(projectRows || [])
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  // All projects for the org (for the "linked project" dropdown), separate
  // from the due-date-filtered list used for chips.
  const [allProjects, setAllProjects] = useState([])
  useEffect(() => {
    if (!activeOrgId) return
    supabase
      .from('projects')
      .select('id, name')
      .eq('org_id', activeOrgId)
      .neq('status', 'archived')
      .order('name', { ascending: true })
      .then(({ data }) => setAllProjects(data || []))
  }, [activeOrgId])

  const projectNameById = useMemo(() => {
    const map = {}
    for (const p of allProjects) map[p.id] = p.name
    return map
  }, [allProjects])

  const itemsByDate = useMemo(() => {
    const map = {}
    const push = (key, item) => {
      map[key] ??= []
      map[key].push(item)
    }
    const isOverdue = (due, done) => due && !done && new Date(due) < new Date(new Date().toDateString())

    for (const ev of events) {
      // All-day events store midnight in whatever the DB session timezone
      // is; slicing the literal date substring avoids a local-timezone
      // round trip shifting the day for viewers behind UTC.
      const key = ev.all_day ? ev.start_at.slice(0, 10) : dateKey(ev.start_at)
      push(key, {
        kind: 'event',
        id: ev.id,
        title: ev.title,
        tone: 'progress',
        time: ev.all_day ? null : formatTime(ev.start_at),
        raw: ev,
      })
    }
    for (const task of tasks) {
      const done = task.status === 'done'
      push(dateKey(task.due_date), {
        kind: 'task',
        id: task.id,
        title: task.title,
        subtitle: projectNameById[task.project_id],
        tone: done ? 'done' : isOverdue(task.due_date, done) ? 'alert' : 'progress',
        projectId: task.project_id,
      })
    }
    for (const project of projects) {
      const done = project.status === 'completed'
      push(dateKey(project.due_date), {
        kind: 'project',
        id: project.id,
        title: project.name,
        tone: done ? 'done' : isOverdue(project.due_date, done) ? 'alert' : 'progress',
      })
    }
    return map
  }, [events, tasks, projects, projectNameById])

  const goToday = () => {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setSelectedDate(todayKey())
  }
  const goPrevMonth = () => {
    const d = new Date(year, month - 1, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }
  const goNextMonth = () => {
    const d = new Date(year, month + 1, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const selectedItems = (itemsByDate[selectedDate] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''))

  const toneColor = { progress: 'var(--tally-progress)', done: 'var(--tally-done)', alert: 'var(--tally-alert)' }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Calendar</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Events, task due dates, and project deadlines, together.
          </p>
        </div>
        <button
          onClick={() => setDialogState({ mode: 'new' })}
          className="rounded-md px-4 py-2 text-sm font-medium flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          + New event
        </button>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrevMonth} className="rounded-md border px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} aria-label="Previous month">‹</button>
          <button onClick={goNextMonth} className="rounded-md border px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} aria-label="Next month">›</button>
          <button onClick={goToday} className="rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }}>Today</button>
        </div>
        <h2 className="font-display font-bold text-lg">{monthLabel(year, month)}</h2>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading calendar…</p>
      ) : (
        <div className="rounded-lg border overflow-hidden mb-6" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-7" style={{ background: 'var(--panel-sunken)' }}>
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="text-center text-xs font-mono uppercase tracking-wide py-2" style={{ color: 'var(--ink-muted)' }}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((day) => {
              const key = dateKey(day)
              const inMonth = day.getMonth() === month
              const isToday = key === todayKey()
              const isSelected = key === selectedDate
              const dayItems = itemsByDate[key] || []
              const visible = dayItems.slice(0, 3)
              const extra = dayItems.length - visible.length

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(key)}
                  className="text-left border-t border-r p-1.5 sm:p-2 min-h-[64px] sm:min-h-[88px] flex flex-col gap-1"
                  style={{
                    borderColor: 'var(--border)',
                    background: isSelected ? 'var(--tally-progress-soft)' : 'var(--panel)',
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <span
                    className="text-xs font-mono w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0"
                    style={isToday ? { background: 'var(--ink)', color: 'var(--panel)' } : undefined}
                  >
                    {day.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    {visible.map((item) => (
                      <span key={`${item.kind}-${item.id}`} className="flex items-center gap-1 min-w-0">
                        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: toneColor[item.tone] }} />
                        <span className="text-[11px] truncate hidden sm:inline">{item.title}</span>
                      </span>
                    ))}
                    {extra > 0 && (
                      <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--ink-muted)' }}>+{extra} more</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <h3 className="font-display font-bold text-lg mb-3">
          {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h3>

        {selectedItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Nothing on the calendar this day.</p>
        ) : (
          <ul className="space-y-2">
            {selectedItems.map((item) => {
              const label = item.kind === 'event' ? 'Event' : item.kind === 'task' ? 'Task due' : 'Project due'
              const content = (
                <div className="flex items-center gap-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: toneColor[item.tone] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.title}</p>
                    <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                      {label}{item.subtitle ? ` · ${item.subtitle}` : ''}{item.time ? ` · ${item.time}` : ''}
                    </p>
                  </div>
                </div>
              )

              if (item.kind === 'event') {
                return (
                  <li key={`${item.kind}-${item.id}`}>
                    <button className="w-full text-left" onClick={() => setDialogState({ mode: 'edit', event: item.raw })}>
                      {content}
                    </button>
                  </li>
                )
              }
              const linkTo = item.kind === 'task' ? `/projects/${item.projectId}` : `/projects/${item.id}`
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <Link to={linkTo}>{content}</Link>
                </li>
              )
            })}
          </ul>
        )}

        <button
          onClick={() => setDialogState({ mode: 'new' })}
          className="text-sm mt-4 rounded-md border px-3 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          + Add event on this day
        </button>
      </div>

      {dialogState && (
        <EventDialog
          orgId={activeOrgId}
          projects={allProjects}
          initialDate={dialogState.mode === 'new' ? selectedDate : undefined}
          event={dialogState.mode === 'edit' ? dialogState.event : undefined}
          onClose={() => setDialogState(null)}
          onSaved={() => { setDialogState(null); load() }}
          onDeleted={() => { setDialogState(null); load() }}
        />
      )}
    </div>
  )
}
