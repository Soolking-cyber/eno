'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
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

/** Optional listing context for the sign-in dialog: when a gated action names
 *  WHAT signing in unlocks ("message James about X"), conversion beats a generic
 *  prompt. Callers without context just call openSignIn(). */
export type SignInContext = {
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
}

type AuthCtx = {
  user: User | null
  loading: boolean
  accountType: string | null
  signOut: () => Promise<void>
  openSignIn: (ctx?: SignInContext) => void
  markOnboarded: (type: string) => void
}

const AuthContext = createContext<AuthCtx | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)
  const [signInCtx, setSignInCtx] = useState<SignInContext | null>(null)
  const [accountType, setAccountType] = useState<string | null>(null)
  const [identityLoaded, setIdentityLoaded] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

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
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
          setUser(session?.user ?? null)
          if (session?.user) { setSignInOpen(false); maybeTrackSignUp(session.user) }
          // Native-shell Phase 2 · M2: mirror the session into native Preferences so
          // LOCAL shell pages (different origin — no cookie access) can restore it via
          // setSession and call the APIs with a Bearer token. Fire-and-forget; cleared
          // on sign-out. NOTE: Preferences = UserDefaults (app-sandboxed, unencrypted);
          // upgrade path if ever needed = a Keychain/secure-storage plugin.
          try {
            if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
              void import('@capacitor/preferences').then(({ Preferences }) =>
                session
                  ? Preferences.set({ key: 'eno-session', value: JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }) })
                  : Preferences.remove({ key: 'eno-session' }),
              ).catch(() => {})
            }
          } catch { /* web */ }
          try {
            // Native iOS app's embedded tabs (WKWebView, UA EnoNativeTabs): hand
            // the session to the shell's enoAuth bridge so Keychain-backed native
            // surfaces sign in from this same flow. Sessions only — a guest tab
            // must never clobber an existing native session, so null is NOT
            // posted; explicit sign-out posts the "signout" sentinel instead.
            const wk = (window as unknown as { webkit?: { messageHandlers?: { enoAuth?: { postMessage: (m: unknown) => void } } } }).webkit
            const bridge = wk?.messageHandlers?.enoAuth
            if (bridge && navigator.userAgent.includes('EnoNativeTabs')) {
              if (session) bridge.postMessage({ access_token: session.access_token, refresh_token: session.refresh_token })
              else if (event === 'SIGNED_OUT') bridge.postMessage('signout')
            }
          } catch { /* web */ }
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

  // Any feature can request the sign-in modal by dispatching `eno:require-signin`
  // (e.g. a guest hitting a login-only AI endpoint) — keeps gating DRY without
  // threading openSignIn through every caller.
  useEffect(() => {
    const onReq = () => setSignInOpen(true)
    window.addEventListener('eno:require-signin', onReq)
    return () => window.removeEventListener('eno:require-signin', onReq)
  }, [])

  // Load the app identity (account type) whenever the auth user changes, so the
  // onboarding gate below knows whether the one-time business/individual choice is
  // still pending. Separate from the Supabase boot so it also covers phone OTP,
  // which has no server callback to gate on.
  useEffect(() => {
    if (!user) { setAccountType(null); setIdentityLoaded(false); return }
    let cancelled = false
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setAccountType(d.user?.accountType ?? null); setIdentityLoaded(true) } })
      // Fail OPEN: on a transient /api/me failure leave identityLoaded=false so
      // the onboarding gate stays inert — never trap a real user in /onboard
      // because identity couldn't be read.
      .catch(() => { /* keep identityLoaded=false */ })
    return () => { cancelled = true }
  }, [user])

  // One-time onboarding gate: a signed-in user who hasn't picked individual vs
  // business is sent to /onboard (covers every sign-in method). We wait for the
  // identity fetch so we never bounce on a not-yet-loaded null, and we never
  // intercept the onboarding or auth-callback routes themselves.
  useEffect(() => {
    if (!user || !identityLoaded || accountType) return
    // Skip /signin too — it owns its own post-auth redirect; gating it would double
    // -redirect and capture next=/signin, dropping the user's original intent.
    if (!pathname || pathname.startsWith('/onboard') || pathname.startsWith('/auth') || pathname.startsWith('/signin')) return
    // Preserve the query string so the page we bounce from is restored intact.
    const here = pathname + (typeof window !== 'undefined' ? window.location.search : '')
    router.replace(`/onboard?next=${encodeURIComponent(here)}`)
  }, [user, identityLoaded, accountType, pathname, router])

  const signOut = useCallback(async () => {
    // Tear down Web Push FIRST so a shared device never keeps delivering the
    // previous user's reminders to the next person who signs in here.
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager.getSubscription()
        if (sub) {
          await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
          await sub.unsubscribe().catch(() => {})
        }
      }
    } catch { /* push not supported / no reg — nothing to tear down */ }

    const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
    await createSupabaseBrowser().auth.signOut()
    setUser(null)
    setAccountType(null)
    setIdentityLoaded(false)
    // Clear the per-user functional caches (inbox, threads, saved) so the next
    // account on this device starts clean.
    try {
      localStorage.removeItem('eno-convos')
      localStorage.removeItem('eno-saved-cache')
      localStorage.removeItem('eno-account')
      localStorage.removeItem('eno-dashboard')
      localStorage.removeItem('eno-notifs')
      Object.keys(localStorage).filter((k) => k.startsWith('eno-thr:')).forEach((k) => localStorage.removeItem(k))
    } catch {}
  }, [])

  const markOnboarded = useCallback((type: string) => setAccountType(type), [])
  const openSignIn = useCallback((ctx?: SignInContext | null) => { setSignInCtx(ctx ?? null); setSignInOpen(true) }, [])
  // Memoized: opening/closing the sign-in dialog is signInOpen state on THIS
  // provider — without useMemo every useAuth consumer re-rendered on each toggle.
  const value = useMemo(() => ({ user, loading, accountType, signOut, openSignIn, markOnboarded }), [user, loading, accountType, signOut, openSignIn, markOnboarded])

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* Mounted only once opened, so its chunk loads on demand. */}
      {signInOpen && (
        <SignInDialog
          open={signInOpen}
          onOpenChange={(o) => { setSignInOpen(o); if (!o) setSignInCtx(null) }}
          listingTitle={signInCtx?.listingTitle}
          listingImage={signInCtx?.listingImage}
          sellerName={signInCtx?.sellerName}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
