import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useChatUnread } from '../context/ChatUnreadContext'
import { getDisplayName } from '../lib/displayName'
import { SunIcon, MoonIcon, MonitorIcon } from './icons'
import NotificationBell from './NotificationBell'
import UnreadBadge from './UnreadBadge'

const NAV_LINKS = [
  { to: '/', label: 'Projects', end: true },
  { to: '/my-tasks', label: 'My Tasks' },
  { to: '/clients', label: 'Clients' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/reports', label: 'Reports' },
  { to: '/chat', label: 'Chat' },
]
// Team and Settings moved to the name dropdown in the top-right corner
// (see the menu below) — no need for them here too.

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
]

export default function AppShell({ children }) {
  const { user, profile, orgs, activeOrgId, setActiveOrgId, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const { totalUnread, totalMentions } = useChatUnread()
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

  // Nav visibility only -- not a security boundary. The real check lives
  // server-side in api/admin.js (requirePlatformAdmin against the
  // server-only PLATFORM_ADMIN_EMAIL). This is a separate, VITE_-prefixed
  // env var by necessity (server env vars never reach the client bundle),
  // so it needs to be set to the same value in Vercel alongside the
  // server one -- see SETUP.md.
  const isPlatformAdmin = Boolean(
    import.meta.env.VITE_PLATFORM_ADMIN_EMAIL &&
    user?.email &&
    user.email.toLowerCase() === import.meta.env.VITE_PLATFORM_ADMIN_EMAIL.toLowerCase()
  )

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
              className="text-sm px-3 py-1.5 rounded-md border hover-surface transition-colors flex items-center gap-1.5 max-w-[160px]"
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

                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Appearance</p>
                  <div className="flex gap-1" role="radiogroup" aria-label="Theme">
                    {THEME_OPTIONS.map(({ value, label, Icon }) => {
                      const active = theme === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTheme(value)}
                          role="radio"
                          aria-checked={active}
                          title={label}
                          className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded-md text-xs transition-colors"
                          style={{
                            background: active ? 'var(--panel-sunken)' : 'transparent',
                            color: active ? 'var(--ink)' : 'var(--ink-muted)',
                            fontWeight: active ? 500 : 400,
                          }}
                        >
                          <Icon />
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <Link
                  to="/team"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover-surface"
                  role="menuitem"
                >
                  Team
                </Link>
                <Link
                  to="/task-templates"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover-surface"
                  role="menuitem"
                >
                  Task Templates
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover-surface"
                  role="menuitem"
                >
                  Settings
                </Link>
                <Link
                  to="/welcome"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover-surface"
                  role="menuitem"
                >
                  Take the tour
                </Link>
                {isPlatformAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm hover-surface"
                    role="menuitem"
                  >
                    Admin
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="block w-full text-left px-3 py-2 text-sm hover-surface"
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
              `text-sm px-3 py-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${isActive ? 'font-medium' : ''}`
            }
            style={({ isActive }) => ({
              borderColor: isActive ? 'var(--ink)' : 'transparent',
              color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
            })}
          >
            {link.label}
            {link.to === '/chat' && (
              <UnreadBadge count={totalUnread} variant={totalMentions > 0 ? 'mention' : 'default'} />
            )}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 px-4 sm:px-6 py-6 max-w-5xl w-full mx-auto print:max-w-none print:p-8">
        {children}
      </main>
    </div>
  )
}
