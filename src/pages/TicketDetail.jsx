import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TallyDot from '../components/TallyDot'
import PriorityBadge from '../components/PriorityBadge'
import AttachmentsList from '../components/AttachmentsList'

const TYPE_LABELS = { bug: 'Bug', request: 'Request', question: 'Question', other: 'Other' }

export default function TicketDetail() {
  const { ticketId } = useParams()
  const { activeOrgId, user } = useAuth()

  const [ticket, setTicket] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [members, setMembers] = useState([])
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [{ data: ticketRow, error: ticketError }, { data: memberRows, error: memberError }, { data: commentRows, error: commentError }] =
      await Promise.all([
        supabase.from('tickets').select('*').eq('id', ticketId).single(),
        supabase.from('org_members').select('user_id, profiles ( id, full_name )').eq('org_id', activeOrgId),
        supabase
          .from('ticket_comments')
          .select('id, body, author_id, created_at, profiles ( full_name )')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: true }),
      ])

    if (ticketError || memberError || commentError) {
      setError((ticketError || memberError || commentError).message)
      setLoading(false)
      return
    }

    setTicket(ticketRow)
    setMembers((memberRows || []).map((m) => m.profiles).filter(Boolean))
    setComments(commentRows || [])

    if (ticketRow.project_id) {
      const { data: projectRow } = await supabase.from('projects').select('name').eq('id', ticketRow.project_id).single()
      setProjectName(projectRow?.name || '')
    } else {
      setProjectName('')
    }

    setLoading(false)
  }, [ticketId, activeOrgId])

  useEffect(() => { load() }, [load])

  const updateField = async (fields) => {
    setTicket((prev) => ({ ...prev, ...fields }))
    const { error: updateError } = await supabase.from('tickets').update(fields).eq('id', ticketId)
    if (updateError) setError(updateError.message)
  }

  const handleStatusChange = (status) => {
    updateField({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
  }

  const handlePostComment = async (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    setPostingComment(true)
    const { error: insertError } = await supabase.from('ticket_comments').insert({
      ticket_id: ticketId,
      org_id: activeOrgId,
      author_id: user?.id,
      body: newComment.trim(),
    })
    setPostingComment(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNewComment('')
    load()
  }

  const handleDeleteComment = async (commentId) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    const { error: deleteError } = await supabase.from('ticket_comments').delete().eq('id', commentId)
    if (deleteError) setError(deleteError.message)
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  if (!ticket) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: 'var(--tally-alert)' }}>Ticket not found, or you don't have access.</p>
        <Link to="/tickets" className="text-sm underline">Back to tickets</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Link to="/tickets" className="text-sm inline-block mb-4" style={{ color: 'var(--ink-muted)' }}>&larr; All tickets</Link>

      <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
              {TYPE_LABELS[ticket.type]}
            </span>
            <PriorityBadge priority={ticket.priority} />
          </div>
          <div className="flex items-center gap-2">
            <TallyDot status={ticket.status} showLabel={false} />
            <select
              value={ticket.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-xs font-mono uppercase rounded-md border px-2 py-1"
              style={{ borderColor: 'var(--border)' }}
              aria-label="Ticket status"
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>

        <h1 className="font-display font-bold text-xl mb-2">{ticket.title}</h1>
        {ticket.description && <p className="text-sm mb-4 whitespace-pre-wrap">{ticket.description}</p>}

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Assignee</span>
            <select
              value={ticket.assignee_id || ''}
              onChange={(e) => updateField({ assignee_id: e.target.value || null })}
              className="text-sm rounded-md border px-2 py-1 mt-0.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || 'Member'}</option>)}
            </select>
          </div>
          {projectName && (
            <div>
              <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Project</span>
              <Link to={`/projects/${ticket.project_id}`} className="underline">{projectName}</Link>
            </div>
          )}
          <div>
            <span className="text-xs font-mono uppercase tracking-wide block" style={{ color: 'var(--ink-muted)' }}>Filed</span>
            <span className="font-mono text-xs">{new Date(ticket.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <Link
          to={`/tickets/${ticketId}/edit`}
          className="inline-block text-sm mt-4 rounded-md border px-3 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          Edit ticket
        </Link>
      </div>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      <h2 className="font-display font-bold text-lg mb-3">Links</h2>
      <div className="mb-6">
        <AttachmentsList orgId={activeOrgId} parentType="ticket" parentId={ticketId} />
      </div>

      <h2 className="font-display font-bold text-lg mb-3">Discussion</h2>

      {comments.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>No comments yet.</p>
      ) : (
        <ul className="space-y-3 mb-4">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{comment.profiles?.full_name || 'Someone'}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                    {new Date(comment.created_at).toLocaleString()}
                  </span>
                  {comment.author_id === user?.id && (
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                      className="text-xs"
                      style={{ color: 'var(--tally-alert)' }}
                      aria-label="Delete comment"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handlePostComment} className="flex gap-2">
        <label htmlFor="new-comment" className="sr-only">Add a comment</label>
        <textarea
          id="new-comment"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        />
        <button
          type="submit"
          disabled={postingComment}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 self-start flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          Post
        </button>
      </form>
    </div>
  )
}
