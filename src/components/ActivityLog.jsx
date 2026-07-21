import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ENTITY_LABELS = { task: 'Task', ticket: 'Ticket', invoice: 'Invoice', project: 'Project' }

// Two usage modes:
//   <ActivityLog projectId={id} />                      — combined feed for
//     everything under one project (its own status changes, plus every
//     task/ticket/invoice linked to it), interleaved by time.
//   <ActivityLog entityType="ticket" entityId={id} />    — just that one
//     ticket's (or invoice's) own history.
export default function ActivityLog({ projectId, entityType, entityId, title = 'Activity' }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('activity_log')
      .select('id, entity_type, entity_id, entity_title, action, detail, created_at, profiles ( full_name )')
      .order('created_at', { ascending: false })
      .limit(50)

    query = projectId
      ? query.eq('project_id', projectId)
      : query.eq('entity_type', entityType).eq('entity_id', entityId)

    const { data } = await query
    setEntries(data || [])
    setLoading(false)
  }, [projectId, entityType, entityId])

  useEffect(() => { load() }, [load])

  // Live updates via the same publication used by the notification bell —
  // no polling, no manual reload calls needed after every mutation
  // elsewhere in the app; new rows just show up.
  useEffect(() => {
    const filter = projectId ? `project_id=eq.${projectId}` : `entity_id=eq.${entityId}`
    const channel = supabase
      .channel(`activity_log:${projectId || entityId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_log', filter },
        (payload) => {
          if (!projectId && payload.new.entity_type !== entityType) return
          setEntries((prev) => [payload.new, ...prev].slice(0, 50))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [projectId, entityType, entityId])

  const linkFor = (entry) => {
    if (entry.entity_type === 'task') return projectId ? null : `/projects/${projectId}`
    if (entry.entity_type === 'ticket') return `/tickets/${entry.entity_id}`
    if (entry.entity_type === 'invoice') return `/invoices/${entry.entity_id}`
    return null
  }

  return (
    <div>
      <h2 className="font-display font-bold text-lg mt-8 mb-3">{title}</h2>
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No activity yet — changes will show up here.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const target = linkFor(entry)
            const content = (
              <>
                <span className="font-medium">{entry.profiles?.full_name || 'Someone'}</span>
                {' — '}
                <span style={{ color: 'var(--ink-muted)' }}>{entry.detail}</span>
                <span className="block text-xs font-mono mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {projectId && <span className="uppercase">{ENTITY_LABELS[entry.entity_type]} · </span>}
                  "{entry.entity_title}" · {new Date(entry.created_at).toLocaleString()}
                </span>
              </>
            )
            return (
              <li
                key={entry.id}
                className="rounded-lg border px-4 py-2.5 text-sm"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              >
                {target ? <Link to={target}>{content}</Link> : content}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
