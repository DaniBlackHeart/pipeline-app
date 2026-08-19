import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [orgs, setOrgs] = useState([])
  const [activeOrgId, setActiveOrgId] = useState(null)
  const [mfaLevel, setMfaLevel] = useState(null) // { current, next } | null
  const [profile, setProfile] = useState(null) // { id, full_name, nickname, email } | null

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, nickname, email')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('Failed to load profile:', error.message)
      return
    }
    setProfile(data)
  }, [])

  const loadOrgs = useCallback(async (userId) => {
    if (!userId) {
      setOrgs([])
      setActiveOrgId(null)
      return
    }
    const { data, error } = await supabase
      .from('org_members')
      .select('role, organizations ( id, name, slug )')
      .eq('user_id', userId)

    if (error) {
      console.error('Failed to load organizations:', error.message)
      return
    }

    const list = (data || [])
      .filter((row) => row.organizations)
      .map((row) => ({ ...row.organizations, role: row.role }))

    setOrgs(list)
    setActiveOrgId((current) => current || list[0]?.id || null)
  }, [])

  // A session existing doesn't mean fully authenticated if this person has
  // MFA enrolled — `signInWithPassword` (and every other sign-in method)
  // succeeds and issues a real session either way, at aal1. Supabase's own
  // model puts the responsibility on the app to check whether a step-up
  // to aal2 is still outstanding and gate on that, rather than sign-in
  // itself failing/blocking. This refreshes on every auth event so it
  // stays correct through login, MFA verification, and enroll/unenroll.
  const refreshMfaLevel = useCallback(async (hasSession) => {
    if (!hasSession) {
      setMfaLevel(null)
      return
    }
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error) {
      setMfaLevel(null)
      return
    }
    setMfaLevel({ current: data.currentLevel, next: data.nextLevel })
  }, [])

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      loadOrgs(data.session?.user?.id)
      loadProfile(data.session?.user?.id)
      refreshMfaLevel(Boolean(data.session))
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      loadOrgs(newSession?.user?.id)
      loadProfile(newSession?.user?.id)
      refreshMfaLevel(Boolean(newSession))
    })

    return () => {
      isMounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [loadOrgs, loadProfile, refreshMfaLevel])

  const signUp = async ({ email, password, fullName }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    return { data, error }
  }

  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    refreshProfile: () => loadProfile(session?.user?.id),
    loading,
    orgs,
    activeOrgId,
    activeOrg: orgs.find((o) => o.id === activeOrgId) ?? null,
    setActiveOrgId,
    signUp,
    signIn,
    signOut,
    refreshOrgs: () => loadOrgs(session?.user?.id),
    // True right after a password (or any) sign-in on an account that has
    // MFA enrolled, until the second factor is verified. AuthPage checks
    // this before redirecting into the app.
    needsMfaChallenge: Boolean(mfaLevel && mfaLevel.next === 'aal2' && mfaLevel.current !== 'aal2'),
    refreshMfaLevel: () => refreshMfaLevel(Boolean(session)),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
