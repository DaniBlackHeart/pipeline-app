import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export default function Team() {
  const { activeOrgId, activeOrg, user, session } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteError, setInviteError] = useState('')

  const [confirmingResetId, setConfirmingResetId] = useState(null)
  const [mfaResetBusy, setMfaResetBusy] = useState(false)
  const [mfaResetMessage, setMfaResetMessage] = useState('')
  const [mfaResetError, setMfaResetError] = useState('')

  const ownerCount = members.filter((m) => m.role === 'owner').length

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    setError('')
    const { data, error: fetchError } = await supabase
      .from('org_members')
      .select('user_id, role, created_at, profiles ( id, full_name, nickname, email )')
      .eq('org_id', activeOrgId)
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(friendlyError(fetchError))
      setLoading(false)
      return
    }
    setMembers((data || []).filter((m) => m.profiles).map((m) => ({
      userId: m.user_id,
      role: m.role,
      name: getDisplayName(m.profiles, 'Unnamed'),
      fullName: m.profiles.full_name || '',
      nickname: m.profiles.nickname || '',
      email: m.profiles.email || '—',
    })))
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviteError('')
    setInviteMessage('')
    if (!inviteEmail.trim()) {
      setInviteError('Enter an email address.')
      return
    }

    setInviting(true)
    try {
      const res = await fetch('/api/invite-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ orgId: activeOrgId, email: inviteEmail.trim(), role: inviteRole }),
      })
      const result = await res.json()

      if (!res.ok) {
        setInviteError(result.error || 'Something went wrong.')
        return
      }

      setInviteMessage(
        result.status === 'invited_new'
          ? `Invite sent to ${result.email} — they'll get an email to set a password and join.`
          : `${result.name || result.email} already had an account — added them to this workspace directly.`
      )
      setInviteEmail('')
      load()
    } catch {
      setInviteError('Could not reach the invite service. If this is a local dev server, the invite API only works when deployed to Vercel — see SETUP.md.')
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (memberUserId, newRole) => {
    setMembers((prev) => prev.map((m) => (m.userId === memberUserId ? { ...m, role: newRole } : m)))
    const { error: updateError } = await supabase
      .from('org_members')
      .update({ role: newRole })
      .eq('org_id', activeOrgId)
      .eq('user_id', memberUserId)
    if (updateError) {
      setError(friendlyError(updateError))
      load()
    }
  }

  const handleRemove = async (memberUserId) => {
    setMembers((prev) => prev.filter((m) => m.userId !== memberUserId))
    const { error: deleteError } = await supabase
      .from('org_members')
      .delete()
      .eq('org_id', activeOrgId)
      .eq('user_id', memberUserId)
    if (deleteError) {
      setError(friendlyError(deleteError))
      load()
    }
  }

  // Recovery for someone who's lost both their authenticator and their
  // saved backup codes -- see api/mfa.js's 'admin-reset' action and "How
  // two-factor authentication works" in README.md. Removes their
  // authenticator entirely (not a silent bypass); they'd re-enroll from
  // Settings afterward if they want 2FA back on.
  const handleResetMfa = async (memberUserId) => {
    setMfaResetBusy(true)
    setMfaResetError('')
    setMfaResetMessage('')
    try {
      const res = await fetch('/api/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: 'admin-reset', orgId: activeOrgId, targetUserId: memberUserId }),
      })
      const result = await res.json()
      if (!res.ok) {
        setMfaResetError(result.error || 'Something went wrong.')
      } else if (result.reset) {
        setMfaResetMessage('Two-factor authentication reset — they can log in with just their password now.')
      } else {
        setMfaResetMessage(result.message || "That person doesn't have two-factor authentication enabled.")
      }
    } catch {
      setMfaResetError('Could not reach the reset service. If this is a local dev server, this only works when deployed to Vercel — see SETUP.md.')
    } finally {
      setMfaResetBusy(false)
      setConfirmingResetId(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display font-bold text-2xl mb-1">Team</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>Workspace: {activeOrg?.name}</p>

      {!isAdmin && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-progress-soft)', color: 'var(--ink)' }}>
          Only workspace owners/admins can invite people or change roles. You can view the roster here.
        </p>
      )}

      {isAdmin && (
        <form onSubmit={handleInvite} className="rounded-lg border p-5 space-y-4 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <h2 className="font-display font-bold text-lg">Invite a teammate</h2>
          <div className="grid sm:grid-cols-[1fr_140px] gap-3">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium mb-1">Email</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                required
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="block text-sm font-medium mb-1">Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            If they already have a Pipeline account, they're added to this workspace immediately. If not, they get
            an email with a link to set a password and join — this part only works once the app is deployed to
            Vercel with the invite function configured (see SETUP.md).
          </p>

          {inviteError && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
              {inviteError}
            </p>
          )}
          {inviteMessage && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done-text)' }} role="status">
              {inviteMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={inviting}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {inviting ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      {mfaResetError && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {mfaResetError}
        </p>
      )}
      {mfaResetMessage && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done-text)' }} role="status">
          {mfaResetMessage}
        </p>
      )}

      <h2 className="font-display font-bold text-lg mb-3">Members</h2>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      ) : (
        <ul className="space-y-2">
          {members.map((member) => {
            const isSelf = member.userId === user?.id
            const isLastOwner = member.role === 'owner' && ownerCount === 1
            return (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 flex-wrap"
                style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{member.name}{isSelf ? ' (you)' : ''}</p>
                  {member.nickname && member.fullName && member.fullName !== member.nickname && (
                    <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{member.fullName}</p>
                  )}
                  <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{member.email}</p>
                </div>

                {isAdmin && !isSelf && !isLastOwner ? (
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                    className="text-xs font-mono uppercase rounded-md border px-2 py-1"
                    style={{ borderColor: 'var(--border)' }}
                    aria-label={`Role for ${member.name}`}
                  >
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span className="text-xs font-mono uppercase" style={{ color: 'var(--ink-muted)' }}>
                    {ROLE_LABELS[member.role]}
                  </span>
                )}

                {isAdmin && !isSelf && confirmingResetId === member.userId ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--tally-alert)' }}>Reset it?</span>
                    <button
                      onClick={() => handleResetMfa(member.userId)}
                      disabled={mfaResetBusy}
                      className="rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                      style={{ background: 'var(--tally-alert)', color: 'var(--panel)' }}
                    >
                      {mfaResetBusy ? 'Resetting…' : 'Yes, reset'}
                    </button>
                    <button
                      onClick={() => setConfirmingResetId(null)}
                      disabled={mfaResetBusy}
                      className="text-xs disabled:opacity-60"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      Never mind
                    </button>
                  </span>
                ) : (
                  isAdmin && !isSelf && (
                    <button
                      onClick={() => { setConfirmingResetId(member.userId); setMfaResetError(''); setMfaResetMessage('') }}
                      className="rounded-md px-3 py-1.5 text-xs font-medium border"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                      aria-label={`Reset two-factor authentication for ${member.name}`}
                    >
                      Reset 2FA
                    </button>
                  )
                )}

                {isAdmin && !isSelf && !isLastOwner && (
                  <button
                    onClick={() => handleRemove(member.userId)}
                    className="rounded-md px-3 py-1.5 text-xs font-medium border"
                    style={{ borderColor: 'var(--tally-alert)', color: 'var(--tally-alert)' }}
                    aria-label={`Remove ${member.name}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
