'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { User } from '@supabase/supabase-js'
import { trackSignUp } from '@/lib/analytics'

// Fire the sign_up / CompleteRegistration conversion exactly once for a genuinely
// NEW account. Supabase's auth events don't flag new-vs-returning, so we treat a
// session whose user was created in the last 5 min as a fresh registration (a
// returning sign-in carries a much older created_at). A per-user localStorage key
// guarantees we never double-count across reloads or token refreshes — this single
// hook covers every method (OAuth, magic-link, phone OTP) since they all land here.
function maybeTrackSignUp(u: User): void {
  try {
    const key = `eno-signup-fired:${u.id}`
    if (localStorage.getItem(key)) return
    const createdAt = u.created_at ? new Date(u.created_at).getTime() : 0
    if (!createdAt || Date.now() - createdAt > 5 * 60_000) return
    localStorage.setItem(key, '1')
    trackSignUp((u.app_metadata?.provider as string) || 'email')
  } catch { /* storage blocked / no analytics — ignore */ }
}

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
    let started = false
    let unsub: (() => void) | undefined
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    let idleId: number | undefined
    let timerId: ReturnType<typeof setTimeout> | undefined

    const cleanupTriggers = () => {
      events.forEach((e) => window.removeEventListener(e, init))
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      if (idleId != null && cic) cic(idleId)
      if (timerId) clearTimeout(timerId)
    }

    // Boot Supabase (chunk fetch + GoTrue getSession/onAuthStateChange) only once
    // the main thread is idle OR the user first interacts — whichever comes first.
    // Keeps ~62 KiB + GoTrue init off the post-hydration critical path (TBT/bootup).
    function init() {
      if (started || cancelled) return
      started = true
      cleanupTriggers()
      // Any failure (chunk-load on a flaky link, getSession reject) must resolve
      // to the safe logged-out default — never leave loading=true forever.
      const fail = () => { if (!cancelled) { setUser(null); setLoading(false) } }
      import('@/lib/supabase/browser').then(({ createSupabaseBrowser }) => {
        if (cancelled) return
        const supabase = createSupabaseBrowser()
        supabase.auth.getSession().then(({ data }) => {
          if (cancelled) return
          setUser(data.session?.user ?? null)
          setLoading(false)
        }).catch(fail)
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ?? null)
          if (session?.user) { setSignInOpen(false); maybeTrackSignUp(session.user) }
        })
        unsub = () => sub.subscription.unsubscribe()
      }).catch(fail)
    }

    events.forEach((e) => window.addEventListener(e, init, { once: true, passive: true }))
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (ric) idleId = ric(() => init(), { timeout: 2000 })
    else timerId = setTimeout(init, 1500)

    return () => { cancelled = true; cleanupTriggers(); unsub?.() }
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
      localStorage.removeItem('eno-account')
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
