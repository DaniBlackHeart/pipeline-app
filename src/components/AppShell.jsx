import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getDisplayName } from '../lib/displayName'
import NotificationBell from './NotificationBell'

const NAV_LINKS = [
  { to: '/', label: 'Projects', end: true },
  { to: '/my-tasks', label: 'My Tasks' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/reports', label: 'Reports' },
]
// Team and Settings moved to the name dropdown in the top-right corner
// (see the menu below) — no need for them here too.

export default function AppShell({ children }) {
  const { user, profile, orgs, activeOrgId, setActiveOrgId, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  // Close on outside click or Escape — standard dropdown behavior, no
  // library needed for something this small.
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const handleKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  const displayName = getDisplayName(profile || { email: user?.email }, user?.email || 'Account')

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <header
        className="print:hidden border-b px-4 sm:px-6 py-3 flex items-center justify-between gap-4"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <span
            className="h-7 w-7 rounded-md flex items-center justify-center font-display font-bold text-sm"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            aria-hidden="true"
          >
            P
          </span>
          <span className="font-display font-bold text-lg tracking-tight hidden sm:inline">PIPELINE</span>
        </Link>

        <div className="flex items-center gap-3 min-w-0">
          <NotificationBell />
          {orgs.length > 1 && (
            <select
              value={activeOrgId || ''}
              onChange={(e) => setActiveOrgId(e.target.value)}
              className="text-sm rounded-md border px-2 py-1.5 bg-transparent max-w-[140px] sm:max-w-none truncate font-mono"
              style={{ borderColor: 'var(--border)' }}
              aria-label="Active workspace"
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          )}
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-black/5 transition-colors flex items-center gap-1.5 max-w-[160px]"
              style={{ borderColor: 'var(--border)' }}
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <span className="truncate">{displayName}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="flex-shrink-0">
                <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 mt-1.5 w-44 rounded-md border shadow-lg py-1 z-20"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
                role="menu"
              >
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{user?.email}</p>
                </div>
                <Link
                  to="/team"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover:bg-black/5"
                  role="menuitem"
                >
                  Team
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover:bg-black/5"
                  role="menuitem"
                >
                  Settings
                </Link>
                <button
                  onClick={handleSignOut}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                  style={{ color: 'var(--tally-alert)' }}
                  role="menuitem"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav
        className="print:hidden border-b px-4 sm:px-6 flex gap-1"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `text-sm px-3 py-2.5 border-b-2 transition-colors ${isActive ? 'font-medium' : ''}`
            }
            style={({ isActive }) => ({
              borderColor: isActive ? 'var(--ink)' : 'transparent',
              color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
            })}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 px-4 sm:px-6 py-6 max-w-5xl w-full mx-auto print:max-w-none print:p-8">
        {children}
      </main>
    </div>
  )
}
