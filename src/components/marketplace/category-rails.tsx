'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from '@/components/ui/icons'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { CategoryIcon } from './category-icons'
import { fetchTimeLimit } from '@/lib/fetch-time-limit'
import { RAIL_CARD_W, RAIL_SCROLLER, MIN_RAIL_ITEMS, RAIL_SKELETON_COUNT, SECTION_HEADER_ROW, SECTION_TITLE, SECTION_SEE_ALL, RailBeam } from './shelf'
import { STROKE_UI } from '@/lib/icon-tokens'
import { useLanguage } from '@/context/language-context'
import { Bilingual } from './bilingual'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FILTER_KEYS = ['category', 'q', 'brand', 'subcategory', 'type', 'district', 'province', 'ward', 'condition', 'priceMin', 'priceMax']

type Rail = { slug: string; listings: SerializedListingCard[] }

/**
 * ⛔ THE ANSWER CAN BE ASKED FOR BEFORE THE RAILS ARE DRAWN (owner, 2026-11-12: "from services downwards loads slow").
 * Home draws these rails only when the reader nears them, and they then waited for this chunk AND for
 * /api/category-rails (1.3s on eno.vn, not edge-cached) before showing anything. Home now calls
 * `prefetchCategoryRails` at its first idle moment after `load` (listings-explorer.tsx DeferredCategoryRails), never
 * earlier, so neither competes with the first paint; the first CategoryRails to mount takes that answer instead of asking.
 * ONE SLOT, whatever the language (review): the latest ask, a prefetch or a mount's own.
 * - TAKEN ONCE: a later mount (a return to Home, a language switch) asks afresh, as it always did.
 * - Never on a directed feed (urlIsFiltered): the rails hide there, so the answer would go unused.
 * - An untaken answer older than PREFETCH_MAX_AGE_MS is not shown; a prefetch does not repeat an ask (either kind) younger
 *   than PREFETCH_REPEAT_MS, so a mount that asked first is not asked twice, and a Home visited again gets a fresh one.
 * - A prefetch that fails — before the mount or while it waits — is asked again by the mount, never shown as "no rails".
 */
// ONE MINUTE (review): an answer shown later than this could still carry a listing taken down since (a licence hold, a
// moderation unpublish), on top of the answer's own browser cache (max-age=120) — at most ~3 minutes in all, against ~2
// before the prefetch. A reader who pauses longer than this before reaching the rails gets a fresh ask, as before.
const PREFETCH_MAX_AGE_MS = 60_000
const PREFETCH_REPEAT_MS = 60_000
let asked: { lang: string; at: number; answer: Promise<Rail[] | null>; taken: boolean } | null = null

function askRails(lang: string): Promise<Rail[] | null> {
  // A time limit, because the caller holds 1,400px or more of the page until this answers.
  // ⛔ `lang` IN THE URL, as the feed sends it (listings-explorer.tsx): the answer then carries only this
  // reader's title translations instead of nine languages, and any shared cached copy is keyed by it.
  return fetch(`/api/category-rails?lang=${encodeURIComponent(lang)}`, { signal: fetchTimeLimit(10_000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { rails?: Rail[] } | null) => (d ? d.rails || [] : null))
    .catch(() => null)
}

/** A query or filter in the URL: the rails hide (the same signal the For You rail uses). */
function urlIsFiltered(): boolean {
  const p = new URLSearchParams(window.location.search)
  return FILTER_KEYS.some((k) => p.has(k)) || Array.from(p.keys()).some((k) => k.startsWith('attr_') || k.startsWith('range_'))
}

export function prefetchCategoryRails(lang: string) {
  if (urlIsFiltered()) return
  if (asked && asked.lang === lang && Date.now() - asked.at < PREFETCH_REPEAT_MS) return
  asked = { lang, at: Date.now(), answer: askRails(lang), taken: false }
}

function takeRails(lang: string): Promise<Rail[] | null> {
  const prior = asked
  if (prior && prior.lang === lang && !prior.taken && Date.now() - prior.at < PREFETCH_MAX_AGE_MS) {
    prior.taken = true
    return prior.answer.then((answer) => answer ?? askRails(lang))
  }
  const answer = askRails(lang)
  asked = { lang, at: Date.now(), answer, taken: true }
  return answer
}

/** One category rail. The cards (and therefore their images) only mount once the rail
 *  scrolls near the viewport — with up to ~10 rails on the home page, mounting every
 *  card up front flooded the page with images. A same-height skeleton holds the space
 *  so there's no layout shift. */
function CategoryRail({ cat, listings, onCategory }: { cat: SerializedCategory; listings: SerializedListingCard[]; onCategory: (slug: string) => void }) {
  const { tr } = useLanguage()
  const router = useRouter()
  // The scroller ref is shared: the hook drives the ← / → arrows AND the lazy-mount IntersectionObserver.
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]' })
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || show) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setShow(true); io.disconnect() } },
      // A viewport ahead (was 400px): the cards' photos start loading only when the cards mount, and at a phone's
      // flick 400px was a third of a second — the rail arrived as placeholders (owner, 2026-11-12).
      { rootMargin: '100% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [show])

  return (
    <section>
      {/* The header is the SHARED treatment (SECTION_* from shelf.tsx) so this rail cannot
          drift from the <Shelf> rails around it — it hand-rolled the same row before and had
          already drifted. The h2 WRAPS the button (heading > button is valid phrasing
          content); the reverse — a heading inside a <button> — is invalid HTML → React #418,
          which is why the title text itself stays a span. */}
      <div className={SECTION_HEADER_ROW}>
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
                component has none. */}
            <CategoryIcon name={cat.icon} stroke={STROKE_UI} className="h-4 w-4 text-accent-foreground" />
            <span className={cn(SECTION_TITLE, 'transition-colors group-hover:text-accent-foreground')}>
              <Bilingual en={cat.name} vi={cat.nameVi || cat.name} />
            </span>
          </Button>
        </h2>
        <Button variant="bare" size="none" onClick={() => onCategory(cat.slug)} className={SECTION_SEE_ALL}>
          {tr('See all', 'Xem tất cả')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {/* ⚠️ THE SWIPE BEAM BELONGS HERE TOO — this rail does NOT go through <Shelf>, which is
          exactly why the first version of the hint missed Services, Travel, Home and Fashion. */}
      <RailBeam scrollerRef={scrollerRef} canRight={canRight} />
      {/* Cards pixel-match the feed grid (RAIL_SCROLLER / RAIL_CARD_W: its bleed and gaps, one card == one grid column). */}
      <div className="relative">
        <div ref={scrollerRef} className={RAIL_SCROLLER}>
          {show
            ? listings.map((l) => (
                <div key={l.id} data-sid={l.sellerId} className={RAIL_CARD_W}>
                  <ListingCard
                    listing={l}
                    onOpen={(x) => router.push(`/listings/${x.id}`)}
                    onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                  />
                </div>
              ))
            : // Same-size skeletons hold the row height until it mounts (no images, no shift).
              Array.from({ length: Math.min(listings.length, RAIL_SKELETON_COUNT) }).map((_, i) => (
                <ListingCardSkeleton key={i} className={RAIL_CARD_W} />
              ))}
        </div>
        <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
      </div>
    </section>
  )
}

/** "Browse by category" — one horizontal rail per category, ordered by live demand so
 *  the most-used category leads (mirrors the category-icon hierarchy). Sits below the
 *  For You + Outstanding businesses rails on the home landing view; hides the moment a
 *  filter/search is active.
 *  `excludeIds`: listings the rails ABOVE already showed (For You / Outstanding seeds) —
 *  on a 13-listing catalogue the same card in three adjacent rails reads as padding, not
 *  supply. Each rail dedups against it and hides below the shared sparse floor. */
export function CategoryRails({ categories, onCategory, excludeIds, onAnswer, fallback }: { categories: SerializedCategory[]; onCategory: (slug: string) => void; excludeIds?: string[]; onAnswer?: (a: 'rails' | 'none') => void; /** Drawn while the answer is awaited — the caller's placeholder, so the hand-over from it is seamless. */ fallback?: React.ReactNode }) {
  const { lang } = useLanguage()
  const [rails, setRails] = useState<Rail[] | null>(null)
  const [active, setActive] = useState(true) // default (unfiltered) home view?

  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories])
  const exclude = useMemo(() => new Set(excludeIds ?? []), [excludeIds])

  useEffect(() => {
    let off = false
    // Asked again when the language changes in place (English ⇄ a machine-translated one does not reload), or
    // the cards would fall back to translating on the client (askRails has the URL's rules).
    // A failed re-ask keeps the rails already shown (their titles still translate on the client); only a
    // first ask that fails answers none.
    // ⚠️ Measured in a browser 2026-11-11: an in-place language switch on Home REMOUNTS this component today, so that
    // re-ask is a first ask and a failure there shows no rails (the live build does the same). The keep only helps
    // where the component survives the switch.
    void takeRails(lang).then((answer) => { if (!off) setRails((prev) => answer ?? prev ?? []) })
    return () => { off = true }
  }, [lang])

  // Hide when the feed is filtered/searched (same signal the For You rail uses).
  useEffect(() => {
    const check = () => setActive(!urlIsFiltered())
    check()
    window.addEventListener('eno:query', check)
    window.addEventListener('popstate', check)
    return () => { window.removeEventListener('eno:query', check); window.removeEventListener('popstate', check) }
  }, [])

  // Dedup + sparse floor BEFORE render: drop cards the rails above already showed, then hide
  // any rail that falls below MIN_RAIL_ITEMS — a category heading over one or two cards is
  // manufactured density, and every listing still appears in the feed grid below. Computed
  // first so that when NOTHING survives we return null instead of an empty in-flow div —
  // inside the landing's space-y container even a zero-height div earns a full 32-48px
  // spacing unit (the exact phantom-band failure the deferred wrapper above defends against).
  const visible = (rails ?? [])
    .map((rail) => {
      const cat = bySlug.get(rail.slug)
      if (!cat) return null
      const items = rail.listings.filter((l) => !exclude.has(l.id))
      if (items.length < MIN_RAIL_ITEMS) return null
      return { cat, items, slug: rail.slug }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  // The caller holds this block's place until there is an answer. Filtered away lets the place go too: this
  // stays mounted, and clearing the filter brings the rails back (eno:query).
  const answer = !active || (rails !== null && visible.length === 0) ? 'none' : rails !== null ? 'rails' : null
  useEffect(() => { if (answer) onAnswer?.(answer) }, [answer, onAnswer])

  if (!active) return null
  if (rails === null) return fallback ?? null // wait for data, in the caller's placeholder
  if (visible.length === 0) return null

  return (
    <div className="space-y-7">
      {visible.map(({ cat, items, slug }) => (
        <CategoryRail key={slug} cat={cat} listings={items} onCategory={onCategory} />
      ))}
    </div>
  )
}
