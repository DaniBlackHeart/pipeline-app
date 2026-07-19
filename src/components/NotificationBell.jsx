import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function NotificationBell() {
  const { user, activeOrgId } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const load = useCallback(async () => {
    if (!user || !activeOrgId) return
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, link_path, read_at, created_at')
      .eq('user_id', user.id)
      .eq('org_id', activeOrgId)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications(data || [])
  }, [user, activeOrgId])

  useEffect(() => { load() }, [load])

  // Live updates: a table only broadcasts once added to the
  // supabase_realtime publication (done in schema_realtime_notifications.sql).
  // RLS still governs what this specific connection actually receives.
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Only surface it if it belongs to whichever workspace is
          // currently active — same scoping as everything else in the app.
          if (payload.new.org_id !== activeOrgId) return
          setNotifications((prev) => [payload.new, ...prev].slice(0, 20))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, activeOrgId])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const markRead = async (ids) => {
    if (ids.length === 0) return
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
  }

  const handleMarkAllRead = () => {
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id)
    markRead(unreadIds)
  }

  const handleClickNotification = (notif) => {
    if (!notif.read_at) markRead([notif.id])
    setOpen(false)
    if (notif.link_path) navigate(notif.link_path)
  }

  const formatWhen = (iso) => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return new Date(iso).toLocaleDateString()
  }

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 hover:bg-black/5 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full text-[10px] font-mono flex items-center justify-center"
            style={{ background: 'var(--tally-alert)', color: 'var(--panel)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-lg border shadow-lg z-50 max-h-[70vh] overflow-y-auto"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-medium">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="text-sm px-4 py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
              Nothing yet.
            </p>
          ) : (
            <ul>
              {notifications.map((notif) => (
                <li key={notif.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <button
                    onClick={() => handleClickNotification(notif)}
                    className="w-full text-left px-4 py-3 hover:bg-black/5 transition-colors flex gap-2"
                  >
                    <span
                      className="h-2 w-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ background: notif.read_at ? 'transparent' : 'var(--tally-progress)' }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm" style={notif.read_at ? { color: 'var(--ink-muted)' } : undefined}>
                        {notif.title}
                      </span>
                      {notif.body && (
                        <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                          {notif.body}
                        </span>
                      )}
                      <span className="block text-xs font-mono mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                        {formatWhen(notif.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
