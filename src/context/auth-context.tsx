'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { User } from '@supabase/supabase-js'

// The Supabase client + sign-in UI are the heaviest JS on the anonymous home
// page yet a logged-out visitor needs neither up front. Load the client lazily
// after mount (keeps it out of the initial bundle / off the hydration path) and
// the sign-in dialog only when it's actually opened.
const SignInDialog = dynamic(
  () => import('@/components/marketplace/sign-in-dialog').then((m) => m.SignInDialog),
  { ssr: false },
)

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
    let cancelled = false
    let unsub: (() => void) | undefined
    // Lazy-load the Supabase client so its chunk isn't in the initial bundle.
    import('@/lib/supabase/browser').then(({ createSupabaseBrowser }) => {
      if (cancelled) return
      const supabase = createSupabaseBrowser()
      supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return
        setUser(data.session?.user ?? null)
        setLoading(false)
      })
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) setSignInOpen(false)
      })
      unsub = () => sub.subscription.unsubscribe()
    })
    return () => { cancelled = true; unsub?.() }
  }, [])

  const signOut = async () => {
    const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
    await createSupabaseBrowser().auth.signOut()
    setUser(null)
    // Clear the per-user functional caches (inbox, threads, saved) so the next
    // account on this device starts clean.
    try {
      localStorage.removeItem('eno-convos')
      localStorage.removeItem('eno-saved-cache')
      Object.keys(localStorage).filter((k) => k.startsWith('eno-thr:')).forEach((k) => localStorage.removeItem(k))
    } catch {}
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut, openSignIn: () => setSignInOpen(true) }}>
      {children}
      {/* Mounted only once opened, so its chunk loads on demand. */}
      {signInOpen && <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
