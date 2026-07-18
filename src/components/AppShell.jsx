import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV_LINKS = [
  { to: '/', label: 'Projects', end: true },
  { to: '/calendar', label: 'Calendar' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
]

export default function AppShell({ children }) {
  const { user, orgs, activeOrgId, setActiveOrgId, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

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
          {orgs.length > 0 && (
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
          <span className="text-sm hidden md:inline truncate max-w-[180px]" style={{ color: 'var(--ink-muted)' }}>
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-black/5 transition-colors flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            Log out
          </button>
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

      <main className="flex-1 px-4 sm:px-6 py-6 max-w-5xl w-full mx-auto print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  )
}
