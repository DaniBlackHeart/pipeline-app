import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/currency'
import TallyDot from '../components/TallyDot'
import Scrubber from '../components/Scrubber'

export default function ShareView() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

            <p className="text-xs mt-8 text-center" style={{ color: 'var(--ink-muted)' }}>
              A read-only status page shared by {data.org_name}.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
