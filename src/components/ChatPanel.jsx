import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'
import { sendChatMessage } from '../lib/chatConversations'

// A single chat thread's message list + composer. The caller is
// responsible for resolving `conversationId` first (via
// getOrgChannel/getProjectThread/getTaskThread/getOrCreateDm in
// lib/chatConversations.js) -- this component only knows how to render
// and interact with an already-resolved conversation.
//
// Member names are looked up from a roster fetched once per mount rather
// than from a joined `profiles` relation on each message row, because a
// Realtime INSERT payload only ever contains the raw chat_messages
// columns -- there's no join on a live-arriving row. Using the same
// lookup map for both the initial history fetch and live messages keeps
// sender names consistent either way instead of historical messages
// showing a name and live ones falling back to "Someone".
//
// Mentions are tracked explicitly, not by re-parsing the sent text: only
// people picked from the @ dropdown end up in pendingMentions and get
// tagged (and notified) -- typing someone's name as plain text doesn't,
// by design, since there's no reliable way to tell "meant as a mention"
// from "happened to type their name" from text alone.
export default function ChatPanel({ orgId, conversationId, currentUserId, emptyStateText = 'No messages yet.', onActivity }) {
  const [messages, setMessages] = useState([])
  const [roster, setRoster] = useState({})
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  const [mentionQuery, setMentionQuery] = useState(null) // null = dropdown closed
  const [mentionStart, setMentionStart] = useState(null) // index of '@' in body
  const [pendingMentions, setPendingMentions] = useState(new Set())

  // Kept in a ref, not a dependency, so a new inline function from the
  // parent on every render doesn't force loadMessages/the realtime
  // effect below to be recreated (and re-run) every render too -- this
  // still always calls whatever the latest onActivity is, just without
  // that identity churn rippling into other effects.
  const onActivityRef = useRef(onActivity)
  useEffect(() => { onActivityRef.current = onActivity })

  const loadRoster = useCallback(async () => {
    if (!orgId) return
    const { data } = await supabase
      .from('org_members')
      .select('user_id, profiles ( id, full_name, nickname )')
      .eq('org_id', orgId)
    const map = {}
    for (const row of data || []) {
      if (row.profiles) map[row.user_id] = row.profiles
    }
    setRoster(map)
  }, [orgId])

  const loadMessages = useCallback(async () => {
    if (!conversationId) return
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('chat_messages')
      .select('id, body, created_at, sender_id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (fetchError) setError(friendlyError(fetchError))
    else {
      setMessages(data || [])
      onActivityRef.current?.()
    }
    setLoading(false)
  }, [conversationId])

  useEffect(() => { loadRoster() }, [loadRoster])
  useEffect(() => { loadMessages() }, [loadMessages])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`chat_messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]))
          onActivityRef.current?.()
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // Longest names first so "Fran" typed as a mention target doesn't
  // shadow a longer "Franz" elsewhere in the roster when highlighting.
  const mentionPattern = useMemo(() => {
    const names = Object.values(roster).map((p) => getDisplayName(p)).filter(Boolean)
    if (names.length === 0) return null
    const escaped = names
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return new RegExp(`@(${escaped.join('|')})\\b`, 'g')
  }, [roster])

  const renderBody = (text) => {
    if (!mentionPattern) return text
    const pattern = new RegExp(mentionPattern.source, 'g')
    const parts = []
    let lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
      parts.push(
        <span
          key={match.index}
          className="font-medium rounded px-1"
          style={{ background: 'var(--tally-progress-soft)', color: 'var(--tally-progress-text)' }}
        >
          @{match[1]}
        </span>
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex))
    return parts
  }

  const mentionResults = useMemo(() => {
    if (mentionQuery === null) return []
    const lower = mentionQuery.toLowerCase()
    return Object.entries(roster)
      .filter(([userId]) => userId !== currentUserId)
      .map(([userId, profile]) => ({ id: userId, profile }))
      .filter(({ profile }) => getDisplayName(profile).toLowerCase().includes(lower))
      .slice(0, 5)
  }, [mentionQuery, roster, currentUserId])

  const handleBodyChange = (e) => {
    const value = e.target.value
    const cursor = e.target.selectionStart
    setBody(value)

    // An active mention query is an '@' immediately preceded by
    // start-of-text or whitespace, with no whitespace between it and the
    // cursor -- i.e. still mid-word after the '@'.
    const upToCursor = value.slice(0, cursor)
    const match = upToCursor.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionStart(cursor - match[1].length - 1)
    } else {
      setMentionQuery(null)
      setMentionStart(null)
    }
  }

  const handleSelectMention = (result) => {
    const name = getDisplayName(result.profile)
    const cursor = textareaRef.current?.selectionStart ?? body.length
    const before = body.slice(0, mentionStart)
    const after = body.slice(cursor)
    const insertion = `@${name} `
    setBody(before + insertion + after)
    setPendingMentions((prev) => new Set(prev).add(result.id))
    setMentionQuery(null)
    setMentionStart(null)

    const nextCursor = before.length + insertion.length
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const handleSend = async (e) => {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed || sending || !conversationId) return
    setSending(true)
    setError('')
    try {
      await sendChatMessage(conversationId, orgId, currentUserId, trimmed, [...pendingMentions])
      setBody('')
      setPendingMentions(new Set())
    } catch (err) {
      setError(friendlyError(err))
    }
    setSending(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && mentionQuery !== null) {
      setMentionQuery(null)
      setMentionStart(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (mentionResults.length > 0) {
        handleSelectMention(mentionResults[0])
      } else {
        handleSend(e)
      }
    }
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading messages…</p>
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>{error}</p>
      )}

      <div className="flex-1 overflow-y-auto mb-4 min-h-0">
        {messages.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{emptyStateText}</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((message) => {
              const isMine = message.sender_id === currentUserId
              return (
                <li key={message.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                  {!isMine && (
                    <span className="text-xs font-medium mb-0.5">
                      {getDisplayName(roster[message.sender_id])}
                    </span>
                  )}
                  <div
                    className="rounded-lg px-3 py-2 max-w-[80%]"
                    style={{
                      background: isMine ? 'var(--ink)' : 'var(--panel)',
                      color: isMine ? 'var(--panel)' : 'var(--ink)',
                      border: isMine ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <p className="text-sm whitespace-pre-wrap">{renderBody(message.body)}</p>
                  </div>
                  <span className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {new Date(message.created_at).toLocaleString()}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="relative flex gap-2 flex-shrink-0">
        {mentionQuery !== null && mentionResults.length > 0 && (
          <ul
            className="absolute bottom-full mb-1 left-0 w-56 rounded-md border overflow-hidden shadow-lg z-10"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
          >
            {mentionResults.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => handleSelectMention(result)}
                  className="w-full text-left text-sm px-3 py-2 hover-surface transition-colors"
                >
                  {getDisplayName(result.profile)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="chat-message" className="sr-only">Type a message</label>
        <textarea
          id="chat-message"
          ref={textareaRef}
          value={body}
          onChange={handleBodyChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Type a message… (@ to mention someone)"
          className="flex-1 rounded-md border px-3 py-2 text-sm resize-none"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 self-start flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
