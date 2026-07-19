import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/currency'
import TallyDot from '../components/TallyDot'
import Scrubber from '../components/Scrubber'

const TICKET_TYPES = [
  { value: 'bug', label: 'Something seems broken' },
  { value: 'request', label: 'Request a change' },
  { value: 'question', label: 'Just a question' },
  { value: 'other', label: 'Other' },
]

export default function ShareView() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [ticketName, setTicketName] = useState('')
  const [ticketEmail, setTicketEmail] = useState('')
  const [ticketType, setTicketType] = useState('request')
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDescription, setTicketDescription] = useState('')
  const [submittingTicket, setSubmittingTicket] = useState(false)
  const [ticketError, setTicketError] = useState('')
  const [ticketSubmitted, setTicketSubmitted] = useState(false)

  useEffect(() => {
    let isMounted = true
    supabase.rpc('get_shared_project', { share_token: token }).then(({ data: result, error: rpcError }) => {
      if (!isMounted) return
      if (rpcError) {
        setError(rpcError.message)
      } else if (!result) {
        setError('not_found')
      } else {
        setData(result)
      }
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [token])

  const handleSubmitTicket = async (e) => {
    e.preventDefault()
    setTicketError('')
    if (!ticketTitle.trim()) {
      setTicketError('A short title is required.')
      return
    }

    setSubmittingTicket(true)
    const { error: rpcError } = await supabase.rpc('submit_client_ticket', {
      share_token: token,
      submitter_name: ticketName.trim() || null,
      submitter_email: ticketEmail.trim() || null,
      ticket_type: ticketType,
      ticket_title: ticketTitle.trim(),
      ticket_description: ticketDescription.trim() || null,
    })
    setSubmittingTicket(false)

    if (rpcError) {
      setTicketError(rpcError.message)
      return
    }

    setTicketSubmitted(true)
    setTicketName('')
    setTicketEmail('')
    setTicketTitle('')
    setTicketDescription('')
    setTicketType('request')
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-2xl mx-auto px-4 py-10">
        {loading && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>}

        {!loading && error === 'not_found' && (
          <div className="rounded-lg border p-8 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <p className="font-display font-bold text-lg mb-1">Link not found</p>
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
              This link may have been reset. Please ask for a fresh one.
            </p>
          </div>
        )}

        {!loading && error && error !== 'not_found' && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {error}
          </p>
        )}

        {!loading && data && (
          <>
            <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ color: 'var(--ink-muted)' }}>
              {data.org_name}
            </p>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h1 className="font-display font-bold text-2xl">{data.project.name}</h1>
              <TallyDot status={data.project.status} />
            </div>
            {data.project.client_name && (
              <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>{data.project.client_name}</p>
            )}
            {data.project.description && <p className="text-sm mb-6">{data.project.description}</p>}

            {data.tasks.length > 0 && (
              <div className="rounded-lg border p-5 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <h2 className="font-display font-bold text-lg mb-3">Progress</h2>
                {(() => {
                  const done = data.tasks.filter((t) => t.status === 'done').length
                  const percent = Math.round((done / data.tasks.length) * 100)
                  return (
                    <>
                      <Scrubber percent={percent} tone={data.project.status === 'completed' ? 'done' : 'progress'} label="Project progress" />
                      <p className="text-xs font-mono mt-2 mb-4" style={{ color: 'var(--ink-muted)' }}>{done}/{data.tasks.length} items done</p>
                    </>
                  )
                })()}
                <ul className="space-y-1.5">
                  {data.tasks.map((task, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <TallyDot status={task.status} showLabel={false} />
                      <span style={task.status === 'done' ? { textDecoration: 'line-through', color: 'var(--ink-muted)' } : undefined}>
                        {task.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.invoices.length > 0 && (
              <div className="rounded-lg border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <h2 className="font-display font-bold text-lg mb-3">Invoices</h2>
                <ul className="space-y-2">
                  {data.invoices.map((inv, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                      <span className="font-mono text-sm">{inv.invoice_number}</span>
                      <span className="text-sm font-medium">{formatMoney(inv.total_amount, inv.currency)}</span>
                      <TallyDot status={inv.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border p-5 mt-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <h2 className="font-display font-bold text-lg mb-1">Have something to raise?</h2>
              <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>
                Send a note straight to {data.org_name} — no account needed.
              </p>

              {ticketSubmitted ? (
                <div className="rounded-md px-3 py-3" style={{ background: 'var(--tally-done-soft)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--tally-done)' }}>Thanks — that's been sent.</p>
                  <button
                    onClick={() => setTicketSubmitted(false)}
                    className="text-xs underline mt-1"
                    style={{ color: 'var(--tally-done)' }}
                  >
                    Send another
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitTicket} className="space-y-3" noValidate>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ticket-name" className="block text-sm font-medium mb-1">Your name (optional)</label>
                      <input
                        id="ticket-name"
                        type="text"
                        value={ticketName}
                        onChange={(e) => setTicketName(e.target.value)}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="ticket-email" className="block text-sm font-medium mb-1">Email (optional)</label>
                      <input
                        id="ticket-email"
                        type="email"
                        value={ticketEmail}
                        onChange={(e) => setTicketEmail(e.target.value)}
                        placeholder="If you'd like a reply"
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="ticket-type" className="block text-sm font-medium mb-1">What's this about?</label>
                    <select
                      id="ticket-type"
                      value={ticketType}
                      onChange={(e) => setTicketType(e.target.value)}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {TICKET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ticket-title" className="block text-sm font-medium mb-1">Short summary</label>
                    <input
                      id="ticket-title"
                      type="text"
                      value={ticketTitle}
                      onChange={(e) => setTicketTitle(e.target.value)}
                      maxLength={200}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="ticket-description" className="block text-sm font-medium mb-1">Details (optional)</label>
                    <textarea
                      id="ticket-description"
                      value={ticketDescription}
                      onChange={(e) => setTicketDescription(e.target.value)}
                      rows={3}
                      maxLength={5000}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                    />
                  </div>

                  {ticketError && (
                    <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
                      {ticketError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submittingTicket}
                    className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                    style={{ background: 'var(--ink)', color: 'var(--panel)' }}
                  >
                    {submittingTicket ? 'Sending…' : 'Send'}
                  </button>
                </form>
              )}
            </div>

            <p className="text-xs mt-8 text-center" style={{ color: 'var(--ink-muted)' }}>
              A read-only status page shared by {data.org_name}.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
