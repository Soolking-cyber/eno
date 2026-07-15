'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { SignInDialog } from '@/components/auth/sign-in-dialog'

type AuthContextValue = {
  user: User | null
  loading: boolean
  openSignIn: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)

  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    try {
      const supabase = createSupabaseBrowser()
      supabase.auth.getSession().then(({ data }) => {
        if (active) {
          setUser(data.session?.user || null)
          setLoading(false)
        }
      }).catch(() => { if (active) setLoading(false) })
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null)
        setLoading(false)
        if (session?.user) setSignInOpen(false)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    } catch {
      setLoading(false)
    }
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    const open = () => setSignInOpen(true)
    window.addEventListener('eno-forum:require-signin', open)
    return () => window.removeEventListener('eno-forum:require-signin', open)
  }, [])

  const signOut = useCallback(async () => {
    await createSupabaseBrowser().auth.signOut()
    setUser(null)
  }, [])
  const openSignIn = useCallback(() => setSignInOpen(true), [])
  const value = useMemo(() => ({ user, loading, openSignIn, signOut }), [user, loading, openSignIn, signOut])

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

