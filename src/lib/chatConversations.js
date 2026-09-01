import { supabase } from './supabase'

// Get-or-create for the org/project/task conversation types. Safe to call
// repeatedly and from multiple tabs/users at once -- the unique partial
// indexes in schema_chat.sql (one per type) mean a duplicate insert fails
// with a conflict rather than creating a second row, and the catch below
// just re-selects and returns the row that won the race instead of
// surfacing that as an error.
async function getOrCreateSharedConversation({ orgId, type, projectId = null, taskId = null }) {
  const filters = { org_id: orgId, type }
  if (type === 'project') filters.project_id = projectId
  if (type === 'task') filters.task_id = taskId

  const { data: existing, error: selectError } = await supabase
    .from('chat_conversations')
    .select('id')
    .match(filters)
    .maybeSingle()
  if (selectError) throw selectError
  if (existing) return existing.id

  const { data: created, error: insertError } = await supabase
    .from('chat_conversations')
    .insert({ org_id: orgId, type, project_id: projectId, task_id: taskId })
    .select('id')
    .single()
  if (!insertError) return created.id

  // Someone else's request created it in the gap between our select and
  // insert -- re-select rather than treating that as a real failure.
  const { data: retry } = await supabase.from('chat_conversations').select('id').match(filters).maybeSingle()
  if (retry) return retry.id
  throw insertError
}

export const getOrgChannel = (orgId) =>
  getOrCreateSharedConversation({ orgId, type: 'org' })

export const getProjectThread = (orgId, projectId) =>
  getOrCreateSharedConversation({ orgId, type: 'project', projectId })

// { [projectId]: conversationId } for every project that already has a
// chat thread -- used only to look up unread counts per project in the
// sidebar. Projects with no messages yet simply have no entry here,
// which is fine: they have zero unread by definition, no need to
// force-create their conversation row just to confirm that.
export async function listProjectThreadIds(orgId) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, project_id')
    .eq('org_id', orgId)
    .eq('type', 'project')
  if (error) throw error
  const map = {}
  for (const row of data || []) map[row.project_id] = row.id
  return map
}

export const getTaskThread = (orgId, taskId) =>
  getOrCreateSharedConversation({ orgId, type: 'task', taskId })

// DMs go through the security-definer RPC instead -- see schema_chat.sql
// for why a plain client-side get-or-create doesn't work for this one
// (a freshly-inserted DM conversation has no participants yet, and its
// own RLS policy would block reading it back before they're added).
export async function getOrCreateDm(orgId, otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_dm_conversation', {
    target_org_id: orgId,
    other_user_id: otherUserId,
  })
  if (error) throw error
  return data
}

// Unread tracking -- see ChatUnreadContext.jsx for the live state that
// wraps these two calls; kept here so all direct chat-table access lives
// in one file, same as everything else in this module.

// Returns a plain { [conversationId]: { unread, mentions } } map, not the
// raw [{conversation_id, unread_count, mention_count}] rows the RPC
// returns -- every caller wants to index by conversation_id, so do that
// conversion in exactly one place. mention_count is always <= unread_count
// (a subset -- every mention is also an unread message).
export async function getUnreadChatCounts(orgId) {
  const { data, error } = await supabase.rpc('get_unread_chat_counts', { target_org_id: orgId })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    map[row.conversation_id] = { unread: row.unread_count, mentions: row.mention_count }
  }
  return map
}

// Upsert rather than insert -- a user re-reading a conversation just
// bumps last_read_at forward, it doesn't need a new row each time.
export async function markConversationRead(conversationId, userId) {
  const { error } = await supabase
    .from('chat_conversation_reads')
    .upsert(
      { conversation_id: conversationId, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' }
    )
  if (error) throw error
}

// Sends a message, then tags each mentioned user in a second insert --
// two round trips rather than one, since chat_message_mentions' insert
// policy needs the message row to already exist (it checks the message's
// sender_id, which can't be verified before the row is there). Mentions
// are best-effort: if that second insert fails, the message itself has
// already sent successfully, so the error is swallowed rather than
// surfaced as a send failure -- worst case a mention doesn't notify
// anyone, not that the message itself is lost.
export async function sendChatMessage(conversationId, orgId, senderId, body, mentionedUserIds = []) {
  const { data: message, error: sendError } = await supabase
    .from('chat_messages')
    .insert({ conversation_id: conversationId, org_id: orgId, sender_id: senderId, body })
    .select('id')
    .single()
  if (sendError) throw sendError

  const uniqueMentions = [...new Set(mentionedUserIds)].filter((id) => id && id !== senderId)
  if (uniqueMentions.length > 0) {
    const { error: mentionError } = await supabase
      .from('chat_message_mentions')
      .insert(uniqueMentions.map((mentioned_user_id) => ({ message_id: message.id, mentioned_user_id })))
    // Deliberately not thrown -- see comment above the function.
    if (mentionError) console.error('chat mention insert failed', mentionError)
  }

  return message.id
}

// Existing task-type conversations for this org, for the Chat page's
// Tasks list. Deliberately different from how Projects are listed:
// projects are shown in full (a bounded, channel-like set), but tasks
// can be numerous, so only threads someone has already started show up
// here -- finding any other task to start one goes through
// searchTasksToChat below instead, the same "+ New" search pattern DMs
// already use.
export async function listExistingTaskThreads(orgId) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, task_id, tasks ( id, title, projects ( name ) )')
    .eq('org_id', orgId)
    .eq('type', 'task')
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data || [])
    .filter((c) => c.tasks)
    .map((c) => ({
      conversationId: c.id,
      taskId: c.task_id,
      title: c.tasks.title,
      projectName: c.tasks.projects?.name || null,
    }))
}

// Search-as-you-type task lookup for the Tasks "+ New" picker -- mirrors
// the identical pattern already used for task-to-task linking on
// TaskDetail.jsx.
export async function searchTasksToChat(orgId, query, excludeTaskIds = []) {
  const trimmed = query.trim()
  if (!trimmed) return []
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, projects ( name )')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .ilike('title', `%${trimmed}%`)
    .limit(8)
  if (error) throw error
  return (data || []).filter((t) => !excludeTaskIds.includes(t.id))
}
// This org's existing DMs that the current user is a participant of,
// newest-active first isn't tracked yet (v1: just creation order) --
// each row includes the other participant's profile for display.
export async function listMyDms(orgId, currentUserId) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, created_at, chat_conversation_participants ( user_id, profiles ( id, full_name, nickname ) )')
    .eq('org_id', orgId)
    .eq('type', 'dm')
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data || []).map((conversation) => ({
    id: conversation.id,
    createdAt: conversation.created_at,
    otherPerson: conversation.chat_conversation_participants
      ?.map((p) => p.profiles)
      .find((profile) => profile?.id !== currentUserId) || null,
  }))
}
