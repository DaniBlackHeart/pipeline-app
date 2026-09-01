import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { getUnreadChatCounts, markConversationRead as markConversationReadInDb } from '../lib/chatConversations'

const ChatUnreadContext = createContext(null)

// App-wide unread chat tracking -- its own context rather than folded
// into AuthContext, same reasoning ThemeContext already gets its own
// file: a separate, focused concern from auth/org state.
//
// Two things read from here and need the same live data: AppShell's
// Chat nav link (a total count across every conversation, visible from
// any page) and Chat.jsx's sidebar (a per-conversation count). Fetching
// and subscribing once here, rather than each maintaining its own
// realtime subscription to chat_messages, is what keeps them in sync
// with each other and avoids a duplicate subscription per page.
export function ChatUnreadProvider({ children }) {
  const { user, activeOrgId } = useAuth()
  const [unreadCounts, setUnreadCounts] = useState({}) // { [conversationId]: { unread, mentions } }

  // A ref, not state -- read inside the realtime handler below to decide
  // whether to skip incrementing a conversation that's currently open in
  // Chat.jsx. Using a ref instead of a state dependency means switching
  // conversations doesn't tear down and re-subscribe the channel every
  // time; the handler closure just reads whatever's current.
  const activeConversationRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setUnreadCounts({})
      return
    }
    try {
      setUnreadCounts(await getUnreadChatCounts(activeOrgId))
    } catch {
      // Fails open -- an infra hiccup here should show no badges rather
      // than break navigation.
    }
  }, [activeOrgId])

  useEffect(() => { refresh() }, [refresh])

  // Live updates: bump a conversation's count the moment a new message
  // from someone else arrives, without waiting for a refresh/poll. This
  // is a second, separate subscription from ChatPanel's own -- accepted
  // duplication at this app's scale, in exchange for not having to wire
  // "which conversation is open" state across component boundaries just
  // to share one subscription. Only bumps `unread`, never `mentions` --
  // a chat_messages row alone doesn't say whether it mentions this user,
  // that lives in a separate table (see the next effect below).
  useEffect(() => {
    if (!activeOrgId || !user) return
    const channel = supabase
      .channel(`chat_unread:${activeOrgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `org_id=eq.${activeOrgId}` },
        (payload) => {
          const msg = payload.new
          if (msg.sender_id === user.id) return
          if (msg.conversation_id === activeConversationRef.current) return
          setUnreadCounts((prev) => {
            const existing = prev[msg.conversation_id] || { unread: 0, mentions: 0 }
            return { ...prev, [msg.conversation_id]: { ...existing, unread: existing.unread + 1 } }
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeOrgId, user])

  // A second, independent subscription for "was I just mentioned
  // anywhere" -- deliberately a full refresh() rather than trying to
  // patch the mentions count in incrementally alongside the handler
  // above. Mentions are far less frequent than ordinary messages, so the
  // extra round trip is cheap, and this guarantees unread/mention counts
  // for a conversation never drift out of sync with each other.
  useEffect(() => {
    if (!activeOrgId || !user) return
    const channel = supabase
      .channel(`chat_mentions:${activeOrgId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_message_mentions', filter: `mentioned_user_id=eq.${user.id}` },
        () => { refresh() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeOrgId, user, refresh])

  // Called by Chat.jsx when the user opens a conversation, and by
  // ChatPanel (via Chat.jsx) whenever a new message arrives in whichever
  // conversation is currently open -- covers both "I just clicked in"
  // and "I'm already looking at it when a message lands."
  const markRead = useCallback(async (conversationId) => {
    if (!conversationId || !user) return
    setUnreadCounts((prev) => {
      if (!prev[conversationId]) return prev
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
    try {
      await markConversationReadInDb(conversationId, user.id)
    } catch {
      // Worst case this conversation's badge reappears on the next
      // refresh -- never worth surfacing as an error to the user.
    }
  }, [user])

  const setActiveConversation = useCallback((conversationId) => {
    activeConversationRef.current = conversationId || null
  }, [])

  const totalUnread = Object.values(unreadCounts).reduce((sum, c) => sum + (c.unread || 0), 0)
  const totalMentions = Object.values(unreadCounts).reduce((sum, c) => sum + (c.mentions || 0), 0)

  return (
    <ChatUnreadContext.Provider value={{ unreadCounts, totalUnread, totalMentions, markRead, setActiveConversation }}>
      {children}
    </ChatUnreadContext.Provider>
  )
}

export function useChatUnread() {
  const ctx = useContext(ChatUnreadContext)
  if (!ctx) throw new Error('useChatUnread must be used within a ChatUnreadProvider')
  return ctx
}
