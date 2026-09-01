import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getDisplayName } from '../lib/displayName'

// Same short pass for everyone regardless of role (owner/admin/member) --
// the app's real permission boundaries already show up naturally once
// someone's actually using it (an admin sees "Reset 2FA" on Team, a
// member doesn't), so this doesn't try to branch content by role.
const MODULES = [
  {
    title: 'Projects & Tasks',
    body: "Group tasks under a project, or create a standalone task with no project at all. Tasks can have more than one assignee, each with their own role label, and can link to other tasks directly.",
  },
  {
    title: 'Invoicing',
    body: 'Build an invoice from line items with auto-numbering, embed a Wise payment link, and export a PDF. Every invoice needs a client email and a link to a project or task -- that\'s enforced, not just a suggestion.',
  },
  {
    title: 'Calendar',
    body: 'Project and task due dates show up automatically alongside any standalone events you add. Connect Google Calendar for two-way sync so changes stay in step in both directions.',
  },
  {
    title: 'Tickets',
    body: 'Track bugs, requests, and questions with threaded comments. Clients can submit tickets themselves through a client-facing form.',
  },
  {
    title: 'Reports',
    body: 'Financial summaries, ticket activity, and a project rollup with per-project task drill-down by status -- all exportable to CSV.',
  },
  {
    title: 'Team',
    body: 'Invite teammates, manage roles and role labels, and (if you\'re an admin) reset a teammate\'s two-factor authentication if they\'re ever locked out.',
  },
]

const TIPS = [
  "Everything lives inside a workspace -- switch between workspaces from the dropdown in the top-right if you're part of more than one.",
  'The bell icon keeps a live feed of activity across tasks, tickets, invoices, and projects as they happen.',
  "Set up two-factor authentication from Settings for extra protection on your account -- it's optional, but recommended.",
  "You can reopen this walkthrough anytime from the account menu in the top-right -- look for \"Take the tour.\"",
]

const STEP_COUNT = 4

export default function Onboarding() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const displayName = getDisplayName(profile || { email: user?.email }, user?.email || 'there')
  const firstName = displayName.split(' ')[0]

  const finish = async () => {
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', user.id)
    setBusy(false)

    if (updateError) {
      setError("Couldn't save that you've seen this -- try again in a moment.")
      return
    }
    await refreshProfile()
    navigate('/', { replace: true })
  }

  const goNext = () => {
    if (step < STEP_COUNT - 1) setStep((s) => s + 1)
    else finish()
  }
  const goBack = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <span
            className="h-9 w-9 rounded-md flex items-center justify-center font-display font-bold"
            style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            aria-hidden="true"
          >
            P
          </span>
          <span className="font-display font-bold text-2xl tracking-tight">PIPELINE</span>
        </div>

        <div className="rounded-lg border p-6 sm:p-8" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          {/* Progress dots -- also doubles as a step count for screen readers via aria-label below. */}
          <div className="flex items-center justify-center gap-1.5 mb-6" role="img" aria-label={`Step ${step + 1} of ${STEP_COUNT}`}>
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === step ? '1.5rem' : '0.375rem',
                  background: i <= step ? 'var(--ink)' : 'var(--border)',
                }}
              />
            ))}
          </div>

          {step === 0 && (
            <div className="text-center py-4">
              <h1 className="font-display font-bold text-2xl mb-3">Welcome to Pipeline, {firstName}</h1>
              <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--ink-muted)' }}>
                Pipeline brings projects, tasks, invoicing, your calendar, tickets, and reporting into one place.
                This is a quick, four-step look at how it all fits together -- less than a minute.
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 className="font-display font-bold text-xl mb-1">What's here</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>The modules you'll use, at a glance.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {MODULES.map((mod) => (
                  <div key={mod.title} className="rounded-md border p-3.5" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-sm font-medium mb-1">{mod.title}</p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>{mod.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="font-display font-bold text-xl mb-1">A few things worth knowing</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>Small details that save you a search later.</p>
              <ul className="space-y-3">
                {TIPS.map((tip) => (
                  <li key={tip} className="text-sm flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--ink-muted)' }} aria-hidden="true" />
                    <span style={{ color: 'var(--ink-muted)' }}>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-4">
              <h1 className="font-display font-bold text-2xl mb-3">You're all set</h1>
              <p className="text-sm max-w-md mx-auto mb-1" style={{ color: 'var(--ink-muted)' }}>
                That's the whole tour. Jump in whenever you're ready -- and if you want to see this again,
                it's waiting in the account menu under "Take the tour."
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm rounded-md px-3 py-2 mt-4" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
            <div>
              {step > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={busy}
                  className="text-sm px-3 py-2 disabled:opacity-60"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                className="text-sm disabled:opacity-60"
                style={{ color: 'var(--ink-muted)' }}
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={busy}
                className="rounded-md px-5 py-2.5 text-sm font-medium disabled:opacity-60 transition-opacity"
                style={{ background: 'var(--ink)', color: 'var(--panel)' }}
              >
                {busy ? 'Saving…' : step === STEP_COUNT - 1 ? 'Get started' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
