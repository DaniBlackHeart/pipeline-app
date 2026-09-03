import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { SearchIcon } from './icons'

// Jump straight to a task, client, or invoice by name/number instead of
// navigating through list pages -- didn't exist anywhere in the app
// before this. Opens via the header button or Ctrl/Cmd+K from anywhere.
//
// Each query is explicitly scoped with .eq('org_id', activeOrgId) even
// though RLS already enforces that server-side -- defense in depth, and
// it also means a stale activeOrgId can't return another workspace's
// results even for a split second while a query is in flight.
const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 5
const DEBOUNCE_MS = 250

function dedupeById(rows) {
  const seen = new Set()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

export default function GlobalSearch() {
  const { activeOrgId } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState({ projects: [], tasks: [], clients: [], invoices: [] })
  const inputRef = useRef(null)
  const panelRef = useRef(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults({ projects: [], tasks: [], clients: [], invoices: [] })
  }, [])

  // Ctrl/Cmd+K opens from anywhere in the app; Escape closes.
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === 'Escape' && open) {
        close()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, close])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Close on outside click, same pattern as the account menu in AppShell.
  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) close()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, close])

  useEffect(() => {
    if (!open || !activeOrgId) return
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults({ projects: [], tasks: [], clients: [], invoices: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const like = `%${trimmed}%`
      // Two separate .ilike() queries per multi-column match, merged
      // client-side, rather than a hand-built .or() filter string --
      // PostgREST's .or() syntax treats commas and parentheses as
      // structural, so a client name like "Smith, Inc." would silently
      // break that filter. Plain .ilike() has no such parsing step.
      const [
        { data: projectsByName },
        { data: projectsByClient },
        { data: taskRows },
        { data: clientsByName },
        { data: clientsByCompany },
        { data: invoicesByNumber },
        { data: invoicesByClient },
      ] = await Promise.all([
        supabase.from('projects').select('id, name, status, client_name').eq('org_id', activeOrgId).ilike('name', like).limit(RESULT_LIMIT),
        supabase.from('projects').select('id, name, status, client_name').eq('org_id', activeOrgId).ilike('client_name', like).limit(RESULT_LIMIT),
        supabase
          .from('tasks')
          .select('id, title, status, project_id, projects ( name )')
          .eq('org_id', activeOrgId)
          .is('deleted_at', null)
          .ilike('title', like)
          .limit(RESULT_LIMIT),
        supabase.from('clients').select('id, name, company').eq('org_id', activeOrgId).ilike('name', like).limit(RESULT_LIMIT),
        supabase.from('clients').select('id, name, company').eq('org_id', activeOrgId).ilike('company', like).limit(RESULT_LIMIT),
        supabase
          .from('invoices')
          .select('id, invoice_number, client_name, status, total_amount, currency')
          .eq('org_id', activeOrgId)
          .ilike('invoice_number', like)
          .limit(RESULT_LIMIT),
        supabase
          .from('invoices')
          .select('id, invoice_number, client_name, status, total_amount, currency')
          .eq('org_id', activeOrgId)
          .ilike('client_name', like)
          .limit(RESULT_LIMIT),
      ])
      setResults({
        projects: dedupeById([...(projectsByName || []), ...(projectsByClient || [])]).slice(0, RESULT_LIMIT),
        tasks: taskRows || [],
        clients: dedupeById([...(clientsByName || []), ...(clientsByCompany || [])]).slice(0, RESULT_LIMIT),
        invoices: dedupeById([...(invoicesByNumber || []), ...(invoicesByClient || [])]).slice(0, RESULT_LIMIT),
      })
      setLoading(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, open, activeOrgId])

  const totalResults = results.projects.length + results.tasks.length + results.clients.length + results.invoices.length

  const goTo = (path) => {
    close()
    navigate(path)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const first = results.projects[0] || results.tasks[0] || results.clients[0] || results.invoices[0]
    if (!first) return
    if (results.projects.includes(first)) goTo(`/projects/${first.id}`)
    else if (results.tasks.includes(first)) goTo(`/tasks/${first.id}`)
    else if (results.clients.includes(first)) goTo(`/clients/${first.id}`)
    else goTo(`/invoices/${first.id}`)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-2.5 py-1.5 rounded-md border hover-surface transition-colors flex items-center gap-1.5"
        style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        aria-label="Search projects, tasks, clients, and invoices"
        title="Search (Ctrl/Cmd+K)"
      >
        <SearchIcon />
        <span className="hidden md:inline text-xs font-mono">Ctrl K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center pt-[10vh] px-4" style={{ background: 'rgba(0,0,0,0.35)' }}>
          <div
            ref={panelRef}
            className="w-full max-w-lg rounded-lg border shadow-xl overflow-hidden"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
          >
            <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
              <SearchIcon style={{ color: 'var(--ink-muted)' }} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects, tasks, clients, invoices…"
                className="flex-1 bg-transparent text-sm outline-none"
                aria-label="Search"
              />
            </form>

            <div className="max-h-[50vh] overflow-y-auto">
              {query.trim().length < MIN_QUERY_LENGTH ? (
                <p className="text-sm px-3 py-4" style={{ color: 'var(--ink-muted)' }}>
                  Type at least {MIN_QUERY_LENGTH} characters to search.
                </p>
              ) : loading ? (
                <p className="text-sm px-3 py-4" style={{ color: 'var(--ink-muted)' }}>Searching…</p>
              ) : totalResults === 0 ? (
                <p className="text-sm px-3 py-4" style={{ color: 'var(--ink-muted)' }}>No matches for "{query.trim()}".</p>
              ) : (
                <>
                  {results.projects.length > 0 && (
                    <ResultGroup label="Projects">
                      {results.projects.map((p) => (
                        <ResultRow key={p.id} onClick={() => goTo(`/projects/${p.id}`)}>
                          <span className="truncate">{p.name}</span>
                          <span className="text-xs flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                            {p.client_name || p.status}
                          </span>
                        </ResultRow>
                      ))}
                    </ResultGroup>
                  )}
                  {results.tasks.length > 0 && (
                    <ResultGroup label="Tasks">
                      {results.tasks.map((t) => (
                        <ResultRow key={t.id} onClick={() => goTo(`/tasks/${t.id}`)}>
                          <span className="truncate">{t.title}</span>
                          <span className="text-xs flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                            {t.projects?.name || 'Standalone'}
                          </span>
                        </ResultRow>
                      ))}
                    </ResultGroup>
                  )}
                  {results.clients.length > 0 && (
                    <ResultGroup label="Clients">
                      {results.clients.map((c) => (
                        <ResultRow key={c.id} onClick={() => goTo(`/clients/${c.id}`)}>
                          <span className="truncate">{c.name}</span>
                          {c.company && (
                            <span className="text-xs flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>{c.company}</span>
                          )}
                        </ResultRow>
                      ))}
                    </ResultGroup>
                  )}
                  {results.invoices.length > 0 && (
                    <ResultGroup label="Invoices">
                      {results.invoices.map((inv) => (
                        <ResultRow key={inv.id} onClick={() => goTo(`/invoices/${inv.id}`)}>
                          <span className="truncate">{inv.invoice_number} — {inv.client_name}</span>
                          <span className="text-xs flex-shrink-0 uppercase font-mono" style={{ color: 'var(--ink-muted)' }}>{inv.status}</span>
                        </ResultRow>
                      ))}
                    </ResultGroup>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ResultGroup({ label, children }) {
  return (
    <div>
      <p className="px-3 pt-2.5 pb-1 text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{label}</p>
      {children}
    </div>
  )
}

function ResultRow({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left hover-surface"
    >
      {children}
    </button>
  )
}
