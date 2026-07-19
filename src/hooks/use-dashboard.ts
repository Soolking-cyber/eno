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
    bio: string | null
    location: string | null
    phone: string | null
    avatarUrl: string | null
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
}

const CACHE_KEY = 'eno-dashboard'

// ── ONE shared store for the whole app ────────────────────────────────────────────────
// The rail and the section pages BOTH read the dashboard, so a per-hook useState would
// double-fetch and — worse — an edit on a page would refresh only that page's copy while the
// rail's stats went stale. This module-level store gives every consumer the same object, one
// fetch, and one refresh(). Keyed by userId so a fast account switch can't leak the previous
// account's data (a late response for an old uid is dropped).
type State = { userId: string | null; dash: Dash | null; loading: boolean }
// ⚠️ `state` STARTS as the exact same reference as SERVER_SNAPSHOT (below). During hydration
// useSyncExternalStore renders once from getServerSnapshot, then reads getSnapshot; if those
// returned equal-but-DIFFERENT objects React would force an extra re-render (and risk tearing).
// Sharing the reference makes the first client snapshot identical to the server's.
const SERVER_SNAPSHOT: State = { userId: null, dash: null, loading: true }
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
function revalidate(uid: string, force = false) {
  if (!force && inflightUid === uid) return   // a fetch for this uid is already running
  inflightUid = uid
  const ticket = ++inflight
  fetch('/api/dashboard')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      // Drop if a newer request started or the active user changed meanwhile.
      if (ticket !== inflight || state.userId !== uid) return
      if (d?.dashboard) {
        set({ dash: d.dashboard, loading: false })
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: uid, dashboard: d.dashboard })) } catch { /* private mode */ }
      } else {
        set({ loading: false })
      }
    })
    .catch(() => { if (ticket === inflight) set({ loading: false }) })
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
      if (c?.userId === uid && c.dashboard) cached = { ...c.dashboard, isAdmin: false }
    } catch { /* corrupt cache — ignore */ }
    set({ userId: uid, dash: cached, loading: !cached })
  }
  revalidate(uid) // deduped: no-op if a fetch for this uid is already running
}

/** Cache-first dashboard data, shared across the app. `dash` is null until loaded; `loading`
 *  is true only on a first load with no cache; `refresh()` re-pulls after a mutation. */
export function useDashboard(): { dash: Dash | null; refresh: () => void; loading: boolean } {
  const { user, loading: authLoading } = useAuth()
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    if (authLoading) return              // wait for auth to resolve before deciding logged-out
    if (!user) { set({ userId: null, dash: null, loading: false }); return }
    load(user.id)
  }, [user, authLoading])

  const refresh = useCallback(() => { if (user) revalidate(user.id, true) }, [user])

  // Only expose data that belongs to the CURRENT user. Right after an A→B switch the store may
  // still hold A's snapshot for a beat (before the effect runs load(B)); treat that as loading so
  // B never briefly sees A's dashboard.
  const ready = !!user && snap.userId === user.id
  const loading = authLoading || (!!user && (!ready || (snap.dash === null && snap.loading)))
  return { dash: ready ? snap.dash : null, refresh, loading }
}
