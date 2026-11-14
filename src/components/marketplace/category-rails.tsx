'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from '@/components/ui/icons'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { fetchTimeLimit } from '@/lib/fetch-time-limit'
import { ListingCard } from './listing-card'
import { CategoryIcon } from './category-icons'
import {
  RAIL_CARD_W, RAIL_SCROLLER, MIN_RAIL_ITEMS, RAIL_SKELETON_COUNT, SECTION_HEADER_ROW, SECTION_TITLE, SECTION_SEE_ALL, RailBeam,
  LANE_CARD_W, LANE_SCROLLER, LANE_CARD_SIZES, LANE_HEADER_ROW, LANE_TITLE, LANE_ICON_HIDE, LANE_SEE_ALL, LaneSeeAllFace, LEAD_TITLE, RAIL_BEAM_LANE, useLaneGate, type RailLook,
} from './shelf'
import { STROKE_UI } from '@/lib/icon-tokens'
import { useLanguage } from '@/context/language-context'
import { Bilingual } from './bilingual'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** One category's rail as the server reads it (src/lib/core/category-rails.ts `CategoryRailRow`). */
export type CategoryRailData = { slug: string; listings: SerializedListingCard[] }
/** A rail that will draw: its category, and the cards left after the dedup. */
export type CategoryLaneData = { cat: SerializedCategory; items: SerializedListingCard[]; slug: string }

/**
 * ⛔ THE RAILS COME FROM THE SERVER (owner-approved 2026-11-14, cook r04 home-b "lanes as rails"). They used to be asked of
 * /api/category-rails after the reader neared them (and, since 2026-11-12, prefetched at the first scroll after `load`). On a
 * phone they are now lanes ABOVE the feed, where an answer arriving after the first paint would push the feed down under a
 * reader already looking at it, so (home)/page.tsx reads them into its ISR document (src/lib/core/category-rails.ts) and the
 * explorer hands them here. The ask before the paint and its one-slot prefetch are gone; desktop draws the same rails,
 * still deferred below the feed (listings-explorer.tsx DeferredCategoryRails), from the same data. What came back is a
 * CHECK AFTER the paint (useFreshCategoryLanes below).
 * ⛔ THE PHONE'S LANE ORDER IS NO LONGER r04's FIXED ONE (owner-approved 2026-11-15 (build 8), cook r08 home): the explorer
 * draws the category lanes in the server's order but splits them BY SLUG — the flyer-heavy ones (Services) after Partners and
 * Outstanding businesses (listings-explorer.tsx LATE_LANE_SLUGS). The server still decides which rails exist and their order.
 *
 * Which rails draw, decided ONCE from props (so the server render and hydration agree on every lane and its place):
 * drop the cards the rails ABOVE already showed (`excludeIds`: Trending / Outstanding businesses — on a 13-listing catalogue
 * the same card in three adjacent rails reads as padding, not supply), then hide a rail under the shared sparse floor
 * (MIN_RAIL_ITEMS — a category heading over one or two cards is manufactured density, and every listing still appears in
 * the feed grid). A slug this edition does not list draws nothing.
 */
export function visibleCategoryRails(
  rails: readonly CategoryRailData[],
  categories: readonly SerializedCategory[],
  excludeIds?: readonly string[],
): CategoryLaneData[] {
  const bySlug = new Map(categories.map((c) => [c.slug, c]))
  const exclude = new Set(excludeIds ?? [])
  const out: CategoryLaneData[] = []
  for (const rail of rails) {
    const cat = bySlug.get(rail.slug)
    if (!cat) continue
    const items = rail.listings.filter((l) => !exclude.has(l.id))
    if (items.length < MIN_RAIL_ITEMS) continue
    out.push({ cat, items, slug: rail.slug })
  }
  return out
}

/**
 * ⛔ THE SERVER'S LANES ARE CHECKED ONCE AFTER THE PAINT (commit review, 2026-11-14). They ride the home page's ISR document,
 * up to six hours old, and not every takedown purges '/'. The client ask they replaced showed nothing older than a few
 * minutes. So once a lane's cards are drawn, /api/category-rails (edge-cached, its Cache-Control unchanged — the same one
 * ask per visit the old shelves made) is asked once, and every card its answer no longer carries leaves (freshenLanes).
 * ⚠️ NO AGE GATE ON THE BROWSER'S CLOCK: an earlier "only past a minute" skipped the check on a device whose clock ran
 * slow, and never re-checked a page that was young when drawn (commit review). The ask is cheap; always making it is simpler.
 */

/**
 * The lanes as drawn, checked against a fresh answer: every card it no longer carries LEAVES, and nothing else moves — the
 * same lanes in the same order, each remaining card in its order (the fresh answer's copy of it: its price and title now),
 * and NOTHING NEW COMES IN (a card arriving in a lane the reader is looking at is the motion this exists to avoid).
 * ⚠️ THE ANSWER IS NOT A LIVENESS CHECK: it is each category's current top eight, so a card merely re-ranked out of them
 * leaves too. That is the safe side — what stays is what the server vouches for now — and the next regeneration fills the
 * lanes again. A card is kept if it is in ANY of the answer's rails (fewer false departures than its own lane alone).
 * ⛔ A LANE LEFT UNDER MIN_RAIL_ITEMS STAYS, WITH WHAT IT HAS. The floor is a first-paint rule (manufactured density);
 * hiding a lane after the paint moves everything under it — on a phone, the lanes after it and the feed — under a reader
 * already looking. One or two real cards for the rest of the visit are the lesser cost. Only a lane left with NO card goes
 * (CategoryLane draws nothing for it: a heading over an empty row is worse than the shift, and every card of a lane taken
 * down within six hours is rare). It keeps its entry here, so the lanes after it keep their places in the phone's order
 * (listings-explorer.tsx `data-home-lanes` draws them by slug, the first product lane with its cards from the server).
 */
export function freshenLanes(lanes: readonly CategoryLaneData[], fresh: readonly CategoryRailData[]): CategoryLaneData[] {
  const live = new Map<string, SerializedListingCard>()
  for (const rail of fresh) for (const l of rail.listings ?? []) live.set(l.id, l)
  // The answer carries only the asking reader's title translations (its `lang`); the server's copy carries every one, so they
  // are kept under the answer's: a reader who switches language afterwards still gets the titles (commit review).
  return lanes.map((lane) => ({ ...lane, items: lane.items.flatMap((l) => {
    const f = live.get(l.id)
    return f ? [{ ...f, titleI18n: { ...l.titleI18n, ...f.titleI18n } }] : []
  }) }))
}

/**
 * The server's lanes, and `check` — the one ask that keeps them honest (above). Hand `check` to the lanes (CategoryLane
 * `onDrawn`): they call it when their cards are drawn, at an idle moment after `load`, and only where their copy is shown, so
 * the first paint never shares the network with it and a hidden copy never asks. ONE ask per server snapshot (`renderedAt`):
 * lanes drawing while it is in flight share it; a failed ask is tried once more by itself 5 s later, and never again; new
 * server lanes (a refresh) start over, and an answer is applied only to the snapshot it was asked for. Until an answer lands
 * the lanes are the server's own, so the hydration render agrees with the HTML.
 */
export function useFreshCategoryLanes(lanes: readonly CategoryLaneData[], renderedAt: number | undefined) {
  const { lang } = useLanguage()
  const [fresh, setFresh] = useState<{ at: number; rails: readonly CategoryRailData[] } | null>(null)
  const ask = useRef<{ at: number; done: boolean; busy: boolean; tries: number } | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<() => void>(() => {})
  useEffect(() => () => clearTimeout(retry.current), [])
  const check = useCallback(() => {
    if (renderedAt === undefined || lanes.length === 0) return
    if (ask.current?.at !== renderedAt) { clearTimeout(retry.current); ask.current = { at: renderedAt, done: false, busy: false, tries: 0 } }
    const a = ask.current
    if (a.done || a.busy || a.tries >= 2) return
    a.busy = true
    a.tries += 1
    // ⛔ `lang` IN THE URL, as the ask always sent it: the answer then carries only this reader's title translations, and
    // any shared cached copy is keyed by it (route.ts readerLang).
    void fetch(`/api/category-rails?lang=${encodeURIComponent(lang)}`, { signal: fetchTimeLimit(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rails?: unknown } | null) => {
        if (!d || !Array.isArray(d.rails)) return
        a.done = true
        // Only the snapshot still shown: an older snapshot's late answer must not overwrite a newer one's (commit review).
        if (ask.current === a) setFresh({ at: a.at, rails: d.rails as CategoryRailData[] })
      })
      .catch(() => {})
      .finally(() => {
        a.busy = false
        if (!a.done && a.tries < 2 && ask.current === a) retry.current = setTimeout(() => latest.current(), 5000)
      })
  }, [renderedAt, lanes.length, lang])
  useEffect(() => { latest.current = check }, [check])
  const shown = useMemo(() => (fresh && fresh.at === renderedAt ? freshenLanes(lanes, fresh.rails) : lanes), [lanes, fresh, renderedAt])
  return { lanes: shown, check }
}

/** `run` at the first idle moment after `load` (never before it: the first paint's requests go first). Returns a cancel. */
function afterLoadIdle(run: () => void): () => void {
  let idle: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const go = () => {
    if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run, { timeout: 2000 })
    else timer = setTimeout(run, 300)
  }
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
  return () => {
    window.removeEventListener('load', go)
    if (idle !== undefined) cancelIdleCallback(idle)
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * One category rail — on the home page's phone, a LANE (shelf.tsx LANE_*). The cards (and therefore their images) mount
 * only once the rail nears the viewport (useLaneGate) — with up to ~10 rails on the home page, mounting every card up front
 * flooded the page with images — over same-size placeholders, so nothing shifts. `initialShow`: the cards are drawn from the
 * first render, in the server's HTML (the first lane, on a phone's first screens).
 * `onDrawn`: told once the cards are drawn (the gate open), at the first idle moment after `load` — useFreshCategoryLanes'
 * `check` — and only while `liveMedia` matches, when given (the ForYouRail `liveMedia` rule: the home page draws these
 * lanes twice, and the copy hidden at this width never asks). A lane whose every card left (freshenLanes) draws nothing.
 * `lead`: the home page's first lane when Trending does not draw — its heading the page's one display line (shelf.tsx
 * LEAD_TITLE, owner-approved 2026-11-15 (build 7)).
 */
export function CategoryLane({ cat, listings, onCategory, look = 'rail', lead = false, initialShow = false, onDrawn, liveMedia }: {
  cat: SerializedCategory
  listings: readonly SerializedListingCard[]
  onCategory: (slug: string) => void
  look?: RailLook
  lead?: boolean
  initialShow?: boolean
  onDrawn?: () => void
  liveMedia?: string
}) {
  const { tr } = useLanguage()
  const router = useRouter()
  const lane = look === 'lane'
  const cardW = lane ? LANE_CARD_W : RAIL_CARD_W
  // The scroller ref is shared: the hook drives the ← / → arrows AND the lazy-mount IntersectionObserver. `watch`: the
  // cards can leave after the paint (freshenLanes), and only the scroller's content changes then (shelf.tsx `watch`).
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]', watch: listings.length })
  const show = useLaneGate(scrollerRef, initialShow)
  useEffect(() => {
    if (!show || !onDrawn) return
    if (liveMedia && typeof window.matchMedia === 'function' && !window.matchMedia(liveMedia).matches) return
    return afterLoadIdle(onDrawn)
  }, [show, onDrawn, liveMedia])

  if (listings.length === 0) return null
  return (
    <section data-lane={lane ? '' : undefined}>
      {/* The header is the SHARED treatment (SECTION_* from shelf.tsx) so this rail cannot
          drift from the <Shelf> rails around it — it hand-rolled the same row before and had
          already drifted. The h2 WRAPS the button (heading > button is valid phrasing
          content); the reverse — a heading inside a <button> — is invalid HTML → React #418,
          which is why the title text itself stays a span. */}
      <div className={lane ? LANE_HEADER_ROW : SECTION_HEADER_ROW}>
        <h2 className="min-w-0">
          <Button variant="bare" size="none" onClick={() => onCategory(cat.slug)} className="group flex items-center gap-2">
            {/* Header size = the 16px UI tier, so the baked display stroke (1.5, tuned for
                h-11 tiles) reads wispy beside the stroke-2 Clock/Award/History headers of
                the sibling rails — re-tier the ink line to the UI weight (icon-language §2). */}
            {/* ⛔ NO `selected` HERE, DELIBERATELY. Fill means "you are here" (owner,
                2026-08-07: "use icons filling only when selected, not as default"), and these
                rails all render at once on the UNFILTERED home view — nothing is chosen, so
                nothing may fill. The header is a shortcut INTO the category, exactly like the
                home grid tile; the filled state belongs to the browse rail you land on. If a
                later pass wants a fill here it needs a real boolean to hang it on, and this
                component has none. (A phone lane draws no heading icon at all — shelf.tsx.) */}
            <CategoryIcon name={cat.icon} stroke={STROKE_UI} className={cn('h-4 w-4 text-accent-foreground', lane && LANE_ICON_HIDE)} />
            <span className={cn(lane ? (lead ? LEAD_TITLE : LANE_TITLE) : SECTION_TITLE, 'transition-colors group-hover:text-accent-foreground')}>
              <Bilingual en={cat.name} vi={cat.nameVi || cat.name} />
            </span>
          </Button>
        </h2>
        {/* A lane's See all is the 32px arrow disc on a phone, its words its accessible name (shelf.tsx LANE_SEE_ALL, build 8). */}
        <Button variant="bare" size="none" onClick={() => onCategory(cat.slug)} className={lane ? LANE_SEE_ALL : SECTION_SEE_ALL}>
          {lane ? <LaneSeeAllFace label={tr('See all', 'Xem tất cả')} /> : <>{tr('See all', 'Xem tất cả')}<ChevronRight className="h-4 w-4" /></>}
        </Button>
      </div>
      {/* ⚠️ THE SWIPE BEAM BELONGS HERE TOO — this rail does NOT go through <Shelf>, which is
          exactly why the first version of the hint missed Services, Travel, Home and Fashion.
          ⛔ …except on a phone lane (owner-approved 2026-11-15 (build 7) — shelf.tsx RAIL_BEAM_LANE). */}
      <RailBeam scrollerRef={scrollerRef} canRight={canRight} seedItems={lane ? listings.length : undefined} className={lane ? RAIL_BEAM_LANE : undefined} />
      {/* Cards pixel-match the feed grid (RAIL_SCROLLER / RAIL_CARD_W: its bleed and gaps, one card == one grid column) —
          or, as a phone lane, 220px cards bled to the screen edges (LANE_*). */}
      <div className="relative">
        <div ref={scrollerRef} className={lane ? LANE_SCROLLER : RAIL_SCROLLER}>
          {show
            ? listings.map((l) => (
                <div key={l.id} data-sid={l.sellerId} className={cardW}>
                  <ListingCard
                    listing={l}
                    onOpen={(x) => router.push(`/listings/${x.id}`)}
                    onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                    lane={lane}
                    sizes={lane ? LANE_CARD_SIZES : undefined}
                  />
                </div>
              ))
            : // Same-size skeletons hold the row height until it mounts (no images, no shift).
              Array.from({ length: Math.min(listings.length, RAIL_SKELETON_COUNT) }).map((_, i) => (
                <ListingCardSkeleton key={i} className={cardW} />
              ))}
        </div>
        <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
      </div>
    </section>
  )
}

/** "Browse by category" — one horizontal rail per category, the owner's lead order then live demand (the server's order),
 *  below the For You + Outstanding businesses rails under the desktop feed. `lanes`: visibleCategoryRails() of the
 *  server's rails, computed once by the explorer (the phone's lanes above the feed come from the same list). `onDrawn`: each
 *  rail's (CategoryLane), with no media of its own — this place is `max-sm:hidden`, so a phone never draws it. */
export function CategoryRails({ lanes, onCategory, onDrawn }: { lanes: readonly CategoryLaneData[]; onCategory: (slug: string) => void; onDrawn?: () => void }) {
  if (lanes.length === 0) return null
  return (
    <div className="space-y-7">
      {lanes.map(({ cat, items, slug }) => (
        <CategoryLane key={slug} cat={cat} listings={items} onCategory={onCategory} onDrawn={onDrawn} />
      ))}
    </div>
  )
}
