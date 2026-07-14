import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [orgs, setOrgs] = useState([])
  const [activeOrgId, setActiveOrgId] = useState(null)

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

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      loadOrgs(data.session?.user?.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      loadOrgs(newSession?.user?.id)
    })

    return () => {
      isMounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [loadOrgs])

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
    loading,
    orgs,
    activeOrgId,
    activeOrg: orgs.find((o) => o.id === activeOrgId) ?? null,
    setActiveOrgId,
    signUp,
    signIn,
    signOut,
    refreshOrgs: () => loadOrgs(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
