import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Set once by a synchronous script in index.html, before Supabase's client
// has a chance to auto-consume and clear the invite URL's hash fragment.
// Distinguishes "just clicked an invite email" from an ordinary visit.
const isInviteFlow = typeof window !== 'undefined' && sessionStorage.getItem('pipeline_auth_type') === 'invite'

export default function AuthPage() {
  const { user, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Normal case: already logged in, not mid-invite -> go straight into the app.
  if (user && !isInviteFlow) return <Navigate to="/" replace />

  // Invite case: Supabase's own client auto-establishes a session from the
  // email link's token (that's what detectSessionInUrl is for), but Supabase
  // deliberately doesn't include a "set your password" step of its own —
  // that part is left to whoever builds on top of it. This is that step.
  if (isInviteFlow) {
    const handleSetPassword = async (e) => {
      e.preventDefault()
      setError('')
      if (newPassword.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }

      setSubmitting(true)
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      setSubmitting(false)

      if (updateError) {
        setError(updateError.message)
        return
      }

      sessionStorage.removeItem('pipeline_auth_type')
      navigate('/')
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
        <div className="w-full max-w-sm">
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
            <h1 className="font-display font-bold text-xl mb-1">Welcome to the team</h1>
            <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
              Set a password to finish joining.
            </p>

            {!user ? (
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Setting up your account…</p>
            ) : (
              <form onSubmit={handleSetPassword} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium mb-1">New password</label>
                  <input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--border)' }}
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1">Confirm password</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--border)' }}
                    autoComplete="new-password"
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md py-2.5 text-sm font-medium disabled:opacity-60 transition-opacity"
                  style={{ background: 'var(--ink)', color: 'var(--panel)' }}
                >
                  {submitting ? 'Saving…' : 'Set password and continue'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')

    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await signUp({ email, password, fullName })
        if (signUpError) {
          setError(signUpError.message)
        } else {
          setInfo('Account created. Check your email to confirm, then log in.')
          setMode('login')
        }
      } else {
        const { error: signInError } = await signIn({ email, password })
        if (signInError) {
          setError(signInError.message)
        } else {
          navigate('/')
        }
      }
    } catch (err) {
      console.error('Auth submit failed:', err)
      setError('Something went wrong. Try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
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

        <div
          className="rounded-lg border p-6 sm:p-8"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <h1 className="font-display font-bold text-xl mb-1">
            {mode === 'login' ? 'Log in' : 'Create your workspace'}
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
            {mode === 'login' ? 'Welcome back.' : 'Your own project workspace, ready in seconds.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'signup' && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium mb-1">Full name</label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>

            {error && (
              <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-done-soft)', color: 'var(--tally-done)' }} role="status">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md py-2.5 text-sm font-medium disabled:opacity-60 transition-opacity"
              style={{ background: 'var(--ink)', color: 'var(--panel)' }}
            >
              {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>

          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setInfo('') }}
            className="w-full text-center text-sm mt-5"
            style={{ color: 'var(--ink-muted)' }}
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  )
}
