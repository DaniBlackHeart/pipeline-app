import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useChatUnread } from '../context/ChatUnreadContext'
import { supabase } from '../lib/supabase'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'
import ChatPanel from '../components/ChatPanel'
import UnreadBadge from '../components/UnreadBadge'
import {
  getOrgChannel,
  getProjectThread,
  getTaskThread,
  getOrCreateDm,
  listMyDms,
  listExistingTaskThreads,
  listProjectThreadIds,
  searchTasksToChat,
} from '../lib/chatConversations'

// The single, unified home for all team chat -- General, every project's
// thread, task threads, and direct messages. Deliberately the only place
// any of this lives (no more per-project/per-task embedded panels) so it
// actually feels like one chat app rather than a box wedged into
// unrelated pages.
function Avatar({ initialsFrom }) {
  const initials = (initialsFrom || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'
  return (
    <span
      className="flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium"
      style={{ background: 'var(--border)', color: 'var(--ink)' }}
    >
      {initials}
    </span>
  )
}

function SidebarButton({ isActive, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="relative w-full flex items-center gap-2 text-left text-sm rounded-md pl-3 pr-7 py-2 transition-colors"
      style={{
        background: isActive ? 'var(--ink)' : 'transparent',
        color: isActive ? 'var(--panel)' : 'var(--ink)',
      }}
    >
      {children}
    </button>
  )
}

// Pinned to the row's own corner rather than sitting inline after the
// label -- inline flex growth technically worked, but with no visible
// row background on unselected items, a badge floating mid-row read as
// arbitrary rather than anchored to anything. A corner badge, same
// pattern as NotificationBell's, reads as "attached to this row"
// regardless of how long the label text is.
//
// `counts` is the { unread, mentions } shape from useChatUnread() for
// this specific conversation (undefined if there's nothing unread at
// all). Mentions get the amber variant so a conversation where you were
// actually @mentioned reads as distinct from routine unread traffic.
function RowBadge({ counts }) {
  if (!counts) return null
  if (counts.mentions > 0) {
    return <UnreadBadge count={counts.mentions} variant="mention" className="absolute right-2 top-1/2 -translate-y-1/2" />
  }
  return <UnreadBadge count={counts.unread} className="absolute right-2 top-1/2 -translate-y-1/2" />
}

function SectionHeader({ label, onNew }) {
  return (
    <div className="flex items-center justify-between px-1 mb-1.5 mt-4 first:mt-0">
      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      {onNew && (
        <button onClick={onNew} className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
          + New
        </button>
      )}
    </div>
  )
}

export default function Chat() {
  const { activeOrgId, user } = useAuth()
  const { unreadCounts, markRead, setActiveConversation } = useChatUnread()
  const [searchParams, setSearchParams] = useSearchParams()

  const [orgChannelId, setOrgChannelId] = useState(null)
  const [projects, setProjects] = useState([])
  const [projectThreadIds, setProjectThreadIds] = useState({}) // { [projectId]: conversationId }
  const [taskThreads, setTaskThreads] = useState([])
  const [dms, setDms] = useState([])
  const [teammates, setTeammates] = useState([])
  const [selected, setSelected] = useState(null) // { type, conversationId, label, sublabel? }
  const [showDmPicker, setShowDmPicker] = useState(false)
  const [showTaskPicker, setShowTaskPicker] = useState(false)
  const [taskQuery, setTaskQuery] = useState('')
  const [taskResults, setTaskResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')
    try {
      const [channelId, dmList, existingTaskThreads, existingProjectThreadIds, rosterResult, projectsResult] = await Promise.all([
        getOrgChannel(activeOrgId),
        listMyDms(activeOrgId, user?.id),
        listExistingTaskThreads(activeOrgId),
        listProjectThreadIds(activeOrgId),
        supabase
          .from('org_members')
          .select('user_id, profiles ( id, full_name, nickname )')
          .eq('org_id', activeOrgId),
        supabase.from('projects').select('id, name').eq('org_id', activeOrgId).order('name'),
      ])
      setOrgChannelId(channelId)
      setDms(dmList)
      setTaskThreads(existingTaskThreads)
      setProjectThreadIds(existingProjectThreadIds)
      setProjects(projectsResult.data || [])
      const others = (rosterResult.data || [])
        .filter((m) => m.profiles && m.user_id !== user?.id)
        .map((m) => m.profiles)
      setTeammates(others)

      // A notification click (e.g. "so-and-so mentioned you") lands here
      // with ?conversation=<id> -- resolve it against whichever list it
      // actually belongs to and open that, instead of always defaulting
      // to General. Only consumed once: the query param is cleared right
      // after so manually switching conversations later doesn't fight
      // with a stale deep link on the next load().
      const targetId = searchParams.get('conversation')
      setSelected((prev) => {
        if (prev) return prev
        if (targetId) {
          if (targetId === channelId) return { type: 'org', conversationId: channelId, label: 'General' }
          const projectId = Object.keys(existingProjectThreadIds).find((pid) => existingProjectThreadIds[pid] === targetId)
          const project = projectId && (projectsResult.data || []).find((p) => p.id === projectId)
          if (project) return { type: 'project', conversationId: targetId, label: `# ${project.name}` }
          const taskThread = existingTaskThreads.find((t) => t.conversationId === targetId)
          if (taskThread) return { type: 'task', conversationId: targetId, label: taskThread.title, sublabel: taskThread.projectName }
          const dm = dmList.find((d) => d.id === targetId)
          if (dm) return { type: 'dm', conversationId: targetId, label: getDisplayName(dm.otherPerson, 'Unknown') }
        }
        return { type: 'org', conversationId: channelId, label: 'General' }
      })
      if (targetId) setSearchParams({}, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    }
    setLoading(false)
  }, [activeOrgId, user?.id, searchParams, setSearchParams])

  useEffect(() => { load() }, [load])

  // Tell the shared unread context which conversation is currently open,
  // so a message arriving in it doesn't briefly flash a badge that's
  // about to be cleared anyway -- and mark it read the moment it's
  // opened, not just when ChatPanel finishes its own load.
  useEffect(() => {
    setActiveConversation(selected?.conversationId || null)
    if (selected?.conversationId) markRead(selected.conversationId)
    return () => setActiveConversation(null)
  }, [selected?.conversationId, setActiveConversation, markRead])

  const handleOpenProject = async (project) => {
    setError('')
    try {
      const conversationId = await getProjectThread(activeOrgId, project.id)
      setProjectThreadIds((prev) => (prev[project.id] ? prev : { ...prev, [project.id]: conversationId }))
      setSelected({ type: 'project', conversationId, label: `# ${project.name}` })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const handleOpenTaskThread = (thread) => {
    setSelected({
      type: 'task',
      conversationId: thread.conversationId,
      label: thread.title,
      sublabel: thread.projectName,
    })
  }

  const handleTaskSearch = async (query) => {
    setTaskQuery(query)
    if (!query.trim()) {
      setTaskResults([])
      return
    }
    try {
      const results = await searchTasksToChat(activeOrgId, query, taskThreads.map((t) => t.taskId))
      setTaskResults(results)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const handleStartTaskThread = async (task) => {
    setShowTaskPicker(false)
    setTaskQuery('')
    setTaskResults([])
    setError('')
    try {
      const conversationId = await getTaskThread(activeOrgId, task.id)
      const thread = { conversationId, taskId: task.id, title: task.title, projectName: task.projects?.name || null }
      setTaskThreads((prev) => (prev.some((t) => t.conversationId === conversationId) ? prev : [thread, ...prev]))
      setSelected({ type: 'task', conversationId, label: task.title, sublabel: task.projects?.name })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const handleStartDm = async (otherUser) => {
    setShowDmPicker(false)
    setError('')
    try {
      const conversationId = await getOrCreateDm(activeOrgId, otherUser.id)
      setSelected({ type: 'dm', conversationId, label: getDisplayName(otherUser) })
      setDms((prev) => (prev.some((d) => d.id === conversationId) ? prev : [{ id: conversationId, otherPerson: otherUser }, ...prev]))
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading chat…</p>
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-4">Chat</h1>
      {error && <p className="text-sm mb-4" style={{ color: 'var(--tally-alert)' }}>{error}</p>}

      <div
        className="grid grid-cols-1 sm:grid-cols-[260px_1fr] grid-rows-[auto_1fr] sm:grid-rows-1 gap-4"
        style={{ height: '78vh' }}
      >
        <aside
          className="rounded-lg border p-3 overflow-y-auto max-h-64 sm:max-h-none"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <SidebarButton
            isActive={selected?.type === 'org'}
            onClick={() => setSelected({ type: 'org', conversationId: orgChannelId, label: 'General' })}
          >
            <span className="font-medium truncate"># General</span>
            <RowBadge counts={unreadCounts[orgChannelId]} />
          </SidebarButton>

          <SectionHeader label="Projects" />
          {projects.length === 0 ? (
            <p className="text-xs px-1" style={{ color: 'var(--ink-muted)' }}>No projects yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {projects.map((project) => (
                <li key={project.id}>
                  <SidebarButton
                    isActive={selected?.type === 'project' && selected.label === `# ${project.name}`}
                    onClick={() => handleOpenProject(project)}
                  >
                    <span className="truncate min-w-0"># {project.name}</span>
                    <RowBadge counts={unreadCounts[projectThreadIds[project.id]]} />
                  </SidebarButton>
                </li>
              ))}
            </ul>
          )}

          <SectionHeader label="Tasks" onNew={() => setShowTaskPicker((v) => !v)} />
          {showTaskPicker && (
            <div className="mb-2">
              <label htmlFor="task-chat-search" className="sr-only">Search tasks</label>
              <input
                id="task-chat-search"
                type="text"
                value={taskQuery}
                onChange={(e) => handleTaskSearch(e.target.value)}
                placeholder="Search tasks…"
                className="w-full rounded-md border px-2 py-1.5 text-sm mb-1"
                style={{ borderColor: 'var(--border)' }}
                autoFocus
              />
              {taskResults.length > 0 && (
                <ul className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  {taskResults.map((task) => (
                    <li key={task.id}>
                      <button
                        onClick={() => handleStartTaskThread(task)}
                        className="w-full text-left text-sm px-3 py-2 hover-surface transition-colors"
                      >
                        {task.title}
                        {task.projects?.name && (
                          <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>{task.projects.name}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {taskThreads.length === 0 ? (
            <p className="text-xs px-1" style={{ color: 'var(--ink-muted)' }}>No task threads yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {taskThreads.map((thread) => (
                <li key={thread.conversationId}>
                  <SidebarButton
                    isActive={selected?.type === 'task' && selected.conversationId === thread.conversationId}
                    onClick={() => handleOpenTaskThread(thread)}
                  >
                    <span className="truncate min-w-0">{thread.title}</span>
                    <RowBadge counts={unreadCounts[thread.conversationId]} />
                  </SidebarButton>
                </li>
              ))}
            </ul>
          )}

          <SectionHeader label="Direct messages" onNew={() => setShowDmPicker((v) => !v)} />
          {showDmPicker && (
            <ul className="mb-2 rounded-md border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {teammates.length === 0 ? (
                <li className="text-xs px-3 py-2" style={{ color: 'var(--ink-muted)' }}>No other teammates yet.</li>
              ) : (
                teammates.map((teammate) => (
                  <li key={teammate.id}>
                    <button
                      onClick={() => handleStartDm(teammate)}
                      className="w-full text-left text-sm px-3 py-2 hover-surface transition-colors flex items-center gap-2"
                    >
                      <Avatar initialsFrom={getDisplayName(teammate)} />
                      {getDisplayName(teammate)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {dms.length === 0 ? (
            <p className="text-xs px-1" style={{ color: 'var(--ink-muted)' }}>No direct messages yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {dms.map((dm) => (
                <li key={dm.id}>
                  <SidebarButton
                    isActive={selected?.type === 'dm' && selected.conversationId === dm.id}
                    onClick={() => setSelected({ type: 'dm', conversationId: dm.id, label: getDisplayName(dm.otherPerson, 'Unknown') })}
                  >
                    <Avatar initialsFrom={getDisplayName(dm.otherPerson, 'Unknown')} />
                    <span className="truncate min-w-0">{getDisplayName(dm.otherPerson, 'Unknown')}</span>
                    <RowBadge counts={unreadCounts[dm.id]} />
                  </SidebarButton>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div
          className="rounded-lg border p-4 min-h-0 flex flex-col"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          {selected?.conversationId ? (
            <>
              <div className="mb-3 flex-shrink-0">
                <h2 className="font-display font-bold text-lg">{selected.label}</h2>
                {selected.sublabel && (
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{selected.sublabel}</p>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel
                  orgId={activeOrgId}
                  conversationId={selected.conversationId}
                  currentUserId={user?.id}
                  emptyStateText={selected.type === 'dm' ? 'No messages yet. Say hi!' : 'No messages yet.'}
                  onActivity={() => markRead(selected.conversationId)}
                />
              </div>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Select a conversation.</p>
          )}
        </div>
      </div>
    </div>
  )
}
