'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from '@/components/ui/icons'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { fetchTimeLimit } from '@/lib/fetch-time-limit'
import { ListingCard } from './listing-card'
import { CategoryIcon } from './category-icons'
import {
  RAIL_CARD_W, RAIL_SCROLLER, RAIL_SKELETON_COUNT, SECTION_HEADER_ROW, SECTION_TITLE, SECTION_SEE_ALL, RailBeam,
  LANE_CARD_W, LANE_SCROLLER, LANE_CARD_SIZES, LANE_HEADER_ROW, LANE_TITLE, LANE_ICON_HIDE, LANE_SEE_ALL, LaneSeeAllFace, LEAD_TITLE, RAIL_BEAM_LANE, useLaneGate, useLostPlace, type RailLook,
} from './shelf'
import { STROKE_UI } from '@/lib/icon-tokens'
import { useLanguage } from '@/context/language-context'
import { Bilingual } from './bilingual'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { allCards, isCard, withTitles, type CategoryLaneData, type HomeCard } from '@/lib/home-lanes'
import { isMtLanguage } from '@/lib/i18n/langs'
import type { CategoryRailRow } from '@/lib/core/category-rails'

// The lane data and the rule for which lanes draw are shared with (home)/page.tsx since 2026-11-17 (src/lib/home-lanes.ts).
export { visibleCategoryRails, type CategoryLaneData, type CategoryRailData } from '@/lib/home-lanes'

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
 * Outstanding businesses (src/lib/home-lanes.ts LATE_LANE_SLUGS). The server still decides which rails exist and their order.
 * Which rails draw, and the lane data: src/lib/home-lanes.ts (visibleCategoryRails), shared with the server since 2026-11-17.
 */

/**
 * ⛔ THE SERVER'S LANES ARE CHECKED ONCE AFTER THE PAINT (commit review, 2026-11-14). They ride the home page's ISR document,
 * up to six hours old, and not every takedown purges '/'. The client ask they replaced showed nothing older than a few
 * minutes. So once a lane's cards are drawn, /api/category-rails (edge-cached, its Cache-Control unchanged — the same one
 * ask per visit the old shelves made) is asked once, and every card its answer no longer carries leaves (freshenLanes).
 * ⚠️ NO AGE GATE ON THE BROWSER'S CLOCK: an earlier "only past a minute" skipped the check on a device whose clock ran
 * slow, and never re-checked a page that was young when drawn (commit review). The ask is cheap; always making it is simpler.
 * ⛔ THE SAME ANSWER DRAWS THE CARDS THE PAGE SENT AS IDS (2026-11-17, src/lib/home-lanes.ts slimHomeRails): only the first
 * product lane's cards come whole in the HTML; every other lane's are ids, in their places, and freshenLanes fills each from
 * this answer (the same function the server read them with, homeCategoryRails) — still ONE ask per snapshot, no second
 * request. A lane whose cards are ids asks the moment it opens, not at the idle after `load` (CategoryLane): its
 * placeholders wait on the answer.
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
 * A card the page sent as its id takes the answer's copy the same way, or leaves with the rest (it was never drawn).
 */
export function freshenLanes(lanes: readonly CategoryLaneData[], fresh: readonly CategoryRailRow[]): CategoryLaneData[] {
  const live = new Map<string, SerializedListingCard>()
  for (const rail of fresh) for (const l of rail.listings ?? []) live.set(l.id, l)
  // The answer carries only the asking reader's title translations (its `lang`); the server's copy carries every one, so they
  // are kept under the answer's: a reader who switches language afterwards still gets the titles (commit review).
  return lanes.map((lane) => ({ ...lane, items: lane.items.flatMap((l) => {
    const f = live.get(l.id)
    return f ? [{ ...f, titleI18n: { ...(isCard(l) ? l.titleI18n : undefined), ...f.titleI18n } }] : []
  }) }))
}

/** The most asks for a snapshot whose lanes hold ids: the two of any snapshot, then lost lanes back on screen (below). */
const MAX_ID_TRIES = 4

/**
 * The server's lanes, and `check` — the one ask that keeps them honest (above). Hand `check` to the lanes (CategoryLane
 * `onDrawn`): they call it when their cards are drawn, at an idle moment after `load`, and only where their copy is shown, so
 * the first paint never shares the network with it and a hidden copy never asks. ONE ask per server snapshot (`renderedAt`):
 * lanes drawing while it is in flight share it; a failed ask is tried once more by itself 5 s later, and never again; new
 * server lanes (a refresh) start over, and an answer is applied only to the snapshot it was asked for. Until an answer lands
 * the lanes are the server's own, so the hydration render agrees with the HTML.
 * ⛔ WHILE A LANE HOLDS IDS (slimHomeRails), NOT ONLY TWICE: after the two tries above it is LOST (`lost` on each such lane,
 * shelf.tsx useLostPlace — it leaves once wholly below the screen), and a lost lane coming back on screen may ask again, at
 * most MAX_ID_TRIES in all and never sooner than 5 s after a failure. A snapshot of whole lanes keeps exactly two.
 * ⛔ …AND ONCE PER MACHINE-TRANSLATED LANGUAGE THE READER SWITCHES TO (commit gate, 2026-11-17): the answer carries only the
 * asker's title translations, where the page's own copy of a card carried every one (freshenLanes keeps those) — so a card that
 * came as an id would lose its title translations on a switch. The ask is made again in the new language and ONLY the titles
 * are taken from it (withTitles: no card comes, goes or moves). Never on the normal path: a reader who does not switch asks
 * once, and asking every language up front instead measured 30.7 KB br against 12.4 KB (2026-11-17) — more than the page saved.
 */
export function useFreshCategoryLanes(lanes: readonly CategoryLaneData[], renderedAt: number | undefined) {
  const { lang } = useLanguage()
  const [fresh, setFresh] = useState<{ at: number; rails: readonly CategoryRailRow[]; lang: string } | null>(null)
  const [titles, setTitles] = useState<{ at: number; cards: readonly SerializedListingCard[] } | null>(null)
  const titled = useRef<{ at: number; langs: Set<string> } | null>(null)
  const ask = useRef<{ at: number; done: boolean; busy: boolean; tries: number; failedAt: number } | null>(null)
  const [lost, setLost] = useState<number | null>(null)
  const holdsIds = useMemo(() => lanes.some((l) => !allCards(l.items)), [lanes])
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<() => void>(() => {})
  useEffect(() => () => clearTimeout(retry.current), [])
  const check = useCallback(() => {
    if (renderedAt === undefined || lanes.length === 0) return
    if (ask.current?.at !== renderedAt) { clearTimeout(retry.current); ask.current = { at: renderedAt, done: false, busy: false, tries: 0, failedAt: 0 } }
    const a = ask.current
    if (a.done || a.busy || a.tries >= (holdsIds ? MAX_ID_TRIES : 2) || (a.tries >= 2 && Date.now() - a.failedAt < 5000)) return
    a.busy = true
    a.tries += 1
    clearTimeout(retry.current) // an ask made meanwhile replaces the one queued by a failure
    const asked = lang
    // ⛔ `lang` IN THE URL, as the ask always sent it: the answer then carries only this reader's title translations, and
    // any shared cached copy is keyed by it (route.ts, siteLangParam).
    void fetch(`/api/category-rails?lang=${encodeURIComponent(lang)}`, { signal: fetchTimeLimit(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rails?: unknown } | null) => {
        if (!d || !Array.isArray(d.rails)) return
        a.done = true
        // Only the snapshot still shown: an older snapshot's late answer must not overwrite a newer one's (commit review).
        if (ask.current === a) setFresh({ at: a.at, rails: d.rails as CategoryRailRow[], lang: asked })
      })
      .catch(() => {})
      .finally(() => {
        a.busy = false
        if (a.done || ask.current !== a) return
        a.failedAt = Date.now()
        if (a.tries < 2) retry.current = setTimeout(() => latest.current(), 5000)
        else setLost(a.at)
      })
  }, [renderedAt, lanes.length, lang, holdsIds])
  useEffect(() => { latest.current = check }, [check])
  // The language switch (above): once per machine-translated language, only for a snapshot whose lanes held ids.
  useEffect(() => {
    if (!fresh || fresh.at !== renderedAt || !holdsIds || !isMtLanguage(lang)) return
    if (titled.current?.at !== fresh.at) titled.current = { at: fresh.at, langs: new Set([fresh.lang]) }
    const t = titled.current
    if (t.langs.has(lang)) return
    t.langs.add(lang)
    void fetch(`/api/category-rails?lang=${encodeURIComponent(lang)}`, { signal: fetchTimeLimit(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rails?: unknown } | null) => {
        if (!d || !Array.isArray(d.rails)) throw new Error('titles')
        if (titled.current !== t) return
        const more = (d.rails as CategoryRailRow[]).flatMap((r) => r.listings ?? [])
        setTitles((prev) => ({ at: t.at, cards: [...(prev?.at === t.at ? prev.cards : []), ...more] }))
      })
      .catch(() => { t.langs.delete(lang) }) // switching back to it later may ask again
  }, [fresh, renderedAt, holdsIds, lang])
  const shown = useMemo(() => {
    let out = fresh && fresh.at === renderedAt ? freshenLanes(lanes, fresh.rails) : lanes
    if (titles && titles.at === renderedAt) out = out.map((l) => ({ ...l, items: withTitles(l.items, titles.cards) }))
    return lost === renderedAt ? out.map((l) => (allCards(l.items) ? l : { ...l, lost: true })) : out
  }, [lanes, fresh, renderedAt, lost, titles])
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
 * ⛔ A LANE WHOSE CARDS THE PAGE SENT AS IDS (src/lib/home-lanes.ts slimHomeRails) keeps its placeholders, open or not, until
 * the check's answer makes them whole — and it asks the moment it opens, not after `load`: nothing else draws them.
 * `lost`: every ask for those ids failed (useFreshCategoryLanes) — the lane leaves once wholly below the screen and asks again
 * each time it comes back on it (shelf.tsx useLostPlace), so its placeholders never stay for the visit.
 * `lead`: the home page's first lane when Trending does not draw — its heading the page's one display line (shelf.tsx
 * LEAD_TITLE, owner-approved 2026-11-15 (build 7)).
 */
function CategoryLaneView({ cat, listings, onCategory, look = 'rail', lead = false, initialShow = false, onDrawn, liveMedia, lost = false }: {
  cat: SerializedCategory
  listings: readonly HomeCard[]
  onCategory: (slug: string) => void
  look?: RailLook
  lead?: boolean
  initialShow?: boolean
  onDrawn?: () => void
  liveMedia?: string
  lost?: boolean
}) {
  const { tr } = useLanguage()
  const lane = look === 'lane'
  const cardW = lane ? LANE_CARD_W : RAIL_CARD_W
  // The scroller ref is shared: the hook drives the ← / → arrows AND the lazy-mount IntersectionObserver. `watch`: the
  // cards can leave after the paint (freshenLanes), and only the scroller's content changes then (shelf.tsx `watch`).
  const whole = allCards(listings)
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]', watch: whole ? listings.length : -1 })
  const show = useLaneGate(scrollerRef, initialShow)
  useEffect(() => {
    if (!show || !onDrawn) return
    if (liveMedia && typeof window.matchMedia === 'function' && !window.matchMedia(liveMedia).matches) return
    if (!whole) { onDrawn(); return }
    return afterLoadIdle(onDrawn)
  }, [show, onDrawn, liveMedia, whole])
  const sectionRef = useRef<HTMLElement>(null)
  const gone = useLostPlace(sectionRef, lost && !whole, onDrawn)

  if (listings.length === 0 || gone) return null
  return (
    <section ref={sectionRef} data-lane={lane ? '' : undefined}>
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
          {show && whole
            ? <LaneCards listings={listings} lane={lane} cardW={cardW} />
            : // Same-size skeletons hold the row height until it mounts (no images, no shift).
              // ⚡ `skeleton-still` (owner, 2026-11-19): the colour without the sweep, like shelf.tsx's held places. Measured on
              // the live home page (Playwright, 4x CPU, slow 4G, 8-run interleaved medians): stopping these placeholders'
              // sweeps made first paint ~0.8 s (~17%) faster. On each card's own root, not a wrapper: they are the row's flex items.
              Array.from({ length: Math.min(listings.length, RAIL_SKELETON_COUNT) }).map((_, i) => (
                <ListingCardSkeleton key={i} className={`${cardW} skeleton-still`} />
              ))}
        </div>
        <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
      </div>
    </section>
  )
}

/**
 * A lane's cards, MEMOIZED APART FROM THE LANE (2026-11-25, phone home profile). The lane's own state is its scroll arrows
 * (canLeft / canRight / arrowTop, measured after mount) and its gate. With the cards mapped inline, every one of those updates
 * re-rendered all its cards: their onOpen / onLocate closures were new each time, so ListingCard's memo never held, and that
 * happened in the sync commits right after hydration. Here the closures are rebuilt only when the cards themselves change.
 */
/**
 * ⚡ MEMOIZED (phone home, 2026-11-25). The explorer re-renders right after hydration (its URL, its media flags, the seed's
 * counts), and every lane re-rendered with it: measured with a React commit probe, 6 lanes and everything under them (skeletons,
 * tiles, See all), ~460 components, all with shallow-equal props except `onCategory`, a fresh closure each render. The explorer
 * now passes a stable one (listings-explorer.tsx `onRailCategory`), so a lane re-renders only when its own props or state change.
 */
export const CategoryLane = memo(CategoryLaneView)

const LaneCards = memo(function LaneCards({ listings, lane, cardW }: { listings: readonly SerializedListingCard[]; lane: boolean; cardW: string }) {
  const router = useRouter()
  return listings.map((l) => (
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
})

/** "Browse by category" — one horizontal rail per category, the owner's lead order then live demand (the server's order),
 *  below the For You + Outstanding businesses rails under the desktop feed. `lanes`: visibleCategoryRails() of the
 *  server's rails, computed once by the explorer (the phone's lanes above the feed come from the same list). `onDrawn`: each
 *  rail's (CategoryLane), with no media of its own — this place is `max-sm:hidden`, so a phone never draws it. */
export function CategoryRails({ lanes, onCategory, onDrawn }: { lanes: readonly CategoryLaneData[]; onCategory: (slug: string) => void; onDrawn?: () => void }) {
  if (lanes.length === 0) return null
  return (
    <div className="space-y-7">
      {lanes.map(({ cat, items, slug, lost }) => (
        <CategoryLane key={slug} cat={cat} listings={items} onCategory={onCategory} onDrawn={onDrawn} lost={lost} />
      ))}
    </div>
  )
}
