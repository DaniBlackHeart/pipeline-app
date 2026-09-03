import { useEffect, useState, useCallback } from 'react'
import { getAdminOverview, getAdminHealth, setMemberRole, removeMember } from '../lib/adminApi'
import { humanizeBytes } from '../lib/files'
import { formatMoney } from '../lib/currency'

// This page is only reachable in practice because the nav link (see
// AppShell.jsx) and the route itself both stay hidden unless the
// logged-in email matches VITE_PLATFORM_ADMIN_EMAIL -- but that's a UI
// convenience, not the real gate. The actual authorization check is
// server-side in api/admin.js (requirePlatformAdmin), so landing here
// without being the platform admin just produces a 403 from every call
// below rather than any real data.

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'orgs', label: 'Organizations' },
  { key: 'usage', label: 'Usage' },
  { key: 'health', label: 'System health' },
]

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
      <p className="text-xs uppercase tracking-wide font-mono mb-1" style={{ color: 'var(--ink-muted)' }}>{label}</p>
      <p className="font-display font-bold text-2xl">{value}</p>
    </div>
  )
}

function StatusPill({ ok, trueLabel = 'Configured', falseLabel = 'Not set' }) {
  return (
    <span
      className="text-xs font-mono uppercase tracking-wide rounded-md px-2 py-1"
      style={{
        background: ok ? 'var(--tally-done-soft)' : 'var(--tally-alert-soft)',
        color: ok ? 'var(--tally-done)' : 'var(--tally-alert)',
      }}
    >
      {ok ? trueLabel : falseLabel}
    </span>
  )
}

function OverviewTab({ overview }) {
  const { totals, orgs } = overview

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Organizations" value={totals.organizations} />
        <StatCard label="Users" value={totals.users} />
        <StatCard label="Projects" value={totals.projects} />
        <StatCard label="Tasks" value={totals.tasks} />
        <StatCard label="Invoices" value={totals.invoices} />
        <StatCard label="Tickets" value={totals.tickets} />
      </div>

      <h2 className="font-display font-bold text-lg mb-3">Per-organization breakdown</h2>
      <div className="rounded-lg border overflow-x-auto" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: 'var(--border)' }}>
              <th className="px-4 py-2 font-medium">Organization</th>
              <th className="px-4 py-2 font-medium">Members</th>
              <th className="px-4 py-2 font-medium">Projects</th>
              <th className="px-4 py-2 font-medium">Tasks</th>
              <th className="px-4 py-2 font-medium">Invoices</th>
              <th className="px-4 py-2 font-medium">Tickets</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <td className="px-4 py-2 font-medium">{org.name}</td>
                <td className="px-4 py-2">{org.members.length}</td>
                <td className="px-4 py-2">{org.counts.projects}</td>
                <td className="px-4 py-2">{org.counts.tasks}</td>
                <td className="px-4 py-2">{org.counts.invoices}</td>
                <td className="px-4 py-2">{org.counts.tickets}</td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr><td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-muted)' }} colSpan={6}>No organizations yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OrgsTab({ overview, expandedOrgs, toggleOrg, onRoleChange, onRemove }) {
  const { orgs } = overview

  return (
    <div className="space-y-3">
      {orgs.map((org) => {
        const isExpanded = expandedOrgs[org.id]
        const ownerCount = org.members.filter((m) => m.role === 'owner').length
        return (
          <div key={org.id} className="rounded-lg border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <button
              onClick={() => toggleOrg(org.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-medium">{org.name}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {org.slug} · {org.members.length} member{org.members.length === 1 ? '' : 's'} · created {new Date(org.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className="text-xs font-mono uppercase" style={{ color: 'var(--tally-progress)' }}>
                {isExpanded ? 'Hide roster' : 'Show roster'}
              </span>
            </button>

            {isExpanded && (
              <ul className="border-t px-4 py-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
                {org.members.map((member) => {
                  const isLastOwner = member.role === 'owner' && ownerCount === 1
                  return (
                    <li key={member.userId} className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{member.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{member.email}</p>
                      </div>

                      {isLastOwner ? (
                        <span className="text-xs font-mono uppercase" style={{ color: 'var(--ink-muted)' }}>
                          {ROLE_LABELS[member.role]}
                        </span>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(e) => onRoleChange(org.id, member.userId, e.target.value)}
                          className="text-xs font-mono uppercase rounded-md border px-2 py-1"
                          style={{ borderColor: 'var(--border)' }}
                          aria-label={`Role for ${member.name} in ${org.name}`}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      )}

                      {!isLastOwner && (
                        <button
                          onClick={() => onRemove(org.id, member.userId, member.name)}
                          className="text-xs"
                          style={{ color: 'var(--tally-alert)' }}
                          aria-label={`Remove ${member.name} from ${org.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  )
                })}
                {org.members.length === 0 && (
                  <li className="text-sm" style={{ color: 'var(--ink-muted)' }}>No members.</li>
                )}
              </ul>
            )}
          </div>
        )
      })}
      {orgs.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No organizations yet.</p>
      )}
    </div>
  )
}

function UsageTab({ overview }) {
  const { orgs } = overview

  return (
    <div className="space-y-3">
      <p className="text-sm mb-2" style={{ color: 'var(--ink-muted)' }}>
        Resource usage as a proxy for activity — Pipeline doesn't have its own subscription/billing
        system yet, so this isn't a billing view. Real billing would need a payment processor
        decision (e.g. Stripe) as a separate feature.
      </p>
      {orgs.map((org) => {
        const currencies = Object.entries(org.invoiceTotals)
        return (
          <div key={org.id} className="rounded-lg border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">{org.name}</p>
              <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>{humanizeBytes(org.attachmentBytes)} in attachments</p>
            </div>
            {currencies.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>No invoices yet.</p>
            ) : (
              <ul className="text-xs space-y-1" style={{ color: 'var(--ink-muted)' }}>
                {currencies.map(([currency, data]) => (
                  <li key={currency}>
                    {currency}: {data.count} invoice{data.count === 1 ? '' : 's'} · {formatMoney(data.total, currency)} total · {formatMoney(data.paidTotal, currency)} paid
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {orgs.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No organizations yet.</p>
      )}
    </div>
  )
}

function HealthTab({ health }) {
  const { env, backup, integrations, recentErrors } = health

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-lg mb-3">Integration configuration</h2>
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <span className="text-sm">Google Calendar OAuth</span>
            <StatusPill ok={env.googleCalendar} />
          </li>
          <li className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <span className="text-sm">Email digest (Resend)</span>
            <StatusPill ok={env.emailDigest} />
          </li>
          <li className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <span className="text-sm">CRON_SECRET (guards every scheduled job)</span>
            <StatusPill ok={env.cronSecret} />
          </li>
        </ul>
      </div>

      <div>
        <h2 className="font-display font-bold text-lg mb-3">Backups</h2>
        <div className="rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          {backup.latestFile ? (
            <p className="text-sm">
              Latest export: <span className="font-mono">{backup.latestFile}</span>
              {backup.ageHours !== null && (
                <span style={{ color: 'var(--ink-muted)' }}> — {backup.ageHours}h ago</span>
              )}
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--tally-alert)' }}>No backup export found yet.</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-display font-bold text-lg mb-3">Connections</h2>
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <span className="text-sm">Google Calendar connections</span>
            <span className="text-sm font-mono">{integrations.googleCalendarConnections}</span>
          </li>
          <li className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <span className="text-sm">Wise connections</span>
            <span className="text-sm font-mono">{integrations.wiseConnections}</span>
          </li>
          <li className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            <span className="text-sm">Stripe connections</span>
            <span className="text-sm font-mono">{integrations.stripeConnections}</span>
          </li>
        </ul>
      </div>

      <div>
        <h2 className="font-display font-bold text-lg mb-3">Recent server errors</h2>
        {recentErrors.length === 0 ? (
          <p className="text-sm rounded-lg border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            None recorded — or none yet since this logging was added. This is best-effort (see below), not a
            guarantee that nothing has failed.
          </p>
        ) : (
          <ul className="rounded-lg border divide-y" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            {recentErrors.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-mono" style={{ color: 'var(--tally-alert)' }}>{row.context}</span>
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm mt-1">{row.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        This is a lightweight log, not a real error tracker — no alerting, no stack traces, and writes here
        are best-effort (a handful of errors right as a function terminates could theoretically not make it
        in). Vercel's function logs remain the complete record. Wiring up a real tracker (e.g. Sentry's free
        tier) is still tracked as a "before licensing" item if you want proactive alerting later.
      </p>
    </div>
  )
}

export default function Admin() {
  const [activeTab, setActiveTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [expandedOrgs, setExpandedOrgs] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [overviewData, healthData] = await Promise.all([getAdminOverview(), getAdminHealth()])
      setOverview(overviewData)
      setHealth(healthData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleOrg = (orgId) => setExpandedOrgs((prev) => ({ ...prev, [orgId]: !prev[orgId] }))

  const handleRoleChange = async (orgId, userId, role) => {
    setActionError('')
    try {
      await setMemberRole(orgId, userId, role)
      await load()
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleRemove = async (orgId, userId, name) => {
    if (!window.confirm(`Remove ${name} from this workspace?`)) return
    setActionError('')
    try {
      await removeMember(orgId, userId)
      await load()
    } catch (err) {
      setActionError(err.message)
    }
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
  }

  if (error) {
    return (
      <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
        {error}
      </p>
    )
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-6">Admin</h1>

      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="text-sm px-3 py-2.5 border-b-2 transition-colors"
            style={{
              borderColor: activeTab === tab.key ? 'var(--ink)' : 'transparent',
              color: activeTab === tab.key ? 'var(--ink)' : 'var(--ink-muted)',
              fontWeight: activeTab === tab.key ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {actionError}
        </p>
      )}

      {activeTab === 'overview' && <OverviewTab overview={overview} />}
      {activeTab === 'orgs' && (
        <OrgsTab overview={overview} expandedOrgs={expandedOrgs} toggleOrg={toggleOrg} onRoleChange={handleRoleChange} onRemove={handleRemove} />
      )}
      {activeTab === 'usage' && <UsageTab overview={overview} />}
      {activeTab === 'health' && <HealthTab health={health} />}
    </div>
  )
}
