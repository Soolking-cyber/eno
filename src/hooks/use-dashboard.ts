'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/context/auth-context'
import type { SerializedListing } from '@/lib/types'

/** The dashboard payload from GET /api/dashboard. Shared by the right-side nav rail
 *  (account-panel) and every /dashboard/* section page so they read ONE source. */
export type Dash = {
  tier: 'business' | 'individual'
  profile: {
    displayName: string | null
    email: string | null
    phone: string | null
    avatarUrl: string | null
    avatarColor: string
    businessName: string | null
    trustScore: number
    /** Consecutive availability-review skips (daily review flow). Optional: legacy
     *  cached payloads may lack it. */
    availabilitySkips?: number
  }
  seller: {
    id: string
    name: string
    handle: string | null
    responseRate: number
    /** Legacy cached payloads may lack it — treat absent as NOT a partner. */
    officialPartner?: boolean
    bio: string | null
    location: string | null
    phone: string | null
    avatarUrl: string | null
    /** The shop's storefront cover. Optional for the same reason `officialPartner` is: a payload
     *  cached before this field existed simply lacks it, and absent must read as "no banner". */
    bannerUrl?: string | null
    legalName?: string | null
    legalAddress?: string | null
    idNumber?: string | null
    taxCode?: string | null
  } | null
  stats: { unreadMessages: number; staleCount: number; totalViews: number; totalLeads: number; activeCount?: number; saves?: number }
  listings: SerializedListing[]
  /** Server-computed (ADMIN_EMAILS) role flag for the nav rail's admin group. Display-only —
   *  every admin surface still enforces getAdmin() server-side. Legacy cached payloads may
   *  lack the field; load() defaults it to false until revalidate overwrites. */
  isAdmin: boolean
  /** Viewer holds at least one e-Visa case → the "My e-Visa" rail row shows. */
  hasVisa: boolean
  /** Viewer has a teacher profile → the "Teacher profile" row shows. Legacy cached payloads lack it (false). */
  hasTeacher?: boolean
}

const CACHE_KEY = 'eno-dashboard'

// ── ONE shared store for the whole app ────────────────────────────────────────────────
// The rail and the section pages BOTH read the dashboard, so a per-hook useState would
// double-fetch and — worse — an edit on a page would refresh only that page's copy while the
// rail's stats went stale. This module-level store gives every consumer the same object, one
// fetch, and one refresh(). Keyed by userId so a fast account switch can't leak the previous
// account's data (a late response for an old uid is dropped).
/**
 * Why the LAST fetch failed, if it did (inbox-10). Before this the store only knew `loading`, so a
 * failed fetch with no cache left every section on its skeleton forever — "never stuck" is the fix:
 *   · 'auth'   — the server answered 401: the browser still holds a session the server no longer
 *                accepts. The cached dashboard is DROPPED (memory + device cache — privacy on a shared
 *                device) and the page offers only Sign in, which clears that stale session.
 *   · 'failed' — anything else (5xx/503, offline, a body that is not the payload). The page offers Retry,
 *                over the cached copy when there is one.
 * Cleared by a successful fetch, by a forced refresh starting, and on an account switch.
 */
export type DashError = 'auth' | 'failed' | null
/** `fresh`: `dash` came from a fetch that SUCCEEDED in this session (not only the device cache). */
type State = { userId: string | null; dash: Dash | null; loading: boolean; error: DashError; fresh: boolean }
// ⚠️ `state` STARTS as the exact same reference as SERVER_SNAPSHOT (below). During hydration
// useSyncExternalStore renders once from getServerSnapshot, then reads getSnapshot; if those
// returned equal-but-DIFFERENT objects React would force an extra re-render (and risk tearing).
// Sharing the reference makes the first client snapshot identical to the server's.
const SERVER_SNAPSHOT: State = { userId: null, dash: null, loading: true, error: null, fresh: false }
let state: State = SERVER_SNAPSHOT
const subscribers = new Set<() => void>()
const emit = () => subscribers.forEach((fn) => fn())
const set = (next: Partial<State>) => { state = { ...state, ...next }; emit() }
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn) } }
const getSnapshot = () => state
// Reference-stable (a fresh object per call makes useSyncExternalStore warn/loop) AND the same
// object `state` starts from, so the hydration snapshot matches the server's by reference.
const getServerSnapshot = () => SERVER_SNAPSHOT

let inflight = 0            // monotonic ticket: only the newest response is applied
let inflightUid: string | null = null   // dedupes concurrent loads of the SAME uid (rail + page)
/** The 401 marker: the server refused this browser's session. */
const UNAUTHORIZED = { unauthorized: true as const }
const fetchDashboard = (): Promise<{ dashboard?: Dash } | typeof UNAUTHORIZED | null> =>
  fetch('/api/dashboard').then(async (r) => (r.status === 401 ? UNAUTHORIZED : r.ok ? r.json() : null))

/**
 * ⚠️ ONE SESSION REFRESH BEFORE "EXPIRED". An access token that merely EXPIRED while the app sat in the
 * background comes back 401 (the server reads it as bad_jwt) — on the native shell's bearer path the server
 * cannot refresh it, though the session behind it is fine. Showing "session expired" there would sign a
 * perfectly good session out. So a 401 first asks the browser client to refresh ONCE; only a refresh that
 * fails, or a retry that is still 401, is 'auth'. Never a loop: one refresh, one retry, per revalidate.
 */
async function refreshSessionOnce(): Promise<'ok' | 'invalid' | 'unavailable'> {
  try {
    const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
    const { data, error } = await createSupabaseBrowser().auth.refreshSession()
    if (!error && data.session) return 'ok'
    // ⚠️ A NETWORK FAILURE IS NOT A VERDICT ABOUT THE SESSION (commit-gate review 2026-10-04): a phone back on a
    // flaky connection must get the Retry state, not "session expired". auth-js raises AuthRetryableFetchError
    // (status 0) for those; a 5xx is the auth server, not the session.
    const status = (error as { status?: number; name?: string } | null)?.status
    if (error && ((error as { name?: string }).name === 'AuthRetryableFetchError' || !status || status >= 500)) return 'unavailable'
    return 'invalid'
  } catch {
    return 'unavailable'
  }
}
/** The refresh could not reach the auth server — answered as 'failed' (Retry), never 'auth'. */
const REFRESH_UNAVAILABLE = { refreshUnavailable: true as const }

function revalidate(uid: string, force = false) {
  if (!force && inflightUid === uid) return   // a fetch for this uid is already running
  inflightUid = uid
  const ticket = ++inflight
  // A forced refresh is the Retry button (and every post-mutation re-pull): drop the old verdict so the
  // page shows it is trying again instead of repeating the failure it just reported.
  // ⛔ AND RE-ENTER LOADING WHEN THERE IS NO DATA. Clearing the error alone left `{ dash: null, loading: false,
  // error: null }` for the length of the retry — which reads as "loaded, and empty": the availability
  // review took that as nothing to review, marked today's review done and left.
  if (force && state.error) set({ error: null, loading: state.dash === null })
  fetchDashboard()
    // A 401: one session refresh, then one retry (see refreshSessionOnce) — unless a newer request or another
    // account has taken over meanwhile, whose own fetch decides.
    .then(async (d) => {
      if (d !== UNAUTHORIZED) return d
      const r = await refreshSessionOnce()
      if (r === 'ok' && ticket === inflight && state.userId === uid) return fetchDashboard()
      return r === 'unavailable' ? REFRESH_UNAVAILABLE : d
    })
    .then((d) => {
      // Drop if a newer request started or the active user changed meanwhile.
      if (ticket !== inflight || state.userId !== uid) return
      if (d && 'dashboard' in d && d.dashboard) {
        set({ dash: d.dashboard, loading: false, error: null, fresh: true })
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: uid, dashboard: d.dashboard })) } catch { /* private mode */ }
      } else if (d === UNAUTHORIZED) {
        // ⛔ A 401 = THE SESSION THIS CACHE BELONGS TO IS GONE (the server answers 401 only for "no session" —
        // an auth-server blip is a 503). Never keep painting that account's listings and stats: on a shared
        // device the next person would read them. The in-memory copy and the device cache go together.
        set({ dash: null, loading: false, error: 'auth', fresh: false })
        try { localStorage.removeItem(CACHE_KEY) } catch { /* private mode */ }
      } else {
        set({ loading: false, error: 'failed' })
      }
    })
    .catch(() => { if (ticket === inflight && state.userId === uid) set({ loading: false, error: 'failed' }) })
    // Only the LATEST request may clear the in-flight marker. A forced refresh can overlap an
    // older same-uid fetch; if the older one's finally cleared the marker, a third load could
    // start concurrently. Gating on `ticket === inflight` means only the newest resolves it.
    .finally(() => { if (ticket === inflight && inflightUid === uid) inflightUid = null })
}

/** Point the store at a user, painting from cache first. Idempotent per uid — a second
 *  consumer mounting for the same uid reuses the in-flight fetch instead of firing another. */
function load(uid: string) {
  if (state.userId !== uid) {
    let cached: Dash | null = null
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      // isAdmin default-first: caches written before the field existed lack it — paint
      // false (a brief non-admin flash for admins) and let revalidate() correct it.
      // isAdmin is FORCED false from cache: a revoked admin must never see the Admin
      // rail group replayed from localStorage (offline, or before revalidate lands).
      // Real admins get it back one fetch later — the safe direction to flash.
      if (c?.userId === uid && c.dashboard) cached = { ...c.dashboard, isAdmin: false, hasVisa: c.dashboard.hasVisa ?? false, hasTeacher: c.dashboard.hasTeacher ?? false }
    } catch { /* corrupt cache — ignore */ }
    set({ userId: uid, dash: cached, loading: !cached, error: null, fresh: false })
  }
  revalidate(uid) // deduped: no-op if a fetch for this uid is already running
}

/** Cache-first dashboard data, shared across the app. `dash` is null until loaded; `loading`
 *  is true only on a first load with no cache; `refresh()` re-pulls after a mutation; `error` says why
 *  the last fetch failed (see DashError) — on 'failed' `dash` is still the cached copy, on 'auth' never. */
export function useDashboard(): { dash: Dash | null; refresh: () => void; loading: boolean; error: DashError; fresh: boolean } {
  const { user, loading: authLoading } = useAuth()
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    if (authLoading) return              // wait for auth to resolve before deciding logged-out
    if (!user) { set({ userId: null, dash: null, loading: false, error: null, fresh: false }); return }
    load(user.id)
  }, [user, authLoading])

  const refresh = useCallback(() => { if (user) revalidate(user.id, true) }, [user])

  // Only expose data that belongs to the CURRENT user. Right after an A→B switch the store may
  // still hold A's snapshot for a beat (before the effect runs load(B)); treat that as loading so
  // B never briefly sees A's dashboard.
  const ready = !!user && snap.userId === user.id
  const loading = authLoading || (!!user && (!ready || (snap.dash === null && snap.loading)))
  // Belt and braces for 'auth': whatever the store still holds, no consumer is handed an expired account's data.
  return { dash: ready && snap.error !== 'auth' ? snap.dash : null, refresh, loading, error: ready ? snap.error : null, fresh: ready && snap.fresh }
}
