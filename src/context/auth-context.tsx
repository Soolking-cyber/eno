'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { SignInDialog } from '@/components/marketplace/sign-in-dialog'

type AuthCtx = {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
  openSignIn: () => void
}

const AuthContext = createContext<AuthCtx | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) setSignInOpen(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await createSupabaseBrowser().auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut, openSignIn: () => setSignInOpen(true) }}>
      {children}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
