'use client'

import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Award } from '@/components/ui/icons'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W, MIN_RAIL_ITEMS, RAIL_SKELETON_COUNT, LANE_CARD_W, LANE_CARD_SIZES, useLostPlace, type RailLook } from './shelf'
import { useLanguage } from '@/context/language-context'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { fetchTimeLimit } from '@/lib/fetch-time-limit'
import { allCards, isCard, withTitles, type HomeCard } from '@/lib/home-lanes'
import { isMtLanguage } from '@/lib/i18n/langs'

/** "Outstanding businesses" — a horizontal rail of ONE flagship listing (most-viewed)
 *  from each of the highest-trust business storefronts. A reward for good standing.
 *  Reuses the standard ListingCard (heart, locate→map, trust). Hides when empty. */
/** A card's "show on map" from a rail: one identity, so the card's memo holds. */
const locateFromRail = (l: SerializedListingCard) => { window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } })) }

/** The most asks for this rail's ids: two by themselves (the second 5 s after a failure), then one each time it comes back on screen. */
const MAX_TRIES = 4

/** ⚠️ MEMO: see for-you-rail.tsx. */
export const BusinessRail = memo(function BusinessRail({ initial, look = 'rail' }: {
  initial?: HomeCard[]
  /**
   * 'lane': the home page's phone lane (shelf.tsx LANE_*), inert from `sm`. Its header is in the server's HTML and its cards
   * are drawn once it nears the screen, over same-size placeholders (Shelf `deferCards`): the third lane down on a phone.
   */
  look?: RailLook
}) {
  const { tr, lang } = useLanguage()
  const router = useRouter()
  const openListing = useCallback((x: SerializedListingCard) => router.push(`/listings/${x.id}`), [router])
  // Perf Phase 1: the home landing passes SERVER-KNOWN data — final geometry from the
  // first paint, no fetch, and an empty rail never renders skeletons it must collapse
  // (that collapse was the homepage's whole 0.142 CLS). The client fetch survives only
  // for call sites without a seed.
  const [listings, setListings] = useState<HomeCard[] | null>(initial ?? null)

  useEffect(() => {
    if (initial) return
    fetch('/api/businesses/top')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setListings(d.listings || []) })
      .catch(() => {})
  }, [initial])

  /**
   * ⛔ THE HOME PAGE SENDS THIS RAIL'S CARDS AS IDS (2026-11-17, src/lib/home-lanes.ts slimHomeRails): the first paint draws none
   * of them — the phone's lane waits behind its gate, the desktop's shelf behind DeferredShelf. They are asked of /api/home/cards
   * once the cards are due (Shelf `onShown`), in the server's order and scope; one the server no longer shows is not in the
   * answer and leaves its place. Placeholders until then (the same ones the gate draws), one more try 5 s after a failure.
   * ⛔ NEVER PLACEHOLDERS FOR THE VISIT (commit gate): when both tries failed the rail is LOST — it leaves once wholly below the
   * screen and asks again each time it comes back on it (shelf.tsx useLostPlace), at most MAX_TRIES in all, 5 s apart.
   */
  const missing = useMemo(() => (listings ?? []).filter((l) => !isCard(l)).map((l) => l.id).join(','), [listings])
  const [due, setDue] = useState(false)
  const onShown = useCallback(() => setDue(true), [])
  const [lost, setLost] = useState(false)
  const tries = useRef({ n: 0, busy: false, failedAt: 0 })
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<() => void>(() => {})
  const titled = useRef<{ ids: string; langs: Set<string> } | null>(null)
  useEffect(() => () => clearTimeout(retry.current), [])
  const ask = useCallback(() => {
    const t = tries.current
    if (!missing || t.busy || t.n >= MAX_TRIES || (t.n >= 2 && Date.now() - t.failedAt < 5000)) return
    t.busy = true
    t.n += 1
    fetch(`/api/home/cards?rail=businesses&lang=${encodeURIComponent(lang)}&ids=${encodeURIComponent(missing)}`, { signal: fetchTimeLimit(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cards?: unknown } | null) => {
        if (!d || !Array.isArray(d.cards)) throw new Error('home cards')
        const got = new Map((d.cards as SerializedListingCard[]).map((c) => [c.id, c] as const))
        titled.current = { ids: missing, langs: new Set([lang]) }
        setListings((prev) => prev && prev.flatMap((l) => (isCard(l) ? [l] : got.has(l.id) ? [got.get(l.id)!] : [])))
      })
      .catch(() => {
        t.failedAt = Date.now()
        if (t.n < 2) retry.current = setTimeout(() => latest.current(), 5000)
        else setLost(true)
      })
      .finally(() => { t.busy = false })
  }, [missing, lang])
  useEffect(() => { latest.current = ask }, [ask])
  useEffect(() => { if (due) ask() }, [due, ask])
  // ⛔ A LANGUAGE SWITCH AFTER THE CARDS CAME (category-rails.tsx useFreshCategoryLanes has the rule): asked again once per
  // machine-translated language, and only the titles are taken (withTitles). The page's old copy of this rail carried no title
  // translations at all — topBusinessListings never added them — so a reader now has more than before, never less.
  useEffect(() => {
    const t = titled.current
    if (!t || missing || !isMtLanguage(lang) || t.langs.has(lang)) return
    t.langs.add(lang)
    fetch(`/api/home/cards?rail=businesses&lang=${encodeURIComponent(lang)}&ids=${encodeURIComponent(t.ids)}`, { signal: fetchTimeLimit(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cards?: unknown } | null) => {
        if (!d || !Array.isArray(d.cards)) throw new Error('titles')
        setListings((prev) => prev && withTitles(prev, d.cards as SerializedListingCard[]))
      })
      .catch(() => { t.langs.delete(lang) }) // switching back to it later may ask again
  }, [lang, missing])
  const sectionRef = useRef<HTMLElement>(null)
  const gone = useLostPlace(sectionRef, lost && !!missing, ask)

  // Sparse-rail grace (wow pass, 2026-08-06): below the floor this rail was two cards and
  // a void pretending to be a section. The storefronts stay reachable through their own
  // listings in the feed; the rail returns the moment supply does. `null` still means
  // "loading" (skeletons for un-seeded call sites).
  // The floor is the first paint's (the seed's count): a card gone by the late ask leaves its place, not the rail with it —
  // category-rails.tsx freshenLanes' rule. Only a rail left with no card goes.
  if (gone || (listings !== null && ((initial ?? listings).length < MIN_RAIL_ITEMS || listings.length === 0))) return null

  const lane = look === 'lane'
  const cardW = lane ? LANE_CARD_W : RAIL_CARD_W
  return (
    <Shelf
      icon={Award}
      title={tr('Outstanding businesses', 'Doanh nghiệp nổi bật')}
      watch={missing ? -1 : listings?.length ?? 0}
      look={look}
      deferCards={lane && listings ? listings.length : undefined}
      onShown={onShown}
      sectionRef={sectionRef}
    >
      {listings === null || !allCards(listings)
        ? // Un-seeded call sites (the home landing passes `initial`), and a seed of ids until they come. Four cards fill
          // the widest row exactly — six placeholders against a three-item floor made a
          // resolved rail visibly shrink.
          Array.from({ length: Math.min(listings?.length ?? RAIL_SKELETON_COUNT, RAIL_SKELETON_COUNT) }).map((_, i) => (
            <ListingCardSkeleton key={i} className={cardW} />
          ))
        : listings.map((l) => (
            <div key={l.id} data-sid={l.sellerId} className={cardW}>
              <ListingCard
                listing={l}
                onOpen={openListing}
                onLocate={locateFromRail}
                lane={lane}
                sizes={lane ? LANE_CARD_SIZES : undefined}
              />
            </div>
          ))}
    </Shelf>
  )
})
