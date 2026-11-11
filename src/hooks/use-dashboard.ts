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
 * THE DEVICE ENTRY, ONE KEY (sign-out-storage.ts clears it, in this build and in every earlier one; /privacy lists it
 * as the dashboard copy removed at sign-out). Its value is one or two lines:
 *   line 1  `{ userId, summary }` as JSON: the account fields from the last answer of either view. Paints the rail.
 *   line 2  the last FULL answer as JSON (without the trust and enforcement panels, which nothing paints), for an
 *           account of ordinary size (DEVICE_LISTINGS_MAX, DEVICE_CHARS_MAX). Paints My listings and the availability review at once, as the cache did when every request
 *           was the full one: a page that showed its rows on arrival must not start on a skeleton (measured against the
 *           live build, 2026-11-11), nor fall back to an error page over a saved copy when the refetch fails.
 * ⛔ TWO LINES, NOT ONE OBJECT, FOR THREE REASONS.
 *   · The rail is on every signed-in page and must not pay for the listings: it parses line 1 only, and an answer that
 *     changes nothing writes nothing. As one object, every page parsed (and every answer re-serialised) the whole copy.
 *   · A summary answer rewrites line 1 and carries over line 2 AS STORED AT THAT MOMENT, never a copy this tab read
 *     earlier: another tab's newer listings (a listing deleted or held there) must not be rolled back, and an entry
 *     sign-out has just cleared must not come back with the listings.
 *   · A build from before R13 (an eno-deploy auto-rollback, a revert) reads this key as `{ userId, dashboard }` and its
 *     `listings` and `stats` unguarded: a summary under `dashboard` was a TypeError at render. Two lines are not JSON, so
 *     that build's read throws inside its own try, it finds no cache and loads cold. Its own entry (one object with
 *     `dashboard`) is still read here: `legacy` below.
 */
type StoredHead = { userId?: string; summary?: DashSummary; dashboard?: Dash } | null

/** The account fields of an answer: what the summary view carries (the full one adds the listings, their stats and the
 *  trust and enforcement panels). */
function summaryOf(d: DashSummary): DashSummary {
  const { listings, stats, enforcement, trustProgress, ...summary } = d as Dash & { enforcement?: unknown; trustProgress?: unknown }
  return summary
}

/** What line 2 keeps of a full answer: everything a page paints. The trust and enforcement panels (open reports) are
 *  read by no page from this store, so they are not left on the device. */
function listingsCopy(d: Dash): Dash {
  const { enforcement, trustProgress, ...kept } = d as Dash & { enforcement?: unknown; trustProgress?: unknown }
  return kept
}

/**
 * What a copy read from the device may say. isAdmin default-first: caches written before the field existed lack it,
 * and it is FORCED false from cache: a revoked admin must never see the Admin rail group replayed from localStorage
 * (offline, or before revalidate lands). Real admins get it back one fetch later, the safe direction to flash.
 */
const fromDevice = <D extends DashSummary>(d: D): D =>
  ({ ...d, isAdmin: false, hasVisa: d.hasVisa ?? false, hasTeacher: d.hasTeacher ?? false, teacherDraft: d.teacherDraft ?? null })

/** The stored value for `uid`, split: line 1 parsed, line 2 as text. Null when there is none for this account. */
function stored(uid: string): { raw: string; head: NonNullable<StoredHead>; line1: string; line2: string | null } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const nl = raw.indexOf('\n') // JSON.stringify never writes a raw newline, so the first one is the separator
    const line1 = nl < 0 ? raw : raw.slice(0, nl)
    const head = JSON.parse(line1) as StoredHead
    return head && head.userId === uid ? { raw, head, line1, line2: nl < 0 ? null : raw.slice(nl + 1) } : null
  } catch { return null } // corrupt entry, or storage blocked
}

/** A stored copy is painted as a full answer only with what the two pages read unguarded: the listings and the stats. */
const isFull = (d: unknown): d is Dash =>
  !!d && typeof d === 'object' && Array.isArray((d as Dash).listings) && !!(d as Dash).stats && typeof (d as Dash).stats === 'object' && !!(d as Dash).profile

/** `legacy`: the full answer inside an entry a build from before the summary stored (one object, no second line). */
const legacy = (head: NonNullable<StoredHead>): Dash | null => (isFull(head.dashboard) ? head.dashboard : null)

/** The account fields on the device for `uid`. Parses line 1 only. */
function readSummary(uid: string): DashSummary | null {
  const s = stored(uid)
  const kept = s && (s.head.summary ?? (legacy(s.head) ? summaryOf(legacy(s.head)!) : null))
  return kept ? fromDevice(kept) : null
}

/** The device's copy of the last full answer for `uid`. Called only for a page that lists listings. */
function readFull(uid: string): Dash | null {
  const s = stored(uid)
  if (!s) return null
  try {
    const full: unknown = s.line2 === null ? legacy(s.head) : JSON.parse(s.line2)
    return isFull(full) ? full : null
  } catch { return null }
}

function dropDevice(): void {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* private mode */ }
}

/**
 * ⛔ LINE 2 HAS A FIXED CEILING, FAR BELOW THE BROWSER'S QUOTA. The quota (about 5 million characters) is shared by
 * everything this site keeps on the device: a copy that grew until the browser refused it left no room for the inbox
 * cache or a half-written listing, and for the account with thousands of listings (a 16.5 MB answer) every visit turned
 * the whole answer into text only to have the write refused. So: an answer with more listings than this is not
 * serialised at all, and one whose text is longer is not stored. Such an account opens My listings on its skeleton and
 * its own request, as it does today whenever its copy does not fit.
 */
export const DEVICE_LISTINGS_MAX = 300
export const DEVICE_CHARS_MAX = 1_000_000

/** Line 2 for a full answer, or null when the account is over the ceiling. */
function line2Of(d: Dash): string | null {
  if (d.listings.length > DEVICE_LISTINGS_MAX) return null
  const text = JSON.stringify(listingsCopy(d))
  return text.length <= DEVICE_CHARS_MAX ? text : null
}

/** Store an answer: line 1 always; line 2 from a full answer, else whatever line 2 the device holds for `uid` NOW. */
function writeDevice(uid: string, d: DashSummary, view: DashView): void {
  let line1: string
  let line2: string | null = null
  try {
    line1 = JSON.stringify({ userId: uid, summary: summaryOf(d) })
    if (view === 'full') line2 = line2Of(d as Dash)
    else {
      const s = stored(uid)
      if (s?.line1 === line1) return // nothing changed: nothing to write (the rail asks on every page)
      // An entry the build before the summary stored is converted once, here; after this write it has two lines.
      if (s) line2 = s.line2 ?? (legacy(s.head) ? line2Of(legacy(s.head)!) : null)
    }
  } catch { return }
  try {
    localStorage.setItem(CACHE_KEY, line2 === null ? line1 : `${line1}\n${line2}`)
  } catch {
    // The quota is full, or storage is blocked. Line 1 alone; and if even that is refused, nothing: an entry that can
    // no longer be replaced would only grow older.
    try { localStorage.setItem(CACHE_KEY, line1) } catch { dropDevice() }
  }
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
 *  `full`: `dash` carries the listings of a full answer: one fetched in this session, or the device's copy (a later
 *  summary only refreshes the account fields around them).
 *  `fullFresh`: those listings came from a full answer fetched in this session. A page that lists listings reports
 *  THIS as its `fresh`: the summary landing first must not make the device's days-old listings read as today's (the
 *  availability review marks today done on an empty FRESH list). */
type State = { userId: string | null; dash: DashSummary | null; full: boolean; fullFresh: boolean; loading: boolean; error: DashError; fresh: boolean }
// ⚠️ `state` STARTS as the exact same reference as SERVER_SNAPSHOT (below). During hydration
// useSyncExternalStore renders once from getServerSnapshot, then reads getSnapshot; if those
// returned equal-but-DIFFERENT objects React would force an extra re-render (and risk tearing).
// Sharing the reference makes the first client snapshot identical to the server's.
const SERVER_SNAPSHOT: State = { userId: null, dash: null, full: false, fullFresh: false, loading: true, error: null, fresh: false }
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
/** The view of the request whose failure `error: 'failed'` reports (read by revalidate's `firstFull`). */
let failedView: DashView | null = null
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
  // A full request while the store holds no listings does the same with an earlier failure of a SUMMARY (the rail's): the
  // page that needs them has nothing to show yet, and this request is a new try, not the one that failed.
  // ⛔ NEVER WITH A FAILED FULL REQUEST (2026-11-11). When the desktop rail mounts after the page's own answer has landed,
  // it asks again: not forced, and the full view while the page is mounted (local builds, 1024px or wider, the first full
  // answer failing at once: a second full request in 60 of 63 loads; in the other 3 the rail mounted while the page's
  // request was in flight and was deduped, as in 9 of 9 loads with that answer held 1.5 s). Clearing the page's own
  // failure there flipped My listings from "Couldn't load your listings" back to its skeleton, then to the error again
  // when that request failed too: two more layout shifts of 0.1358 each, moving the content panel (div.mt-6) and
  // footer#app-footer (local build, Chromium, 1350x940, a failed answer or a rejected fetch alike: CLS 0.489 against
  // 0.31-0.37 on the build before the summary). The error now stays until an answer replaces it, as it did then; Retry
  // and a mutation's re-pull (forced) still re-enter loading.
  const firstFull = view === 'full' && !state.full && state.error === 'failed' && failedView === 'summary'
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
        set({ dash: held ? { ...held, ...d.dashboard } : d.dashboard, full: view === 'full' || held !== null, fullFresh: view === 'full' || state.fullFresh, loading: false, error: null, fresh: true })
        writeDevice(uid, d.dashboard, view)
      } else if (d === UNAUTHORIZED) {
        // ⛔ A 401 = THE SESSION THIS CACHE BELONGS TO IS GONE (the server answers 401 only for "no session" —
        // an auth-server blip is a 503). Never keep painting that account's listings and stats: on a shared
        // device the next person would read them. The in-memory copy and the device cache go together.
        set({ dash: null, full: false, fullFresh: false, loading: false, error: 'auth', fresh: false })
        dropDevice()
      } else {
        failedView = view
        set({ loading: false, error: 'failed' })
      }
    })
    .catch(() => { if (ticket === inflight && state.userId === uid) { failedView = view; set({ loading: false, error: 'failed' }) } })
    // Only the LATEST request may clear the in-flight marker. A forced refresh can overlap an
    // older same-uid fetch; if the older one's finally cleared the marker, a third load could
    // start concurrently. Gating on `ticket === inflight` means only the newest resolves it.
    .finally(() => { if (ticket === inflight && inflightUid === uid) inflightUid = null })
}

/** Point the store at a user, painting from cache first. Idempotent per uid — a second
 *  consumer mounting for the same uid reuses the in-flight fetch instead of firing another. */
function load(uid: string) {
  if (state.userId !== uid) {
    const cached = readSummary(uid)
    set({ userId: uid, dash: cached, full: false, fullFresh: false, loading: !cached, error: null, fresh: false })
  }
  // ⛔ A PAGE THAT LISTS LISTINGS PAINTS THE DEVICE'S COPY AT ONCE and asks for a new answer behind it, whether it is the
  // first consumer of a load or arrives after the rail (a soft navigation: the store then holds only the summary).
  // The account fields already in the store win: they are this session's, or the same entry's own summary. Not `fresh`
  // for that page until its own answer lands (`fullFresh`).
  if (!state.full && wantedView() === 'full') {
    const full = readFull(uid)
    if (full) set({ dash: { ...fromDevice(full), ...(state.dash ?? {}) }, full: true, loading: false })
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
    if (!user) { set({ userId: null, dash: null, full: false, fullFresh: false, loading: false, error: null, fresh: false }); return }
    load(user.id)
    // `view` too: a consumer that switched to the full view must ask for it, not wait on the summary it already has.
  }, [user, authLoading, view])

  const refresh = useCallback(() => { if (user) revalidate(user.id, true) }, [user])

  // Only expose data that belongs to the CURRENT user. Right after an A→B switch the store may
  // still hold A's snapshot for a beat (before the effect runs load(B)); treat that as loading so
  // B never briefly sees A's dashboard.
  const ready = !!user && snap.userId === user.id
  // ⛔ A FULL CONSUMER READS ONLY AN ANSWER THAT HAS THE LISTINGS: this session's, or the device's copy of the last one.
  // A summary has none, and "not loaded" must never read as "no listings": the availability review marks today done on
  // an empty list. With neither it gets no dashboard and `loading` — or, once a request has failed, the error.
  const dash = view === 'full' && !snap.full ? null : snap.dash
  const pending = view === 'full' ? dash === null && snap.error === null : dash === null && snap.loading
  const loading = authLoading || (!!user && (!ready || pending))
  // Belt and braces for 'auth': whatever the store still holds, no consumer is handed an expired account's data.
  return { dash: ready && snap.error !== 'auth' ? dash : null, refresh, loading, error: ready ? snap.error : null, fresh: ready && dash !== null && (view === 'full' ? snap.fullFresh : snap.fresh) }
}
