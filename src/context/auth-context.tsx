'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { trackSignUp } from '@/lib/analytics'
import { mayGateOnboarding } from '@/lib/onboarding-gate'
/**
 * ⚠️ THE IDENTITY RULES LIVE IN A PURE MODULE — see auth-identity.ts for why (they shipped wrong
 * once, and testing them must not drag next/navigation and the Supabase browser client along).
 */
import { acceptedIdentity, identityIsCurrent, ownAccountType, ownStorefrontId, stampAccountType, type FetchedIdentity, type MeResponse } from './auth-identity'

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
  /**
   * The viewer's OWN storefront id, or null if they have none. Used to answer "is this listing
   * mine?" without ever putting a seller's owner id into a public card payload — the comparison is
   * `listing.sellerId === sellerId`, and both sides are already public facts about the listing.
   * ⚠️ Gate on `identityLoaded` like `accountType`: null means BOTH "no storefront" and "not asked
   * yet", and an owner-only control that flashes in on hydration is worse than one that waits.
   *
   * ⛔ NOT ITS OWN STATE — derived in render from a stamp carrying the user it was fetched for. The
   * rules, and the leak that forced them, are in auth-identity.ts; read it before changing how this
   * is produced.
   */
  sellerId: string | null
  /**
   * Has `/api/me` answered yet? EXPOSED BECAUSE `accountType === null` IS AMBIGUOUS: it means both
   * "this user has not onboarded" and "we have not asked yet", and those need opposite handling.
   *
   * ⚠️ Without this, /onboard showed its account-type chooser to an ALREADY-ONBOARDED user for the
   * window between Supabase resolving the session (`loading` false) and `/api/me` returning
   * (owner hit this 2026-07-27 with `accountType: 'business'` and a live storefront). `loading` is
   * the SESSION's flag and says nothing about the identity fetch, so a consumer gating on it alone
   * renders the card too early — and a click in that window POSTs a fresh account type over a real
   * one. Any consumer branching on `accountType` must gate on this too.
   *
   * ⚠️ SINCE 2026-08-15 IT ALSO CANNOT BE STALE-TRUE. It is derived, not stored: it means "we hold
   * an answer AND that answer is about the user signed in right now", evaluated in the same render.
   * The older wording — "has /api/me answered yet" — was true of a flag that could stay true across
   * an account switch, which is exactly how it once failed. See auth-identity.ts.
   */
  identityLoaded: boolean
  signOut: () => Promise<void>
  openSignIn: (ctx?: SignInContext) => void
  markOnboarded: (type: string) => void
}

/**
 * ⛔ THE ANONYMOUS-VISITOR GATE — DO NOT NARROW IT WITHOUT RE-READING @supabase/ssr's SOURCE.
 *
 * ⚠️ WHAT WAS MEASURED (production, 2026-08-23, headless chromium · mobile emulation · 4x CPU
 * throttle). The Supabase browser chunk was fetched on EVERY visit, anonymous ones included, at
 * t=0.85–1.12s: **66,265 B transferred, 54,766 B (83%) of it counted as unused** by PSI's "Reduce
 * unused JavaScript" audit — **51% of that entire 105 KiB audit**, the single largest item in it.
 * For a visitor with no session that whole download buys exactly one fact we can read from
 * `document.cookie` for free: there is no session.
 *
 * ⛔ THIS IS THE AUTHENTICATION BOUNDARY, so the gate is deliberately WIDER than "is there an
 * auth-token cookie". A false negative signs a real user out; a false positive costs 66 KB. The
 * rule is therefore: **boot unless we can prove both that there is nothing to find AND that this
 * document cannot mint a session behind our back.** Every clause below is one of those proofs, and
 * each was checked against the INSTALLED @supabase/ssr 0.12.4 and @supabase/supabase-js, not
 * recalled:
 *
 * 1. `sb-` COOKIE PREFIX, NOT `sb-<ref>-auth-token`. supabase-js derives the storage key as
 *    `` `sb-${baseUrl.hostname.split('.')[0]}-auth-token` `` (dist/index.cjs, the `defaultStorageKey`
 *    line), and `createStorageFromOptions(..., false)` in @supabase/ssr routes EVERY key auth-js
 *    writes — not just the session — through `document.cookie`. So a browser mid-sign-in holds
 *    `…-auth-token-code-verifier`, `…-auth-token-flows-code-verifier` and
 *    `…-auth-token-flow-<id>-code-verifier` (auth-js lib/helpers.js:303/305/340) and NO session
 *    cookie at all. A regex anchored on `-auth-token=` misses every one of those, which is exactly
 *    the PKCE-mid-flight false negative that would strand `/auth/escape`. Matching the `sb-` prefix
 *    at a cookie-name boundary covers the session cookie, its `.0`/`.1` chunks (chunker.js writes
 *    `` `${key}.${i}` ``), every verifier shape, a changed project ref, and the legacy
 *    auth-helpers `sb-access-token` / `sb-refresh-token` names.
 * 2. THE COOKIE IS READABLE FROM JS. `DEFAULT_COOKIE_OPTIONS` in @supabase/ssr is
 *    `{ path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400d }` (dist/main/utils/constants.js),
 *    and this repo passes NO `cookieOptions` from either client (src/lib/supabase/browser.ts,
 *    src/lib/supabase/server.ts) and has no middleware that rewrites them — so both the client-set
 *    and the server-set session cookie are `httpOnly:false` on `path=/`, visible on every route.
 * 3. NO SESSION LIVES ANYWHERE BUT COOKIES. `userStorage` is only wired up when the caller passes
 *    `cookies.encode === 'tokens-only'` (createBrowserClient.js); we pass no options, so
 *    localStorage holds no session for us to miss.
 * 4. AUTH MATERIAL IN THE URL. Implicit-flow fragments and PKCE/`token_hash` query params mean a
 *    session is about to exist even though the jar is still empty.
 * 5. NATIVE. The Capacitor WebView and the iOS `EnoNativeTabs` WKWebViews load https://eno.vn with
 *    a normal cookie jar, so (1) already covers them — but the bridge, the session mirror into
 *    native Preferences and the `enoAuth` post below all hang off `onAuthStateChange`, so native
 *    never takes the cheap path. `window.Capacitor` is guaranteed present here: layout.tsx's
 *    document-start inline script already reads it.
 * 6. AUTH ROUTES. `/signin` and `/auth/**` mount sign-in UI that creates the client THEMSELVES
 *    (sign-in-form.tsx:225, handoff-waiting.tsx:42) and then rely on THIS provider's
 *    `onAuthStateChange` to close the modal / redirect. `/auth/escape` is the one that cannot be
 *    left to the interaction backstop: it finishes a handoff from a POLL, with zero interaction
 *    possible in that document.
 *    ⚠️ CLAUSE 6 ONLY FIRES ON A FULL DOCUMENT LOAD, and that limit is structural, not a bug to
 *    patch here. This gate is read ONCE, from a `[]`-dep effect on a provider that lives in the
 *    root layout and never remounts, so a CLIENT-SIDE arrival at /signin — e.g. a guest deep-links
 *    to /dashboard/listings and its `!user` guard does `router.replace('/signin?next=…')` — never
 *    re-tests the pathname. The interaction backstop below is what covers it: reaching a sign-in
 *    form and not touching it is not a state anyone is in. Re-testing on every navigation would
 *    mean subscribing the root layout to `usePathname()`, re-rendering the whole tree on each
 *    route change — a real cost, paid on every visitor, to buy back a case the backstop already
 *    holds.
 *
 * ⚠️ AND THE INTERACTION TRIGGERS STAY ARMED EVEN WHEN THIS RETURNS FALSE — that is the backstop
 * that makes the gate safe to be wrong about. Nobody signs in without a pointerdown, keydown or
 * touchstart in the document, so any auth surface this list forgets still wakes the client the
 * moment it is touched. What the gate removes is only the *unconditional idle boot*, which is
 * precisely what the lab measurement above is charging us for.
 *
 * Exported for `auth-context.test.tsx`, which pins both directions shape by shape.
 */
export type AuthBootProbe = {
  cookie: string
  hash: string
  search: string
  pathname: string
  userAgent: string
  capacitorNative: boolean
}

/** A cookie NAME starting with `sb-`. The `(?:^|;\s*)` anchor is what keeps it a NAME match: a
 *  value cannot contain an unencoded `;`, so no cookie's value can fake the boundary. */
const SUPABASE_COOKIE_RE = /(?:^|;\s*)sb-/
/** `/signin`, `/auth`, and anything beneath them — never a look-alike like `/signin-help`. */
const AUTH_ROUTE_RE = /^\/(?:signin|auth)(?:\/|$)/
/** Implicit-flow fragment params. `hash` carries its leading `#`, hence the `[#&?]` class. */
const AUTH_HASH_RE = /(?:^|[#&?])(?:access_token|refresh_token|provider_token|error|error_description)=/

export function shouldBootAuth(p: AuthBootProbe): boolean {
  if (p.capacitorNative) return true
  if (/EnoNativeApp|EnoNativeTabs/.test(p.userAgent)) return true
  if (SUPABASE_COOKIE_RE.test(p.cookie)) return true
  if (AUTH_ROUTE_RE.test(p.pathname)) return true
  if (AUTH_HASH_RE.test(p.hash)) return true
  try {
    const q = new URLSearchParams(p.search)
    // `code` is the PKCE param auth-js reads; `token_hash` is the magic-link/OTP one. Neither is
    // used anywhere else in this app (grep 2026-08-23: only /auth/callback and /auth/google/callback
    // read `code`, both server routes), so there is no listing/discount `?code=` to collide with.
    if (q.has('code') || q.has('token_hash')) return true
  } catch { return true }
  return false
}

/**
 * Read the six signals off the live document. ⚠️ FAILS OPEN IN EVERY DIRECTION: a sandboxed or
 * partitioned context can throw on `document.cookie` or on the Capacitor global, and "we could not
 * look" must mean "boot", never "assume logged out".
 */
function probeAuthBoot(): AuthBootProbe {
  let capacitorNative = false
  try {
    capacitorNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.()
  } catch { capacitorNative = true }
  return {
    cookie: document.cookie,
    hash: window.location.hash,
    search: window.location.search,
    pathname: window.location.pathname,
    userAgent: navigator.userAgent || '',
    capacitorNative,
  }
}

const AuthContext = createContext<AuthCtx | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)
  const [signInCtx, setSignInCtx] = useState<SignInContext | null>(null)
  /**
   * ⛔ THE VIEWER'S STOREFRONT ID IS STORED WITH THE USER IT WAS FETCHED FOR — NEVER ON ITS OWN.
   * `sellerId` below is DERIVED from this during render, and that is the entire point.
   *
   * The first cut kept a bare `sellerId` state and cleared it in the identity effect. That is one
   * commit too late: when `user` flips to a different account, React renders the new `user` with
   * the OLD `sellerId` still in state and only then runs the effect. For the width of that frame
   * the previous account's ownership answer is live, so an Edit pencil could paint on a listing
   * belonging to the person who just signed out. `signOut()` happens to be safe (it clears both in
   * one batched handler), but a session change arriving through `onAuthStateChange` — a sign-out in
   * another tab, a session swap — does not go through it. Caught by external review (codex) after
   * the bare-state version had already shipped.
   *
   * ⚠️ Pairing the id with `userId` makes the stale frame unrepresentable rather than merely short:
   * the comparison happens in the SAME render that sees the new user, so a mismatch reads null
   * instead of reading someone else's answer. Do not "simplify" this back to a plain string.
   */
  const [identity, setIdentity] = useState<FetchedIdentity | null>(null)
  /**
   * ⚠️ BUMPED BY EVERY LOCAL WRITE TO THE STAMP, SO A SLOWER SERVER ANSWER CANNOT UNDO A NEWER ONE.
   * The case both external reviewers found: an onboarding-pending user picks their account type
   * while the identity fetch is still in flight; the response then lands carrying the PRE-choice
   * `accountType: null` and overwrites it, and the gate bounces them back to /onboard. `cancelled`
   * cannot help — nothing about the user changed, only the data did.
   */
  const localWrites = useRef(0)
  /**
   * ⚠️ DERIVED FROM THE SAME STAMP, NOT ITS OWN useState — so it cannot be stale-TRUE.
   * It used to be independent state cleared in the identity effect, which meant that on an account
   * switch the first render carried `identityLoaded=true` belonging to the PREVIOUS user. That is
   * the failure the flag exists to prevent, one identity removed: every consumer is told to gate on
   * it, so a confidently-true flag over another account's answer is worse than no flag. Deriving it
   * makes "we have an answer" and "the answer is about the current user" the same statement, in the
   * same render. Raised by all three reviewers on the sellerId fix; this is the general form.
   */
  /**
   * ⛔ ALL THREE DERIVED FROM THE ONE STAMP, IN RENDER — retain, clear and discard are a single
   * rule, so these can never disagree about whose answer they are holding. `accountType` was the
   * last value left as bare state; all three reviewers named it, because a stale account type under
   * a true `identityLoaded` is how /onboard shows its chooser to an already-onboarded account and a
   * click overwrites a real answer.
   */
  const identityLoaded = identityIsCurrent(identity, user?.id)
  const sellerId = ownStorefrontId(identity, user?.id)
  const accountType = ownAccountType(identity, user?.id)
  /**
   * The boot effect's `init`, published so anything that OPENS a sign-in surface can wake the
   * Supabase client on the spot. Needed because `shouldBootAuth` may have declined the idle boot:
   * without this, a modal opened by `eno:require-signin` (visual-search.ts fires it off a 401,
   * which need not follow a gesture in this document) would have no `onAuthStateChange` listener,
   * so a successful OTP would leave the dialog open and the user looking signed-out. Null before
   * mount and after unmount; `init` is idempotent, so extra calls are free.
   */
  const bootAuth = useRef<(() => void) | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    let started = false
    let unsub: (() => void) | undefined
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'scroll']

    // ⚠️ THE ONE PATH THE INTERACTION BACKSTOP DOES NOT COVER: A SIGN-IN IN ANOTHER TAB.
    // An idle anonymous tab now skips Supabase entirely, so it holds no `onAuthStateChange`
    // subscription and cannot hear that the user just signed in somewhere else — it would sit
    // visibly signed out until something happened to touch it. A reviewer caught this; the four
    // events above genuinely do not fire in a tab nobody returns to.
    //
    // Re-becoming VISIBLE is the moment that matters, because that is when a stale signed-out
    // header is actually looked at. It costs nothing on a cold load: the tab is already visible, so
    // this never fires during the first paint that the whole gate exists to protect — only on a
    // switch back, by which time the idle boot has long since happened anyway for anyone who stayed.
    const onVisible = () => { if (document.visibilityState === 'visible') init() }
    let idleId: number | undefined
    let timerId: ReturnType<typeof setTimeout> | undefined

    const cleanupTriggers = () => {
      events.forEach((e) => window.removeEventListener(e, init))
      document.removeEventListener('visibilitychange', onVisible)
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
            // Android sibling: WebMessageListener injects window.enoAuth ONLY on
            // https://eno.vn (origin-scoped by the platform — the allowlist lives
            // in the native addWebMessageListener call). String payloads only.
            const droid = (window as unknown as { enoAuth?: { postMessage: (s: string) => void } }).enoAuth
            if (droid && navigator.userAgent.includes('EnoNativeTabs')) {
              if (session) droid.postMessage(JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }))
              else if (event === 'SIGNED_OUT') droid.postMessage('signout')
            }
          } catch { /* web */ }
        })
        unsub = () => sub.subscription.unsubscribe()
      }).catch(fail)
    }

    /**
     * ⚠️ ARMED UNCONDITIONALLY, INCLUDING FOR THE VISITOR THE GATE BELOW SKIPS. These four events
     * are what makes the gate safe to be wrong about: every path that mints a session — the modal,
     * /signin, OAuth, the password route — needs at least one of them in this document first, so a
     * surface the gate does not know about still gets a client the instant it is touched.
     */
    events.forEach((e) => window.addEventListener(e, init, { once: true, passive: true }))
    // NOT `{ once: true }`: the first visibilitychange in a tab's life is usually the user leaving
    // (state 'hidden'), which onVisible correctly ignores — consuming the listener there would
    // spend it on the one transition that must not act.
    document.addEventListener('visibilitychange', onVisible)
    /** So `openSignIn()` and `eno:require-signin` can wake the client explicitly rather than
     *  trusting that the gesture which produced them happened in THIS document. */
    bootAuth.current = init

    /**
     * ⛔ THE IDLE BOOT IS NOW CONDITIONAL — see shouldBootAuth above for the six signals and the
     * 66,265 B / 83%-unused measurement that motivates it. An anonymous visitor resolves straight
     * to the logged-out default, which is not a guess: it is the same answer `getSession()` would
     * have returned a second later, since a session can only live in a cookie this code just read.
     */
    // ⚠️ ONE MORE FAIL-OPEN WRAPPER over probeAuthBoot's own: a throw anywhere in the probe must
    // land on "boot", because the alternative is silently telling a signed-in visitor they are not.
    let boot = true
    try { boot = shouldBootAuth(probeAuthBoot()) } catch { boot = true }
    if (boot) {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
      if (ric) idleId = ric(() => init(), { timeout: 2000 })
      else timerId = setTimeout(init, 1500)
    } else {
      setUser(null)
      setLoading(false)
    }

    return () => { cancelled = true; bootAuth.current = null; cleanupTriggers(); unsub?.() }
  }, [])

  // Any feature can request the sign-in modal by dispatching `eno:require-signin`
  // (e.g. a guest hitting a login-only AI endpoint) — keeps gating DRY without
  // threading openSignIn through every caller.
  useEffect(() => {
    const onReq = () => { bootAuth.current?.(); setSignInOpen(true) }
    window.addEventListener('eno:require-signin', onReq)
    return () => window.removeEventListener('eno:require-signin', onReq)
  }, [])

  // Load the app identity (account type) whenever the auth user changes, so the
  // onboarding gate below knows whether the one-time business/individual choice is
  // still pending. Separate from the Supabase boot so it also covers phone OTP,
  // which has no server callback to gate on.
  useEffect(() => {
    // Signed out: nothing is known about anyone. One clear drops accountType, sellerId and
    // identityLoaded together, because since 2026-08-15 all three ARE the stamp (auth-identity.ts).
    if (!user) { setIdentity(null); return }
    /**
     * ⚠️ DROP THE HELD ANSWER — UNLESS IT IS PROVABLY STILL ABOUT THIS USER.
     *
     * ⛔ THIS SUPERSEDES THE OLD "RESET BEFORE EVERY FETCH, NOT ONLY ON SIGN-OUT" RULE, AND THE
     * REASON THAT RULE EXISTED IS NOW HANDLED SOMEWHERE BETTER. It was added because this effect
     * re-runs on every `user` change — an account switch AND a plain token/metadata refresh, neither
     * passing through a falsy `user` — and without a reset `identityLoaded` stayed true while the
     * values underneath still described the PREVIOUS account. If that stale accountType was null and
     * the incoming user was already onboarded, /onboard rendered its chooser and a click overwrote a
     * real account type. A reset here could only ever narrow that window, never close it: an effect
     * runs AFTER the render that already had the new user.
     *
     * What closes it is the stamp being compared IN RENDER (see the derivations at the top of this
     * component). A mismatched answer is unreadable the instant `user` changes, with no effect
     * involved — so this line no longer has to be a blunt reset, and being blunt cost something
     * real: clearing on every token refresh flapped `identityLoaded` false→true and unmounted the
     * owner-only controls and the onboarding gate for the width of a fetch, to re-learn what we
     * already knew. Keep a same-user answer; drop anything else.
     */
    setIdentity((prev) => (prev && prev.userId === user.id ? prev : null))
    let cancelled = false
    const writesAtStart = localWrites.current
    fetch('/api/me')
      /**
       * ⚠️ `r.ok` FIRST — A NON-2xx BODY IS NOT AN ANSWER. Without this, a 401/500 JSON error body
       * parses fine, carries no `user`, and would be read as a statement about this viewer. Routing
       * it to the `.catch` below is what makes the documented fail-open contract actually hold: no
       * stamp, so `identityLoaded` stays false and every gate stands down, instead of a transient
       * API blip telling an onboarded user they have no account type. Raised independently by two
       * reviewers; the pre-existing code had the same gap.
       */
      .then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error(`/api/me ${r.status}`), { status: r.status }))))
      /**
       * ⛔ STAMPED WITH THE SUBJECT THE SERVER NAMED, NOT THE ONE WE ASKED FOR — AND DISCARDED
       * ENTIRELY ON A MISMATCH. `cancelled` only covers an unmount or a `user` change this tab has
       * already seen; it cannot cover the window where the SESSION changed but this tab's auth
       * event has not landed. The request carries whatever cookies exist when the server reads
       * them, so a sign-in in another tab mid-fetch answers about the NEW account while this page
       * still renders the old one — and the payload carries `sellerId`, so believing it would
       * attribute one person's storefront to another. Comparing `d.user.id` makes the stamp a
       * server assertion instead of our own guess.
       *
       * ⚠️ AND `{ user: null }` IS NOT AN ANSWER ABOUT ANYONE — IT MEANS THE SESSION IS GONE.
       * Checked rather than assumed: `getCurrentProfile()` LAZILY PROVISIONS a Profile row
       * (src/lib/admin.ts — `if (!existing) return ensureProfile(...)`), so an authenticated caller
       * always gets a payload back. A null body therefore only ever means unauthenticated — never
       * "signed in but not onboarded". That matters because the earlier cut of this accepted a null
       * body as a valid answer, which would let a sign-out in another tab mid-fetch stamp THIS
       * viewer as `identityLoaded=true, accountType=null` and hand them the /onboard chooser the
       * flag exists to keep away from an onboarded account. Onboarding is unaffected: it keys off
       * `accountType === null` on a FULL payload, which carries an id.
       */
      .then((d: MeResponse) => {
        if (cancelled) return
        const accepted = acceptedIdentity(d, user.id)
        /**
         * ⛔ A DISCARDED ANSWER CLEARS THE STAMP — IT DOES NOT LEAVE THE OLD ONE STANDING.
         * Reaching here with `accepted === null` means the server just told us this browser's
         * session is not the user this tab is rendering (a sign-out or a sign-in in another tab,
         * whose auth event has not arrived yet). Retaining the previous answer through that would
         * keep owner-only controls and the onboarding gate live on the strength of a session the
         * server has already contradicted. Clearing is fail-CLOSED: `identityLoaded` goes false,
         * every gate stands down, and the auth event sorts it out a moment later.
         */
        if (!accepted) {
          /**
           * ⚠️ SAY SO IN DEV. Discarding is correct, but its failure mode is silence: if this ever
           * fired for a legitimate answer — say `Profile.id` stopped matching the Supabase user id —
           * that viewer would simply never get an Edit control or an onboarding gate, with nothing
           * anywhere saying why. (Measured 2026-08-15: 0 of 20 Profile rows lack a matching
           * auth.users row, so the assumption holds today; this is the tripwire for the day it
           * does not.) Dev-only — a discarded answer is normal during a real account switch.
           *
           * ⚠️ AND THIS CLEARS EVEN OVER A NEWER LOCAL WRITE, DELIBERATELY — the `localWrites` guard
           * below covers accepted answers only. A reviewer read that as losing the user's onboarding
           * choice, and it can; it is still the right way round. `markOnboarded` mirrors a write that
           * ALREADY PERSISTED server-side, so a lost mirror is restored by the next successful fetch.
           * A retained ownership claim after the server has refused our session is not self-healing
           * in the safe direction. Recoverable beats plausible.
           */
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[auth] /api/me answer discarded — it did not name the signed-in user', { askedFor: user.id })
          }
          setIdentity(null)
          return
        }
        // A local write landed while this was in flight → it is the newer truth about accountType.
        // Everything else in the response is still the freshest we have, so only that field is kept.
        setIdentity((prev) => (localWrites.current !== writesAtStart && prev && prev.userId === user.id
          ? { ...accepted, accountType: prev.accountType }
          : accepted))
      })
      // Fail OPEN: on a transient /api/me failure leave identityLoaded=false so
      // the onboarding gate stays inert — never trap a real user in /onboard
      // because identity couldn't be read.
      /**
       * ⛔ A FAILED REQUEST IS NOT A STATEMENT ABOUT WHO THE VIEWER IS — SO IT DOES NOT CLEAR.
       *
       * ⚠️ TWO REVIEWERS PULLED IN OPPOSITE DIRECTIONS HERE AND THE SPLIT IS WHO SPOKE. One argued
       * that retaining an answer through a failure leaves ownership state live on a session the
       * server may have revoked; the other, that clearing on a transient blip yanks the Edit
       * controls out from under a perfectly valid session with nothing scheduled to put them back —
       * and nothing retries, so `identityLoaded` would sit false until the next `user` change. Both
       * are right about their own case, and the distinction that separates them is whether the
       * SERVER answered: a 5xx or a dropped connection means we could not ASK, so the last answer we
       * have is still the best one we have. A 200 that names a different subject — handled above —
       * IS the server contradicting us, and that one clears.
       *
       * ⚠️ Note /api/me never 401s: a guest gets 200 `{ user: null }`, which the accept rule already
       * treats as "session gone" and clears on. So the revoked-session case lands in the branch
       * above, not here, and this branch really is only "the network let us down".
       */
      .catch((e: { status?: number }) => {
        if (cancelled) return
        /**
         * ⛔ 401/403 IS THE SERVER REFUSING THIS SESSION — CLEAR. Everything else means we could not
         * ASK, so the last answer we have is still the best one we have and we keep it.
         *
         * ⚠️ The route itself answers 200 `{ user: null }` for a guest and never 401s — but the
         * route is not the only thing that can reply. Cloudflare, the load balancer or a WAF rule
         * sits in front of it and can, and treating one of those as "just a blip" would keep owner
         * controls alive on a session that has already been refused. Two reviewers made this exact
         * point; the earlier version of this branch asserted the 401 could not happen, which was
         * true of the handler and not of the path in front of it.
         */
        if (e?.status === 401 || e?.status === 403) setIdentity(null)
      })
    return () => { cancelled = true }
  }, [user])

  // One-time onboarding gate: a signed-in user who hasn't picked individual vs
  // business is sent to /onboard (covers every sign-in method). We wait for the
  // identity fetch so we never bounce on a not-yet-loaded null, and we never
  // intercept the onboarding or auth-callback routes themselves.
  useEffect(() => {
    if (!user || !identityLoaded || accountType) return
    // ⚠️ THE EXEMPTION LIST LIVES IN src/lib/onboarding-gate.ts, WITH ITS REASONS AND ITS TESTS.
    // It is not inlined here because each entry is a defect that already happened — /signin
    // double-redirecting, and /post silently deleting people's first listing by unmounting the
    // draft-first wizard (and its in-memory photos) the instant in-dialog sign-in landed.
    // onboarding-gate.test.ts pins all of them, including that /post's exemption stays EXACT
    // and never widens to a look-alike route.
    if (!mayGateOnboarding(pathname)) return
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
    setIdentity(null)
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

  /**
   * The user just chose their account type. Writes it into the stamp, ALWAYS for the user signed in
   * now — patching a held answer when it is theirs, minting one when it is not or when none exists.
   *
   * ⛔ AN EARLIER COMMENT HERE SAID THE OPPOSITE — that minting would be "asserting an answer we
   * never received", so a null `prev` should do nothing. That is wrong, and it is wrong in the
   * expensive direction: this is not a guess about the server's answer, it is a local mirror of a
   * write the user JUST MADE and that already persisted. Dropping it strands them in the /onboard
   * loop the gate exists to end. The rule and both failure directions live in
   * `stampAccountType` (auth-identity.ts), which is where the tests are.
   */
  /**
   * ⚠️ MINTS A STAMP IF THERE ISN'T ONE. Patching `prev` alone silently DROPPED the user's choice
   * whenever the identity fetch was still in flight or had failed — and the dropped write is the
   * one that tells the onboarding gate to stop redirecting, so the user bounces back to /onboard
   * forever. Reviewer-caught. `sellerId: null` is honest here: onboarding precedes any storefront,
   * and the next /api/me overwrites it either way.
   */
  const markOnboarded = useCallback((type: string) => {
    if (!user) return
    localWrites.current += 1
    setIdentity((prev) => stampAccountType(prev, user.id, type))
  }, [user])
  // ⚠️ BOOTS THE CLIENT AS IT OPENS. The dialog's own `getSupabase()` creates the singleton, but
  // only THIS provider holds the onAuthStateChange listener that closes the modal and redirects
  // after a verifyOtp (sign-in-form.tsx says so in both OTP handlers) — so the listener has to
  // exist before the code is typed, not after.
  const openSignIn = useCallback((ctx?: SignInContext | null) => { bootAuth.current?.(); setSignInCtx(ctx ?? null); setSignInOpen(true) }, [])
  // Memoized: opening/closing the sign-in dialog is signInOpen state on THIS
  // provider — without useMemo every useAuth consumer re-rendered on each toggle.
  const value = useMemo(() => ({ user, loading, accountType, sellerId, identityLoaded, signOut, openSignIn, markOnboarded }), [user, loading, accountType, sellerId, identityLoaded, signOut, openSignIn, markOnboarded])

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
