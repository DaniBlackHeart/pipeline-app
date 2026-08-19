import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  buildGoogleAuthUrl,
  getGoogleRedirectUri,
  getGoogleCalendarStatus,
  exchangeGoogleCode,
  disconnectGoogleCalendar,
  syncGoogleCalendarNow,
} from '../lib/googleCalendar'
import {
  getWiseReconcileStatus,
  connectWiseReconcile,
  disconnectWiseReconcile,
  syncWiseReconcileNow,
} from '../lib/wiseReconcile'
import { generateBackupCodes, getBackupCodesRemaining } from '../lib/mfaBackupCodes'

export default function Settings() {
  const { activeOrgId, activeOrg, user, profile, refreshProfile, refreshMfaLevel } = useAuth()
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const [profileFullName, setProfileFullName] = useState('')
  const [profileNickname, setProfileNickname] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')

  useEffect(() => {
    if (!profile) return
    setProfileFullName(profile.full_name || '')
    setProfileNickname(profile.nickname || '')
  }, [profile])

  const handleSaveProfile = async (e) => {
    e.preventDefault()
    setProfileError('')
    setProfileSaved(false)
    const trimmedName = profileFullName.trim()
    if (!trimmedName) {
      setProfileError('Full name can\'t be empty.')
      return
    }
    setProfileSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: trimmedName, nickname: profileNickname.trim() || null })
      .eq('id', user.id)
    setProfileSaving(false)
    if (error) {
      setProfileError(error.message)
      return
    }
    await refreshProfile()
    setProfileSaved(true)
  }

  const [wiseLink, setWiseLink] = useState('')
  const [invoicePrefix, setInvoicePrefix] = useState('INV')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [prefs, setPrefs] = useState(null)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [prefsError, setPrefsError] = useState('')

  const [googleStatus, setGoogleStatus] = useState(null) // { connected, email, lastSyncedAt }
  const [googleBusy, setGoogleBusy] = useState(false) // connecting/disconnecting/exchanging
  const [googleSyncing, setGoogleSyncing] = useState(false)
  const [googleError, setGoogleError] = useState('')
  const [googleNotice, setGoogleNotice] = useState('')

  const loadGoogleStatus = useCallback(async () => {
    if (!activeOrgId) return
    try {
      setGoogleStatus(await getGoogleCalendarStatus(activeOrgId))
    } catch (err) {
      setGoogleError(err.message)
    }
  }, [activeOrgId])

  useEffect(() => { loadGoogleStatus() }, [loadGoogleStatus])

  // Google redirects back here with ?code=... after the user approves
  // access. Exchange it once, then scrub the code out of the URL so a
  // page refresh doesn't try to redeem it a second time (Google codes
  // are single-use).
  useEffect(() => {
    if (!activeOrgId) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return
    window.history.replaceState({}, '', window.location.pathname)
    setGoogleBusy(true)
    setGoogleError('')
    exchangeGoogleCode(activeOrgId, code, getGoogleRedirectUri())
      .then(() => { setGoogleNotice('Google Calendar connected.'); return loadGoogleStatus() })
      .catch((err) => setGoogleError(err.message))
      .finally(() => setGoogleBusy(false))
  }, [activeOrgId, loadGoogleStatus])

  const handleGoogleDisconnect = async () => {
    setGoogleBusy(true)
    setGoogleError('')
    setGoogleNotice('')
    try {
      await disconnectGoogleCalendar(activeOrgId)
      await loadGoogleStatus()
    } catch (err) {
      setGoogleError(err.message)
    }
    setGoogleBusy(false)
  }

  const handleGoogleSyncNow = async () => {
    setGoogleSyncing(true)
    setGoogleError('')
    setGoogleNotice('')
    try {
      const result = await syncGoogleCalendarNow(activeOrgId)
      setGoogleNotice(`Synced — ${result.created} new, ${result.updated} updated.`)
      await loadGoogleStatus()
    } catch (err) {
      setGoogleError(err.message)
    }
    setGoogleSyncing(false)
  }

  const [wiseStatus, setWiseStatus] = useState(null)
  const [wiseTokenInput, setWiseTokenInput] = useState('')
  const [wiseBusy, setWiseBusy] = useState(false)
  const [wiseSyncing, setWiseSyncing] = useState(false)
  const [wiseError, setWiseError] = useState('')
  const [wiseNotice, setWiseNotice] = useState('')

  const loadWiseStatus = useCallback(async () => {
    if (!activeOrgId || !isAdmin) return
    try {
      setWiseStatus(await getWiseReconcileStatus(activeOrgId))
    } catch (err) {
      setWiseError(err.message)
    }
  }, [activeOrgId, isAdmin])

  useEffect(() => { loadWiseStatus() }, [loadWiseStatus])

  const handleWiseConnect = async (e) => {
    e.preventDefault()
    if (!wiseTokenInput.trim()) return
    setWiseBusy(true)
    setWiseError('')
    setWiseNotice('')
    try {
      const result = await connectWiseReconcile(activeOrgId, wiseTokenInput.trim())
      setWiseTokenInput('')
      if (!result.supported) {
        setWiseError(result.error)
      } else {
        setWiseNotice('Connected — Wise account confirmed eligible for auto-reconciliation.')
      }
      await loadWiseStatus()
    } catch (err) {
      setWiseError(err.message)
    }
    setWiseBusy(false)
  }

  const handleWiseDisconnect = async () => {
    setWiseBusy(true)
    setWiseError('')
    setWiseNotice('')
    try {
      await disconnectWiseReconcile(activeOrgId)
      await loadWiseStatus()
    } catch (err) {
      setWiseError(err.message)
    }
    setWiseBusy(false)
  }

  const handleWiseSyncNow = async () => {
    setWiseSyncing(true)
    setWiseError('')
    setWiseNotice('')
    try {
      const result = await syncWiseReconcileNow(activeOrgId)
      if (result.error) {
        setWiseError(result.error)
      } else {
        setWiseNotice(`Synced — ${result.autoMatched} invoice(s) auto-marked paid, ${result.unmatched} transaction(s) need review.`)
      }
      await loadWiseStatus()
    } catch (err) {
      setWiseError(err.message)
    }
    setWiseSyncing(false)
  }

  const [mfaFactor, setMfaFactor] = useState(null) // the verified TOTP factor, if any
  const [mfaEnrollment, setMfaEnrollment] = useState(null) // { factorId, qrCode, secret } while mid-setup
  const [mfaCode, setMfaCode] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const [mfaNotice, setMfaNotice] = useState('')
  const [mfaConfirmingDisable, setMfaConfirmingDisable] = useState(false)
  const [backupCodes, setBackupCodes] = useState(null) // freshly generated plaintext codes, shown once
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(null)
  const [backupCodesBusy, setBackupCodesBusy] = useState(false)
  const [backupCodesSaved, setBackupCodesSaved] = useState(false)

  const loadBackupCodesRemaining = useCallback(async () => {
    try {
      const result = await getBackupCodesRemaining()
      setBackupCodesRemaining(result.remaining)
    } catch {
      // Not enrolled in 2FA yet, or nothing to report — leave it null.
    }
  }, [])

  const loadMfaFactor = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return
    const factor = data?.totp?.find((f) => f.status === 'verified') || null
    setMfaFactor(factor)
    if (factor) loadBackupCodesRemaining()
  }, [loadBackupCodesRemaining])

  useEffect(() => { loadMfaFactor() }, [loadMfaFactor])

  const handleMfaEnrollStart = async () => {
    setMfaBusy(true)
    setMfaError('')
    setMfaNotice('')
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setMfaBusy(false)
    if (error) {
      setMfaError(error.message)
      return
    }
    setMfaEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
  }

  const handleMfaEnrollCancel = async () => {
    if (mfaEnrollment) {
      // Clean up the unverified factor Supabase already created — leaving
      // it dangling could block starting a fresh enrollment later.
      await supabase.auth.mfa.unenroll({ factorId: mfaEnrollment.factorId })
    }
    setMfaEnrollment(null)
    setMfaCode('')
    setMfaError('')
  }

  const handleMfaVerify = async (e) => {
    e.preventDefault()
    if (mfaCode.trim().length !== 6) {
      setMfaError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setMfaBusy(true)
    setMfaError('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mfaEnrollment.factorId,
      code: mfaCode.trim(),
    })
    setMfaBusy(false)
    if (error) {
      setMfaError(error.message)
      return
    }
    setMfaEnrollment(null)
    setMfaCode('')
    setMfaNotice("Two-factor authentication is on. You'll be asked for a code like this every time you log in from here on.")
    await loadMfaFactor()
    await refreshMfaLevel()

    // Generate backup codes right away, same turn as enrolling — standard
    // practice (GitHub, Google, etc. all do this), since the whole point
    // is having them ready *before* the day the authenticator is lost,
    // not after.
    setBackupCodesBusy(true)
    try {
      const result = await generateBackupCodes()
      setBackupCodes(result.codes)
      setBackupCodesSaved(false)
      await loadBackupCodesRemaining()
    } catch (err) {
      setMfaError(`2FA is on, but generating backup codes failed: ${err.message}. Try "Generate new codes" below.`)
    }
    setBackupCodesBusy(false)
  }

  const handleMfaDisable = async () => {
    setMfaBusy(true)
    setMfaError('')
    setMfaNotice('')
    const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactor.id })
    setMfaBusy(false)
    setMfaConfirmingDisable(false)
    if (error) {
      setMfaError(error.message)
      return
    }
    setMfaNotice('Two-factor authentication is off.')
    await loadMfaFactor()
    await refreshMfaLevel()
  }

  const handleGenerateNewBackupCodes = async () => {
    setBackupCodesBusy(true)
    setMfaError('')
    try {
      const result = await generateBackupCodes()
      setBackupCodes(result.codes)
      setBackupCodesSaved(false)
      await loadBackupCodesRemaining()
    } catch (err) {
      setMfaError(err.message)
    }
    setBackupCodesBusy(false)
  }

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    const [{ data, error: fetchError }, { data: prefsData, error: prefsError }] = await Promise.all([
      supabase.from('organizations').select('wise_payment_link, invoice_prefix').eq('id', activeOrgId).single(),
      supabase.from('notification_preferences').select('*').eq('org_id', activeOrgId).eq('user_id', user?.id).maybeSingle(),
    ])
    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setWiseLink(data.wise_payment_link || '')
    setInvoicePrefix(data.invoice_prefix || 'INV')

    if (prefsData) {
      setPrefs(prefsData)
    } else if (!prefsError) {
      // No row yet (shouldn't normally happen — the trigger creates one on
      // join — but fall back to sensible defaults rather than a blank form).
      setPrefs({
        email_enabled: true,
        notify_overdue_invoices: true,
        notify_tasks_due: true,
        notify_open_tickets: true,
        notify_recurring_generated: true,
      })
    }
    setLoading(false)
  }, [activeOrgId, user?.id])

  useEffect(() => { load() }, [load])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        wise_payment_link: wiseLink.trim() || null,
        invoice_prefix: invoicePrefix.trim() || 'INV',
      })
      .eq('id', activeOrgId)
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setSaved(true)
  }

  const togglePref = (field) => {
    setPrefs((prev) => ({ ...prev, [field]: !prev[field] }))
  }

  const handleSavePrefs = async (e) => {
    e.preventDefault()
    setPrefsError('')
    setPrefsSaved(false)
    setPrefsSaving(true)
    const { error: upsertError } = await supabase
      .from('notification_preferences')
      .upsert({ org_id: activeOrgId, user_id: user?.id, ...prefs }, { onConflict: 'org_id,user_id' })
    setPrefsSaving(false)
    if (upsertError) {
      setPrefsError(upsertError.message)
      return
    }
    setPrefsSaved(true)
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>

  const googleConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="font-display font-bold text-2xl mb-1">Settings</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>Workspace: {activeOrg?.name}</p>

      <form onSubmit={handleSaveProfile} className="rounded-lg border p-5 space-y-4 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div>
          <h2 className="font-display font-bold text-lg mb-1">Your profile</h2>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Just for you — this is what everyone else on the team sees for you, in Team, task assignments,
            comments, and the menu in the top-right corner.
          </p>
        </div>

        <div>
          <label htmlFor="profile-full-name" className="block text-sm font-medium mb-1">Full name</label>
          <input
            id="profile-full-name"
            type="text"
            value={profileFullName}
            onChange={(e) => setProfileFullName(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
            required
          />
        </div>

        <div>
          <label htmlFor="profile-nickname" className="block text-sm font-medium mb-1">Nickname (optional)</label>
          <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
            Shown instead of your full name everywhere your name appears, if set.
          </p>
          <input
            id="profile-nickname"
            type="text"
            value={profileNickname}
            onChange={(e) => setProfileNickname(e.target.value)}
            placeholder="e.g. how your teammates already know you"
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        {profileError && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {profileError}
          </p>
        )}
        {profileSaved && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
            Profile saved.
          </p>
        )}

        <button
          type="submit"
          disabled={profileSaving}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          {profileSaving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {!isAdmin && (
        <p className="text-sm rounded-md px-3 py-2 mb-4" style={{ background: 'var(--tally-progress-soft)', color: 'var(--ink)' }}>
          Only workspace owners/admins can change these settings. You can view them here.
        </p>
      )}

      <form onSubmit={handleSubmit} className="rounded-lg border p-5 space-y-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div>
          <label htmlFor="wise-link" className="block text-sm font-medium mb-1">Wise payment link</label>
          <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
            Your permanent Wise Business payment link (from Wise → Payments → "Your open link"). It gets embedded
            on every invoice, along with a reminder for the client to reference the invoice number when they pay.
          </p>
          <input
            id="wise-link"
            type="url"
            value={wiseLink}
            onChange={(e) => setWiseLink(e.target.value)}
            placeholder="https://wise.com/pay/business/yourname"
            disabled={!isAdmin}
            className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        <div>
          <label htmlFor="invoice-prefix" className="block text-sm font-medium mb-1">Invoice number prefix</label>
          <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
            New invoices are numbered automatically, e.g. {invoicePrefix || 'INV'}-0001, {invoicePrefix || 'INV'}-0002…
          </p>
          <input
            id="invoice-prefix"
            type="text"
            value={invoicePrefix}
            onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
            disabled={!isAdmin}
            maxLength={8}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>

        {error && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
            Settings saved.
          </p>
        )}

        {isAdmin && (
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </form>

      {prefs && (
        <form onSubmit={handleSavePrefs} className="rounded-lg border p-5 space-y-4 mt-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div>
            <h2 className="font-display font-bold text-lg mb-1">Email notifications</h2>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Just for you — these don't affect what other members of {activeOrg?.name} receive. A daily digest goes
              out once a day (only when there's something to report; empty days send nothing). Requires the
              optional digest job described in SETUP.md to be deployed.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={prefs.email_enabled} onChange={() => togglePref('email_enabled')} />
            Send me the daily digest email
          </label>

          <div className="space-y-2 pl-1" style={{ opacity: prefs.email_enabled ? 1 : 0.5 }}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.notify_overdue_invoices}
                onChange={() => togglePref('notify_overdue_invoices')}
                disabled={!prefs.email_enabled}
              />
              Overdue invoices
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.notify_tasks_due}
                onChange={() => togglePref('notify_tasks_due')}
                disabled={!prefs.email_enabled}
              />
              Tasks due today or overdue
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.notify_open_tickets}
                onChange={() => togglePref('notify_open_tickets')}
                disabled={!prefs.email_enabled}
              />
              Open ticket summary
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.notify_recurring_generated}
                onChange={() => togglePref('notify_recurring_generated')}
                disabled={!prefs.email_enabled}
              />
              Recurring invoices auto-generated that day
            </label>
          </div>

          {prefsError && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
              {prefsError}
            </p>
          )}
          {prefsSaved && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
              Notification preferences saved.
            </p>
          )}

          <button
            type="submit"
            disabled={prefsSaving}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {prefsSaving ? 'Saving…' : 'Save notification preferences'}
          </button>
        </form>
      )}

      <div className="rounded-lg border p-5 space-y-4 mt-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div>
          <h2 className="font-display font-bold text-lg mb-1">Google Calendar</h2>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Personal, like the notification settings above — connecting here syncs Calendar events between
            Pipeline and your own Google account. Two-way: events created or edited on either side show up on
            the other, usually within a few minutes when you're active in Pipeline, or by the next day at the
            latest either way.
          </p>
        </div>

        {!googleConfigured ? (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--panel-sunken)', color: 'var(--ink-muted)' }}>
            Not set up on this deployment yet — needs Google OAuth credentials configured first. See SETUP.md.
          </p>
        ) : googleStatus?.connected ? (
          <div className="space-y-3">
            <p className="text-sm">
              Connected as <span className="font-medium">{googleStatus.email || 'your Google account'}</span>
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {googleStatus.lastSyncedAt
                ? `Last synced ${new Date(googleStatus.lastSyncedAt).toLocaleString()}`
                : 'Not synced yet — hit "Sync now" to pull in your existing Google events.'}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleGoogleSyncNow}
                disabled={googleSyncing || googleBusy}
                className="rounded-md px-4 py-2 text-sm font-medium border disabled:opacity-60"
                style={{ borderColor: 'var(--border)' }}
              >
                {googleSyncing ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                onClick={handleGoogleDisconnect}
                disabled={googleBusy}
                className="text-sm disabled:opacity-60"
                style={{ color: 'var(--tally-alert)' }}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <a
            href={buildGoogleAuthUrl()}
            className="inline-block rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--panel)', opacity: googleBusy ? 0.6 : 1, pointerEvents: googleBusy ? 'none' : 'auto' }}
          >
            {googleBusy ? 'Connecting…' : 'Connect Google Calendar'}
          </a>
        )}

        {googleError && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {googleError}
          </p>
        )}
        {googleNotice && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
            {googleNotice}
          </p>
        )}
      </div>

      {isAdmin && (
        <div className="rounded-lg border p-5 space-y-4 mt-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div>
            <h2 className="font-display font-bold text-lg mb-1">Wise auto-reconciliation</h2>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Workspace-wide, admin-only — unlike Google Calendar above, this uses your team's shared Wise
              Business account, not a personal one. Reads incoming transactions and auto-marks an invoice paid
              when a payment's reference contains that invoice's number and the amount matches exactly.
              Anything less certain shows up on the Invoices page for you to confirm by hand instead of
              guessing. <span className="font-medium">Only works for Wise accounts based in the US, Canada,
              Australia, New Zealand, Singapore, or Malaysia</span> — a restriction on Wise's own API, not
              something this can work around. Connecting from an account outside those countries will tell
              you so honestly rather than silently finding nothing.
            </p>
          </div>

          {wiseStatus?.connected ? (
            <div className="space-y-3">
              {wiseStatus.supported === false ? (
                <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }}>
                  Connected, but this account's country doesn't support balance-statement access via the API — see above. The token is saved for whenever that changes, but syncing won't find anything until then.
                </p>
              ) : (
                <p className="text-sm" style={{ color: 'var(--tally-done)' }}>Connected — account confirmed eligible.</p>
              )}
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {wiseStatus.lastSyncedAt
                  ? `Last synced ${new Date(wiseStatus.lastSyncedAt).toLocaleString()}`
                  : 'Not synced yet.'}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleWiseSyncNow}
                  disabled={wiseSyncing || wiseBusy || wiseStatus.supported === false}
                  className="rounded-md px-4 py-2 text-sm font-medium border disabled:opacity-60"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {wiseSyncing ? 'Reconciling…' : 'Reconcile now'}
                </button>
                <button
                  type="button"
                  onClick={handleWiseDisconnect}
                  disabled={wiseBusy}
                  className="text-sm disabled:opacity-60"
                  style={{ color: 'var(--tally-alert)' }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleWiseConnect} className="flex flex-col sm:flex-row gap-2">
              <label htmlFor="wise-token" className="sr-only">Wise personal API token</label>
              <input
                id="wise-token"
                type="password"
                value={wiseTokenInput}
                onChange={(e) => setWiseTokenInput(e.target.value)}
                placeholder="Paste your Wise personal API token…"
                className="rounded-md border px-3 py-2 text-sm flex-1"
                style={{ borderColor: 'var(--border)' }}
              />
              <button
                type="submit"
                disabled={wiseBusy || !wiseTokenInput.trim()}
                className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex-shrink-0"
                style={{ background: 'var(--ink)', color: 'var(--panel)' }}
              >
                {wiseBusy ? 'Connecting…' : 'Connect'}
              </button>
            </form>
          )}

          {wiseError && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
              {wiseError}
            </p>
          )}
          {wiseNotice && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
              {wiseNotice}
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border p-5 space-y-4 mt-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div>
          <h2 className="font-display font-bold text-lg mb-1">Two-factor authentication</h2>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Personal, like the notification settings — this protects your own login, not the workspace as a
            whole. Once it's on, logging in needs a 6-digit code from an authenticator app (Google
            Authenticator, Authy, 1Password, etc.) in addition to your password.
          </p>
        </div>

        {backupCodes ? (
          <div className="space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--tally-alert)' }}>
              Save these backup codes now — this is the only time they'll be shown.
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Each one works once, as a way back in if you ever lose access to your authenticator app. Store
              them somewhere safe (a password manager is ideal) — not a screenshot on the same phone your
              authenticator app is on.
            </p>
            <div
              className="grid grid-cols-2 gap-2 rounded-md border p-4 font-mono text-sm select-all"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-sunken)' }}
            >
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={backupCodesSaved} onChange={(e) => setBackupCodesSaved(e.target.checked)} />
              I've saved these somewhere safe
            </label>
            <button
              type="button"
              onClick={() => setBackupCodes(null)}
              disabled={!backupCodesSaved}
              className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              Done
            </button>
          </div>
        ) : mfaEnrollment ? (
          <form onSubmit={handleMfaVerify} className="space-y-3">
            <p className="text-sm">Scan this with your authenticator app:</p>
            <img
              src={mfaEnrollment.qrCode}
              alt="Scan this QR code with your authenticator app"
              className="rounded-md border"
              style={{ borderColor: 'var(--border)', width: 180, height: 180 }}
            />
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Can't scan it? Enter this code manually instead:{' '}
              <span className="font-mono select-all">{mfaEnrollment.secret}</span>
            </p>
            <div>
              <label htmlFor="mfa-enroll-code" className="block text-sm font-medium mb-1">
                Then enter the 6-digit code it shows
              </label>
              <input
                id="mfa-enroll-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="rounded-md border px-3 py-2 text-center text-lg tracking-[0.5em] font-mono"
                style={{ borderColor: 'var(--border)', width: 180 }}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={mfaBusy}
                className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                style={{ background: 'var(--ink)', color: 'var(--panel)' }}
              >
                {mfaBusy ? 'Verifying…' : 'Verify and enable'}
              </button>
              <button
                type="button"
                onClick={handleMfaEnrollCancel}
                disabled={mfaBusy}
                className="rounded-md px-4 py-2 text-sm font-medium border disabled:opacity-60"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : mfaFactor ? (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--tally-done)' }}>Two-factor authentication is on.</p>
            <div>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {backupCodesRemaining === null
                  ? ''
                  : backupCodesRemaining === 0
                    ? 'No backup codes left — generate a new set below so you have a way back in if you lose your device.'
                    : `${backupCodesRemaining} backup code${backupCodesRemaining === 1 ? '' : 's'} remaining.`}
              </p>
              <button
                type="button"
                onClick={handleGenerateNewBackupCodes}
                disabled={backupCodesBusy}
                className="text-sm underline disabled:opacity-60"
                style={{ color: 'var(--ink-muted)' }}
              >
                {backupCodesBusy ? 'Generating…' : 'Generate new codes'}
              </button>
            </div>
            {mfaConfirmingDisable ? (
              <div className="flex items-center gap-3">
                <p className="text-sm" style={{ color: 'var(--tally-alert)' }}>Turn it off?</p>
                <button
                  type="button"
                  onClick={handleMfaDisable}
                  disabled={mfaBusy}
                  className="text-sm rounded-md px-3 py-1.5 font-medium disabled:opacity-60"
                  style={{ background: 'var(--tally-alert)', color: 'var(--panel)' }}
                >
                  {mfaBusy ? 'Turning off…' : 'Yes, turn off'}
                </button>
                <button
                  type="button"
                  onClick={() => setMfaConfirmingDisable(false)}
                  className="text-sm"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  Never mind
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setMfaConfirmingDisable(true)}
                className="text-sm"
                style={{ color: 'var(--tally-alert)' }}
              >
                Disable
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleMfaEnrollStart}
            disabled={mfaBusy}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {mfaBusy ? 'Starting…' : 'Enable two-factor authentication'}
          </button>
        )}

        {mfaError && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
            {mfaError}
          </p>
        )}
        {mfaNotice && (
          <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
            {mfaNotice}
          </p>
        )}
      </div>
    </div>
  )
}
