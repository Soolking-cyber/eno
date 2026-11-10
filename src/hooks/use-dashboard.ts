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
  /** An UNFINISHED teacher profile (2026-10-11): where it reopens, as "Step X of Y" — never an answer. Legacy caches: null. */
  teacherDraft?: { index: number; total: number } | null
}

/**
 * WHICH ANSWER A CONSUMER READS (speed plan R13, audit api-01).
 *   · 'summary' — GET /api/dashboard?view=summary: everything but `listings` and the `stats` counted from them. The
 *     desktop rail, the explorer's teacher chips and every dashboard page that shows no listing read only this.
 *   · 'full'    — GET /api/dashboard: the listings too. Only /dashboard/listings and /dashboard/availability need them.
 * One account with thousands of listings got the full answer (16.5 MB) from the rail on every page it opened.
 */
export type DashView = 'summary' | 'full'
export type DashSummary = Omit<Dash, 'listings' | 'stats'>

const CACHE_KEY = 'eno-dashboard'
/**
 * ⛔ THE SUMMARY IS STORED AS `{ userId, summary }`, NEVER UNDER `dashboard`. A build from before R13 (an eno-deploy
 * auto-rollback, a revert of this change) reads `dashboard` as a full answer and its `listings` and `stats` unguarded
 * (listings-client's stats strip, availability-client's listing filter): a summary stored there was a TypeError at
 * render on My listings and the review — on every visit for an account whose full answer is over the quota, since that
 * build's own write fails and the summary entry stays. Without `dashboard` that build finds no cache and loads cold.
 * The key is the same, so sign-out-storage.ts still clears it. A copy that build stored (`dashboard`) is still read,
 * stripped to its summary (below).
 */
type CachedDash = { userId?: string; summary?: DashSummary; dashboard?: DashSummary } | null

/**
 * ⛔ THE DEVICE CACHE KEEPS THE SUMMARY ONLY. The whole answer was over the storage quota for a large account, so its
 * cache never saved and every load was cold; and a listings table painted from a days-old copy is a wrong answer
 * wearing a right one's clothes. Stripped on the way in too, so a copy cached before this change paints no listings.
 */
function summaryOf(d: DashSummary): DashSummary {
  // The same keys the summary answer leaves out: the full one also carries the trust and enforcement panels.
  const { listings, stats, enforcement, trustProgress, ...summary } = d as Dash & { enforcement?: unknown; trustProgress?: unknown }
  return summary
}

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
/** `fresh`: `dash` came from a fetch that SUCCEEDED in this session (not only the device cache).
 *  `full`: `dash` carries the listings of a full answer fetched in this session (a later summary only refreshes the
 *  account fields around them), not just the summary or the device cache. */
type State = { userId: string | null; dash: DashSummary | null; full: boolean; loading: boolean; error: DashError; fresh: boolean }
// ⚠️ `state` STARTS as the exact same reference as SERVER_SNAPSHOT (below). During hydration
// useSyncExternalStore renders once from getServerSnapshot, then reads getSnapshot; if those
// returned equal-but-DIFFERENT objects React would force an extra re-render (and risk tearing).
// Sharing the reference makes the first client snapshot identical to the server's.
const SERVER_SNAPSHOT: State = { userId: null, dash: null, full: false, loading: true, error: null, fresh: false }
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
let inflightView: DashView = 'summary'  // what that in-flight request asks for
/**
 * Mounted consumers that need the listings. Every request asks for the full answer while one is mounted — the rail's
 * refresh, a mutation's re-pull, the teacher form's revalidateDashboard — so a summary never replaces the listings
 * under a page that shows them; with none mounted every request is the summary.
 */
let fullConsumers = 0
const wantedView = (): DashView => (fullConsumers > 0 ? 'full' : 'summary')
/** The 401 marker: the server refused this browser's session. */
const UNAUTHORIZED = { unauthorized: true as const }
const fetchDashboard = (view: DashView): Promise<{ dashboard?: DashSummary } | typeof UNAUTHORIZED | null> =>
  fetch(view === 'full' ? '/api/dashboard' : '/api/dashboard?view=summary').then(async (r) => (r.status === 401 ? UNAUTHORIZED : r.ok ? r.json() : null))

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
  const view = wantedView()
  // A fetch for this uid is already running — and it answers this view: a full one covers the summary, a summary does
  // not cover a page that needs the listings (that page's request supersedes it through the ticket below).
  if (!force && inflightUid === uid && (inflightView === 'full' || view === 'summary')) return
  inflightUid = uid
  inflightView = view
  const ticket = ++inflight
  // A forced refresh is the Retry button (and every post-mutation re-pull): drop the old verdict so the
  // page shows it is trying again instead of repeating the failure it just reported.
  // ⛔ AND RE-ENTER LOADING WHEN THERE IS NO DATA. Clearing the error alone left `{ dash: null, loading: false,
  // error: null }` for the length of the retry — which reads as "loaded, and empty": the availability
  // review took that as nothing to review, marked today's review done and left.
  // A full request while the store holds no listings does the same with an earlier failure (the summary's, say): the
  // page that needs them has nothing to show yet, and this request is a new try, not the one that failed.
  const firstFull = view === 'full' && !state.full && state.error === 'failed'
  if ((force && state.error) || firstFull) set({ error: null, loading: state.dash === null })
  fetchDashboard(view)
    // A 401: one session refresh, then one retry (see refreshSessionOnce) — unless a newer request or another
    // account has taken over meanwhile, whose own fetch decides.
    .then(async (d) => {
      if (d !== UNAUTHORIZED) return d
      const r = await refreshSessionOnce()
      if (r === 'ok' && ticket === inflight && state.userId === uid) return fetchDashboard(view)
      return r === 'unavailable' ? REFRESH_UNAVAILABLE : d
    })
    .then((d) => {
      // Drop if a newer request started or the active user changed meanwhile.
      if (ticket !== inflight || state.userId !== uid) return
      if (d && 'dashboard' in d && d.dashboard) {
        // ⛔ A SUMMARY NEVER DROPS LISTINGS ALREADY IN MEMORY. Any summary consumer that mounts (the phone's Account tab,
        // Settings, the explorer on home) revalidates; replacing the full answer with its summary sent every return to
        // My listings back to the skeleton for a round trip, where the page used to paint at once and revalidate behind.
        // The summary's fields are newer, so they win; the listings and stats are this session's last full answer, and
        // the page asks for a new one on mount. The ticket and uid check above make the held answer this account's own.
        const held = view === 'summary' && state.full ? state.dash : null
        set({ dash: held ? { ...held, ...d.dashboard } : d.dashboard, full: view === 'full' || held !== null, loading: false, error: null, fresh: true })
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: uid, summary: summaryOf(d.dashboard) })) } catch { /* private mode */ }
      } else if (d === UNAUTHORIZED) {
        // ⛔ A 401 = THE SESSION THIS CACHE BELONGS TO IS GONE (the server answers 401 only for "no session" —
        // an auth-server blip is a 503). Never keep painting that account's listings and stats: on a shared
        // device the next person would read them. The in-memory copy and the device cache go together.
        set({ dash: null, full: false, loading: false, error: 'auth', fresh: false })
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
    let cached: DashSummary | null = null
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as CachedDash
      // This build's summary, else a full answer a pre-R13 build stored (see CachedDash).
      const kept = c?.summary ?? c?.dashboard
      // isAdmin default-first: caches written before the field existed lack it — paint
      // false (a brief non-admin flash for admins) and let revalidate() correct it.
      // isAdmin is FORCED false from cache: a revoked admin must never see the Admin
      // rail group replayed from localStorage (offline, or before revalidate lands).
      // Real admins get it back one fetch later — the safe direction to flash.
      if (c?.userId === uid && kept) cached = { ...summaryOf(kept), isAdmin: false, hasVisa: kept.hasVisa ?? false, hasTeacher: kept.hasTeacher ?? false, teacherDraft: kept.teacherDraft ?? null }
    } catch { /* corrupt cache — ignore */ }
    set({ userId: uid, dash: cached, full: false, loading: !cached, error: null, fresh: false })
  }
  revalidate(uid) // deduped: no-op if a fetch for this uid is already running (and it answers the view needed)
}

/** Cache-first dashboard data, shared across the app. `dash` is null until loaded; `loading`
 *  is true only on a first load with no cache; `refresh()` re-pulls after a mutation; `error` says why
 *  the last fetch failed (see DashError) — on 'failed' `dash` is still the cached copy, on 'auth' never. */
/**
 * Re-pull the dashboard for `uid` from outside a dashboard surface (the teacher form, 2026-10-11: after its first draft
 * save the "Teacher profile — Continue" row exists, after publish it points at the profile). Dropped unless the store
 * already holds `uid` — revalidate() drops an answer for another account — so it never loads one nobody asked for.
 */
export function revalidateDashboard(uid: string): void {
  if (state.userId === uid) revalidate(uid, true)
}

type DashboardHook<D> = { dash: D | null; refresh: () => void; loading: boolean; error: DashError; fresh: boolean }

// The full view stays the default (and the LAST overload, which `ReturnType<typeof useDashboard>` reads): a consumer
// opts into the summary by asking for it, so none loses its listings by omission.
export function useDashboard(view: 'summary'): DashboardHook<DashSummary>
export function useDashboard(view?: 'full'): DashboardHook<Dash>
export function useDashboard(view: DashView = 'full'): DashboardHook<DashSummary> {
  const { user, loading: authLoading } = useAuth()
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // ⚠️ DECLARED BEFORE THE LOAD EFFECT: React runs a component's effects in order, so this consumer's own first request
  // already asks for the listings it needs.
  useEffect(() => {
    if (view !== 'full') return
    fullConsumers += 1
    return () => { fullConsumers -= 1 }
  }, [view])

  useEffect(() => {
    if (authLoading) return              // wait for auth to resolve before deciding logged-out
    if (!user) { set({ userId: null, dash: null, full: false, loading: false, error: null, fresh: false }); return }
    load(user.id)
    // `view` too: a consumer that switched to the full view must ask for it, not wait on the summary it already has.
  }, [user, authLoading, view])

  const refresh = useCallback(() => { if (user) revalidate(user.id, true) }, [user])

  // Only expose data that belongs to the CURRENT user. Right after an A→B switch the store may
  // still hold A's snapshot for a beat (before the effect runs load(B)); treat that as loading so
  // B never briefly sees A's dashboard.
  const ready = !!user && snap.userId === user.id
  // ⛔ A FULL CONSUMER READS ONLY THE FULL ANSWER. The summary (device cache or a summary request) has no listings, and
  // "not loaded" must never read as "no listings": the availability review marks today done on an empty list. Until
  // the full answer lands it gets no dashboard and `loading` — or, once a request has failed, the error.
  const dash = view === 'full' && !snap.full ? null : snap.dash
  const pending = view === 'full' ? dash === null && snap.error === null : dash === null && snap.loading
  const loading = authLoading || (!!user && (!ready || pending))
  // Belt and braces for 'auth': whatever the store still holds, no consumer is handed an expired account's data.
  return { dash: ready && snap.error !== 'auth' ? dash : null, refresh, loading, error: ready ? snap.error : null, fresh: ready && snap.fresh && dash !== null }
}
