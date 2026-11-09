'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { useAuthMaybe } from '@/context/auth-context'
import type { SerializedListing } from '@/lib/types'
import { hapticTap } from '@/lib/haptics'
import { chunkListingIds } from '@/lib/listing-ids'
import { ACCOUNT_KEY, GUEST_KEY, readCopy, readGuest, sessionUidFromCookie, updateGuest, withSavedLock, writeCopy } from '@/lib/saved-store'

const SAVED_KEY = 'eno-saved-cache' // { u, idKey, list, unavailable? } — the cards of one view (a guest's, or one account's)
type SavedSync = typeof import('@/lib/saved-sync')

/**
 * ⛔ SAVES FOLLOW A SIGNED-IN PERSON ACROSS DEVICES (owner, 2026-11-09: "3 ok"). Two lists on the device (saved-store.ts):
 * the GUEST list (`eno:favorites`, today's list — what a signed-out visitor saves here) and the ACCOUNT copy (a cache of
 * the account's server list). A guest is exactly as before and never loads the account engine (saved-sync.ts). A signed-in
 * tab shows the account's list, moves the guest list into it, and writes every tap to the server.
 * ⚠️ FIRST PAINT NEVER WAITS FOR AUTH (it boots lazily, on idle or first input): the account's cached list shows at once
 * ONLY when the session cookie names that same account (sessionUidFromCookie); anything else shows the guest list until
 * auth settles. A first sign-in on this device (no cache) keeps /saved in its skeletons until the account answers — never
 * a wrong "No saved listings".
 */

/**
 * A saved id whose listing ENDED through its own lifecycle — sold, or expired / stale under the
 * apartment availability rules — rather than being taken down. It stays saved and is shown apart from
 * the live grid (/saved's "No longer available"). `card` is what THIS DEVICE last fetched while the
 * listing was live (nothing new crosses the network for a listing that is no longer public); null
 * when the device never had it.
 */
export type SavedUnavailable = { id: string; sold: boolean; card: SerializedListing | null }

type FavoritesCtx = {
  ids: Set<string>
  isFavorite: (id: string) => boolean
  toggle: (id: string) => void
  count: number
  // Net saves made THIS session that aren't yet in a page's SSR savedCount, so a card's
  // displayed count updates the instant you tap the heart without double-counting your
  // own save once the server value (which now includes it) is reloaded. Reset on nav.
  savedDelta: (id: string) => number
  saved: SerializedListing[] | null // preloaded hydrated saved listings, newest saved first (null = loading)
  savedUnavailable: SavedUnavailable[] // saved ids whose listing sold or expired (kept, shown apart)
  // The hydrating fetch did not fully succeed: either every request failed (with `saved` still
  // null, so /saved shows its retry state) or some of them did, in which case `saved` holds the
  // listings that DID load and /saved shows a retry banner above them. Never silently partial.
  savedError: boolean
  retrySaved: () => void // re-run the hydrating fetch (clears savedError)
  // These saves are the signed-in account's, kept on the server (so /saved stops saying "on this device only").
  synced: boolean
}

const FavoritesContext = createContext<FavoritesCtx | undefined>(undefined)
/**
 * What a heart and a saved count draw from. ⛔ ITS OWN CONTEXT: the rest of `value` settles after hydration for every visitor (`saved` from null to [], even with
 * nothing saved), and that used to re-render every heart on the page twice, inside the longest task of the load (speed audit, 2026-11-03). This changes only
 * when a saved id or a count does.
 */
type FavoriteMarks = Pick<FavoritesCtx, 'isFavorite' | 'toggle' | 'savedDelta'>
const FavoriteMarksContext = createContext<FavoriteMarks | undefined>(undefined)

/** The guest list as a view: newest saved first. */
const guestView = () => new Set(readGuest().reverse())

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const pathname = usePathname()
  const { lang } = useLanguage() // third-language titles come server-localized (en/vi are in the payload)
  const auth = useAuthMaybe()
  // undefined = not known: auth has not settled (it boots lazily), or no AuthProvider above (tests mount this alone — it
  // is never read as "signed out", which would drop an account's cache); null = signed out.
  const authUid = !auth || auth.loading ? undefined : (auth.user?.id ?? null)

  // Per-listing net saves made in the current view (this session, this route). The
  // server savedCount already reflects saves persisted before the page loaded (they're
  // baked into the SSR base), so we only add THIS session's not-yet-in-base toggles on
  // top of the base. Reset on route change — a freshly loaded page carries a fresh base
  // that already accounts for them, so keeping the delta would double-count.
  const [optimisticSaves, setOptimisticSaves] = useState<Record<string, number>>({})
  useEffect(() => { setOptimisticSaves((m) => (Object.keys(m).length > 0 ? {} : m)) }, [pathname])
  const savedDelta = useCallback((id: string) => optimisticSaves[id] ?? 0, [optimisticSaves])

  /**
   * ⛔ `idsHydrated` EXISTS BECAUSE /saved CONTRADICTED ITSELF. `ids` is filled HERE, in an effect,
   * so for the first client render it is empty — and the fetch effect below read that empty set as
   * "this device has saved nothing", set `saved = []`, and /saved dropped out of its loading branch
   * into the mascot "No saved listings yet" while its own heading, reading the freshly-hydrated
   * `ids.size`, said "5 saved listings". Reproduced with the listings fetch held 2.5s: the
   * contradictory pair was on screen for 12 of 16 samples.
   * ⚠️ An empty `ids` means "we have not looked yet" until this flag flips. The flag is set in a
   * `finally` so a thrown/absent localStorage (private mode, storage disabled) still releases the
   * page rather than pinning it in skeletons forever.
   */
  const [idsHydrated, setIdsHydrated] = useState(false)

  /** The account this tab shows saves for; null = the device's guest list (a guest, or accounts unavailable here). */
  const [owner, setOwner] = useState<string | null>(null)
  const ownerRef = useRef<string | null>(null)
  /**
   * The account whose saves this page keeps on the device instead: the server said the table is not there yet. Per account
   * (commit review) — another account signing in tries again.
   */
  const [offFor, setOffFor] = useState<string | null>(null)
  /** The account's first read failed with nothing cached: /saved says so (savedError) and Retry asks again. */
  const [accountFailed, setAccountFailed] = useState(false)
  const syncRef = useRef<SavedSync | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  /** Back to the guest list. The account's caches go with it — they hold nothing that is not on the server. */
  const leaveAccount = useCallback(() => {
    const was = ownerRef.current
    ownerRef.current = null
    setOwner(null)
    setAccountFailed(false)
    // The count nudges belong to the account that tapped them (review r2): the next view starts from the pages' own counts.
    setOptimisticSaves((m) => (Object.keys(m).length > 0 ? {} : m))
    syncRef.current?.stopSaved()
    if (was || readCopy()) writeCopy(null)
    try {
      const c = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null') as { u?: unknown } | null
      if (c && (c.u ?? null) !== null) localStorage.removeItem(SAVED_KEY)
    } catch { /* storage refused */ }
    setIds(guestView())
    setIdsHydrated(true)
  }, [])

  /** The engine, loaded once a session is in play (a guest never downloads it), its view mirrored into `ids`. */
  const loadEngine = useCallback(async (): Promise<SavedSync> => {
    if (syncRef.current) return syncRef.current
    const m = await import('@/lib/saved-sync')
    if (!syncRef.current) {
      syncRef.current = m
      unsubRef.current = m.subscribeSaved(() => {
        const v = m.savedView()
        if (!v.owner || v.owner !== ownerRef.current) return
        if (!v.available) { const uid = v.owner; leaveAccount(); setOffFor(uid); return }
        setIds(new Set(v.ids))
        setAccountFailed(v.failed)
        if (v.ready) setIdsHydrated(true)
      })
    }
    return m
  }, [leaveAccount])
  useEffect(() => () => { unsubRef.current?.(); unsubRef.current = null }, [])

  useEffect(() => {
    // The first paint: the account's cached list when the session cookie names that account, else the guest list.
    let uid: string | null = null
    try { uid = sessionUidFromCookie(document.cookie, Date.now()) } catch { uid = null }
    const copy = uid ? readCopy() : null
    if (uid && copy?.u === uid) {
      const signedIn = uid
      ownerRef.current = signedIn
      setOwner(signedIn)
      // The account's list only — the engine's own invariant (saved-sync.ts), so the badge never drops and rises again
      // when the engine takes over (review r5).
      setIds(new Set(copy.ids))
      // A failed load is handled when auth settles (it loads again there, and falls back to device saves).
      void loadEngine().then((m) => { if (ownerRef.current === signedIn) m.startSaved(signedIn) }, () => {})
    } else {
      setIds(guestView())
    }
    setIdsHydrated(true)
    // Other tabs: the guest list (a guest view adopts it; an account view shows the part not yet moved in) and the
    // account cache. Adopting never sends a request, so tabs never set each other off.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== GUEST_KEY && e.key !== ACCOUNT_KEY) return
      if (ownerRef.current) syncRef.current?.adoptStoredSaved()
      else if (e.key !== ACCOUNT_KEY) setIds(guestView())
    }
    // Saves made on another device show up when this tab comes back (at most one read a minute).
    const onVisible = () => { if (document.visibilityState === 'visible' && ownerRef.current) syncRef.current?.syncSavedIfStale() }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadEngine])

  // Auth settled: signed out → the guest list (and no account cache left behind); signed in → that account, synced (its
  // guest saves move in). Another account than the one shown → the shown one is dropped first.
  useEffect(() => {
    if (authUid === undefined || (authUid !== null && authUid === offFor)) return
    if (authUid === null) {
      if (ownerRef.current || readCopy()) leaveAccount()
      return
    }
    const uid = authUid
    if (ownerRef.current !== uid) {
      if (ownerRef.current) leaveAccount()
      ownerRef.current = uid
      setOwner(uid)
      // No cache for this account: /saved keeps its skeletons until the account answers.
      if (readCopy()?.u !== uid) setIdsHydrated(false)
    }
    void loadEngine().then((m) => {
      if (ownerRef.current !== uid) return
      m.startSaved(uid)
      void m.syncSaved(uid)
    }, () => {
      // The engine could not load: device saves for this page, never skeletons that wait forever (review r3).
      if (ownerRef.current !== uid) return
      leaveAccount()
      setOffFor(uid)
    })
  }, [authUid, offFor, leaveAccount, loadEngine])

  const toggle = useCallback((id: string) => {
    const added = !ids.has(id)
    const uid = ownerRef.current
    const step = added ? 1 : -1
    // Optimistically move THIS session's displayed count (base + delta) so the number
    // updates the instant the heart is tapped.
    setOptimisticSaves((m) => ({ ...m, [id]: (m[id] ?? 0) + step }))
    // Persist the aggregate savedCount server-side (fire-and-forget — it only feeds the social-proof number), AT THE TAP,
    // as always: a tab closed right after it still counts (keepalive).
    const beacon = (saved: boolean) => {
      fetch(`/api/listings/${id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved }),
        keepalive: true,
      }).catch(() => {})
    }
    beacon(added)
    if (uid) {
      // The account: the engine moves the heart now and tells the server under the lock; a failure puts it back — and the
      // count with it: the nudge, and the public number by the opposite beacon (review r1/r5: a refused save must not
      // leave the count one too high; a closed tab must not leave it one too low).
      const done = (ok: boolean) => {
        if (ok) return
        beacon(!added)
        // A tap answered after its account was left never touches the next view (its nudges were cleared with it).
        if (ownerRef.current === uid) setOptimisticSaves((m) => ({ ...m, [id]: (m[id] ?? 0) - step }))
      }
      if (syncRef.current) syncRef.current.toggleSaved(id, added, done)
      else {
        setIds((prev) => { const next = new Set(prev); next.delete(id); return added ? new Set([id, ...next]) : next })
        void loadEngine().then((m) => {
          if (ownerRef.current !== uid) { done(false); return }
          m.startSaved(uid)
          m.toggleSaved(id, added, done)
        }, () => {
          // A tap whose account was left while the engine loaded is that account's, never the next view's (review r4).
          if (ownerRef.current !== uid) { done(false); return }
          // The engine could not load (a deploy swapped its chunk, a flaky network): this page keeps saves on the device,
          // and this tap goes there rather than nowhere — it moves into the account on a later load (review r3).
          leaveAccount()
          setOffFor(uid)
          void withSavedLock(() => { updateGuest((g) => (added ? [...g.filter((x) => x !== id), id] : g.filter((x) => x !== id))) })
            .then(() => setIds(guestView()))
        })
      }
    } else {
      // The guest list, as before — newest first in the view, and the stored list read and written under the lock, so a
      // merge or a save in another tab is never overwritten by this tab's older copy.
      setIds((prev) => { const next = new Set(prev); next.delete(id); return added ? new Set([id, ...next]) : next })
      void withSavedLock(() => { updateGuest((g) => (added ? [...g.filter((x) => x !== id), id] : g.filter((x) => x !== id))) })
    }
    // The heart filling IS the confirmation — no toast (user decision 2026-07-06:
    // success popups only where nothing else visibly changes).
    // Touch feedback is SYMMETRIC — un-saving used to be silent, so the two directions
    // felt like different controls. Both tick; the weights differ (firmer landing in
    // Saved, lighter leaving it) so the direction is legible without looking. A tap, not
    // hapticConfirm: the heart is a cheap, repeatable gesture down a feed and a
    // success pattern on every one of them is exactly the over-firing to avoid.
    hapticTap(added ? 18 : 10)
    if (added) {
      // First save = the contextual-signup moment (5a #10). The sheet component
      // decides whether to show (guest + not shown before); we just announce.
      window.dispatchEvent(new Event('eno:first-save'))
    }
  }, [ids, loadEngine])

  const isFavorite = useCallback((id: string) => ids.has(id), [ids])

  // Preload the hydrated saved listings so opening /saved is instant. Cached to localStorage as { u, idKey, list } —
  // ⛔ `u` IS WHOSE VIEW IT IS (null: the guest list; else the account), and a view reads only its own: the account's
  // cards are its saves from every device (plan review, 2026-11-09). Sign-out and leaving an account remove it.
  const [saved, setSaved] = useState<SerializedListing[] | null>(null)
  const [savedUnavailable, setSavedUnavailable] = useState<SavedUnavailable[]>([])
  // Another view (signed out, signed in, another account): nothing of the last one's cards stays on screen.
  const [cardsFor, setCardsFor] = useState<string | null>(null)
  if (cardsFor !== owner) {
    setCardsFor(owner)
    setSaved(null)
    setSavedUnavailable([])
  }
  // Surfaced so /saved can show an error + retry instead of shimmering forever
  // when the hydrating fetch fails with no cache to fall back on.
  const [savedError, setSavedError] = useState(false)
  const [fetchTick, setFetchTick] = useState(0)
  const retrySaved = useCallback(() => {
    setSavedError(false)
    setFetchTick((t) => t + 1)
    // The account's own read too, when that is what failed.
    const uid = ownerRef.current
    if (uid) { setAccountFailed(false); void syncRef.current?.syncSaved(uid) }
  }, [])
  const idKey = [...ids].sort().join(',')
  useEffect(() => {
    // ⚠️ WAIT FOR THE IDS. Before hydration an empty `idKey` is "unknown", not "none" — see
    // idsHydrated above. Returning early keeps /saved in its loading branch, which is the honest
    // state, instead of asserting the device has nothing saved.
    if (!idsHydrated) return
    if (!idKey) { setSaved([]); setSavedUnavailable([]); return }
    // Instant paint from cache (functional first-party cache of the user's own
    // saved items — works without the cookie banner) when it is about THIS set of ids. Read
    // REGARDLESS of that as a lookup of cards by id: a listing that ended after the set changed (a new
    // heart changes idKey) still gets the card this device last had for it.
    const knownCards = new Map<string, SerializedListing>()
    try {
      const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null')
      // Only this view's own cache (an older one has no `u`: it was the device's, i.e. the guest list's).
      const c = raw && (raw.u ?? null) === owner ? raw : null
      if (c && c.idKey === idKey) { setSaved(c.list); if (Array.isArray(c.unavailable)) setSavedUnavailable(c.unavailable) }
      for (const l of (Array.isArray(c?.list) ? c.list : []) as SerializedListing[]) if (l?.id) knownCards.set(l.id, l)
      for (const u of (Array.isArray(c?.unavailable) ? c.unavailable : []) as SavedUnavailable[]) if (u?.id && u.card) knownCards.set(u.id, u.card)
    } catch {}
    // Debounce so rapid hearting while browsing coalesces into one request.
    let cancelled = false
    const t = setTimeout(() => {
      const requested = idKey.split(',')
      const langQuery = lang !== 'en' && lang !== 'vi' ? `&lang=${lang}` : ''
      // ⛔ CHUNKED, BECAUSE ONE REQUEST ANSWERS AT MOST IDS_FAST_PATH_MAX IDS. Sending all of
      // them in one go did not fail — it returned 200 with the surplus quietly dropped, and the
      // self-heal below then deleted every dropped id from the device. A device with 201 saved
      // listings lost the 201st on its next visit to /saved, permanently and invisibly.
      const chunks = chunkListingIds(requested)
      Promise.all(
        chunks.map((chunk) =>
          fetch(`/api/listings?ids=${encodeURIComponent(chunk.join(','))}${langQuery}`)
            // A non-ok response must NOT be read as data — that would both hide the failure and
            // let the self-heal treat an outage as "all your saved listings were deleted".
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
            .then((d) => ({
              listings: (d?.listings || []) as SerializedListing[],
              // ⚠️ ONLY THE SERVER SAYS WHAT WAS EVALUATED, AND ITS ABSENCE MEANS "NOTHING". A
              // response from an older revision (a rolling deploy, a cached body) carries no
              // `evaluated`, so this falls back to an empty list and the pass below prunes
              // nothing at all. Failing closed here costs a stale heart; failing open costs the
              // user their saved items.
              evaluated: Array.isArray(d?.evaluated) ? (d.evaluated as string[]) : [],
              // ⛔ THE ONLY IDS THIS CLIENT MAY DELETE, named by the server (feed-query.ts `gone`):
              // removed, hidden, or never existed. An id missing from `listings` is NOT a deletion any
              // more — a sold or expired listing is kept. `null` (an older revision without the field)
              // means this chunk can neither prune nor classify anything: fail closed.
              gone: Array.isArray(d?.gone) ? new Set(d.gone as string[]) : null,
              sold: new Set(Array.isArray(d?.sold) ? (d.sold as string[]) : []),
            }))
            .catch(() => null),
        ),
      ).then((results) => {
        if (cancelled) return
        const ok = results.filter((r): r is NonNullable<typeof r> => !!r)
        // Every chunk failed — say so and change nothing. `saved` stays null on a first load, so
        // /saved shows its retry state instead of an empty grid that reads as "you saved nothing".
        if (ok.length === 0) { setSavedError(true); return }

        const byId = new Map<string, SerializedListing>()
        for (const r of ok) for (const l of r.listings) byId.set(l.id, l)
        const list = requested
          .map((id) => byId.get(id))
          .filter((l): l is SerializedListing => !!l)

        // Kept, not live: evaluated in a chunk that could classify (`gone` present), not returned as a
        // card, and not named gone. The card is the one this device last had — never fetched anew.
        const unavailable: SavedUnavailable[] = []
        for (const r of ok) {
          if (!r.gone) continue
          for (const id of r.evaluated) {
            if (byId.has(id) || r.gone.has(id)) continue
            unavailable.push({ id, sold: r.sold.has(id), card: knownCards.get(id) ?? null })
          }
        }
        const order = new Map(requested.map((id, i) => [id, i]))
        unavailable.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

        const complete = ok.length === results.length
        setSavedError(!complete)
        setSaved(list)
        setSavedUnavailable(unavailable)
        // ⚠️ CACHE ONLY A COMPLETE ANSWER. The cache is keyed by idKey and read back as the whole
        // set, so storing a partial merge would present a chunk failure as a shrunken library on
        // every later load — including offline ones.
        if (complete) { try { localStorage.setItem(SAVED_KEY, JSON.stringify({ u: owner, idKey, list, unavailable })) } catch {} }

        // Self-heal: drop saved ids whose listing is GONE (removed, hidden, never existed), so count +
        // badge match what is shown — the grid plus "No longer available".
        // ⛔ ONLY WHAT THE SERVER NAMED `gone` — never "missing from listings". An id can be missing for
        // five reasons: gone, sold, expired/stale, never looked at (past the per-request cap), or its
        // chunk failed. Only the first is a deletion, and only the server can say which (Emil-skills
        // audit, 2026-10-06: sold and expired saves used to be deleted here without a word). A heart
        // tapped while the fetch was in flight was never sent, so it can never be named gone.
        const gone = new Set(ok.flatMap((r) => (r.gone ? r.evaluated.filter((id) => r.gone!.has(id)) : [])))
        if (gone.size === 0) return
        // ⚠️ AN ACCOUNT'S GONE IDS LEAVE ONLY THE LOCAL LIST: the account read already hides them, and a row hidden only in
        // THIS edition (eno.vn and eno.forum share the database) must survive for the other one.
        if (owner) { syncRef.current?.dropGoneSaved([...gone]); return }
        setIds((prev) => {
          const next = new Set([...prev].filter((id) => !gone.has(id)))
          return next.size === prev.size ? prev : next
        })
        void withSavedLock(() => { updateGuest((g) => g.filter((id) => !gone.has(id))) })
      })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [idKey, fetchTick, lang, idsHydrated, owner])

  // ⚠️ FILTERED BY THE LIVE `ids`, AT ONCE (codex + opus, 2026-10-06). The entries are rebuilt only after the
  // debounced refetch, so a removed one stayed on screen with its Remove still live — and a second tap
  // toggled the save straight back on. A row now leaves the moment its id does.
  // ⚠️ …AND IN THE VIEW'S ORDER, NEWEST SAVED FIRST (2026-11-09; it was the ids sorted, i.e. arbitrary). Both lists are
  // filtered by the live ids for the same reason: a removed id leaves at once, and a card of an id no longer in this view
  // (another account's, a sign-out's) never shows.
  const savedShown = useMemo(() => {
    if (!saved) return saved
    const byId = new Map(saved.map((l) => [l.id, l]))
    return [...ids].map((id) => byId.get(id)).filter((l): l is SerializedListing => !!l)
  }, [saved, ids])
  const unavailableShown = useMemo(() => {
    const byId = new Map(savedUnavailable.map((u) => [u.id, u]))
    return [...ids].map((id) => byId.get(id)).filter((u): u is SavedUnavailable => !!u)
  }, [savedUnavailable, ids])
  const synced = owner !== null
  const anyError = savedError || accountFailed
  const value = useMemo(() => ({ ids, isFavorite, toggle, count: ids.size, savedDelta, saved: savedShown, savedUnavailable: unavailableShown, savedError: anyError, retrySaved, synced }), [ids, isFavorite, toggle, savedDelta, savedShown, unavailableShown, anyError, retrySaved, synced])
  const marks = useMemo(() => ({ isFavorite, toggle, savedDelta }), [isFavorite, toggle, savedDelta])

  return (
    <FavoriteMarksContext.Provider value={marks}>
      <FavoritesContext.Provider value={value}>
        {children}
      </FavoritesContext.Provider>
    </FavoriteMarksContext.Provider>
  )
}

export function useFavoriteMarks(): FavoriteMarks {
  const ctx = useContext(FavoriteMarksContext)
  if (!ctx) throw new Error('useFavoriteMarks must be used within a FavoritesProvider')
  return ctx
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider')
  return ctx
}

/**
 * Just the saved COUNT, for chrome that shows it as a badge (the desktop header's heart, UX3 NAV-7).
 * ⚠️ 0 WITHOUT A PROVIDER, NOT A THROW: the header is mounted by tests and stories that do not wrap it in
 * FavoritesProvider, and a badge has nothing to say there. In the app the provider is always above it
 * ([lang]/providers.tsx). The count hydrates in an effect (the device's lists; a signed-in account's from its cache or
 * its first answer), so it is 0 on the server and the first client render — the badge is client-only by construction,
 * as edge-cached HTML needs.
 */
export function useFavoriteCount(): number {
  return useContext(FavoritesContext)?.count ?? 0
}
