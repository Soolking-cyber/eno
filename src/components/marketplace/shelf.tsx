'use client'

import Link from 'next/link'
import { Children, useEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { ChevronRight } from '@/components/ui/icons'
import type { IconComponent } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { SECTION_TITLE } from './section-title'
import { COMPACT_LIST_GRID } from './compact-listing-row-skeleton'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { LISTING_CARD_SIZES } from './listing-grid'
import { cn } from '@/lib/utils'

// Horizontal "shelf" rail primitive — the section header (optional icon + bold title +
// optional "See all") and the snap scroller that ~8 rails hand-rolled identically.

/** Sparse-catalogue floor for a curated rail (wow pass, 2026-08-06). Below three items a
 *  horizontal rail is two cards and a void — it manufactures the look of a dead shop.
 *  Rails hide themselves under this floor; the feed grid below still shows every listing,
 *  so nothing becomes unreachable. One constant so every rail agrees on "sensible minimum". */
export const MIN_RAIL_ITEMS = 3

/** How many card placeholders a rail draws while its own fetch is in flight.
 *  FOUR, because RAIL_CARD_W makes a card exactly one feed-grid column and the widest
 *  breakpoint shows four of them — so the placeholder row fills the viewport and no more.
 *  The rails each drew SIX against a MIN_RAIL_ITEMS floor of three, so a rail that
 *  resolved to three or four items visibly shrank as the answer landed. category-rails
 *  already reserved `min(listings.length, 4)`; this is the same number, named once. */
export const RAIL_SKELETON_COUNT = 4

/** ONE header treatment for every home section/rail (wow pass, 2026-08-06): same size,
 *  weight and margin everywhere, See-all right-aligned. Shelf consumes these; the rails
 *  that cannot use <Shelf> (category-rails' button-title, the landing feed heading)
 *  import the same strings instead of re-typing them — that re-typing is how the
 *  headers drifted apart in the first place. mb-3, not mb-2.5: the 8pt rhythm steps. */
export const SECTION_HEADER_ROW = 'mb-3 flex items-center justify-between gap-2'
//  The heading's size lives in section-title.ts (a plain module, so the listing page's server components share it):
//  always one step above the card price (D-TYPE, owner 2026-09-30). Re-exported for this file's client consumers.
export { SECTION_TITLE }
// `relative tap-44 active:opacity-60`: See all was 63x20 and answered a press with nothing on a Link
// (the Button call sites get ui/button's scale on top). The 44px area is a ::before, so it needs the
// `relative` beside it — see the tap-44 note in globals.css.
export const SECTION_SEE_ALL =
  'relative tap-44 flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent-foreground hover:underline active:opacity-60'

/* ⛔ CHIP_CATEGORY_ICON_STROKE (`[stroke-width:2]`) WAS DELETED 2026-08-07 — do not
   re-add it. It re-tiered a small category glyph by winning over the svg's own
   presentation attribute, which only worked while a category glyph WAS one svg. It is
   now two stacked layers (a tinted body under the ink line — category-icons.tsx), and a
   single inherited stroke-width would either miss both layers or flatten the tint into
   the line. The re-tier is a prop: <CategoryIcon stroke={STROKE_UI}>. */

/* ⛔ `railEdgeMask` WAS DELETED 2026-08-26 — do not re-add it. It spread a
   `linear-gradient` mask onto a rail's scroller so the tile at the cut edge faded instead of being
   sliced, driven by useScrollArrows' canLeft/canRight. Owner: *"remove these effects on sides of
   category model rails the cloudy effect"*.
   ⚠️ Its stated reason still stands and was accepted as a trade, not refuted: a tile clipped
   mid-glyph at the container edge does read as a rendering bug. The rails hard-clip now, on
   purpose. A painted gradient overlay is not the workaround either — the flat canon bans new fills,
   which is why this was a mask in the first place.
   ⚠️ useScrollArrows still supplies canLeft/canRight: the chevrons use them. Its comment about a
   40px fade on first paint is history, kept because it explains why the padding maths is there. */

/** Card width — pixel-matches the feed grid (2 cols mobile / 3 sm / 4 lg), so a rail card
 *  equals exactly one feed column and the rail reads as one family with the grid below.
 *  Was a copy-pasted literal in every rail.
 *  Each calc subtracts (columns − 1) × the column gap of LISTING_GRID (listing-grid.ts) at that
 *  breakpoint — 4px on a phone, 8px from sm since the owner's Facebook-spaced grid (2026-10-18) —
 *  and the percentage resolves against RAIL_SCROLLER's box, which bleeds exactly like the grid, so
 *  at 390 a rail card is (382 − 4) / 2 = 189px, the grid's own column. listing-grid.test.ts parses
 *  both strings and fails if they drift. */
/**
 * ⛔ NO `snap-start` HERE, AND THIS CONSTANT IS WHY IT MATTERED EVERYWHERE (owner, 2026-09-21:
 * "make springy action much less now its too much friction and frustrating to swipe").
 * Every product rail in the app takes its card width from this string, so a snap target on it put
 * one on EVERY card of EVERY rail. The scroller is `snap-x`, i.e. proximity — but proximity only
 * describes how hard it pulls, not how often: with a stop every half-viewport, a flick across a
 * 16-card rail is arrested at the first card the finger lifts near, so browsing took a dozen
 * swipes. The rail keeps `snap-x`, so a card that happens to come to rest near an edge still
 * ⚠️ With no `scroll-snap-align` on any child the container has NO snap points, so `snap-x`
 * is inert and the rail scrolls freely. That is the intent — but it does mean nothing "tidies
 * up" at rest, which an earlier version of this comment wrongly claimed.
 * ⚠️ The VIDEO feed keeps `snap-mandatory` on purpose — a full-screen pager must land on one video.
 */
export const RAIL_CARD_W =
  'w-[calc((100%-0.25rem)/2)] shrink-0 sm:w-[calc((100%-1rem)/3)] lg:w-[calc((100%-1.5rem)/4)]'

/** Horizontal snap scroller, gaps AND bleed matched to the feed grid: `-mx-2 … gap-1` on a phone (the
 *  grid's 8px bleed out of the `px-3` frame and its 4px column gap — owner, 2026-10-18), `sm:mx-0
 *  sm:gap-2` from sm. Every rail sits directly in the page frame (the explorer's #listings section, the
 *  PDP's <main>, the sold/gone pages' px-3 wrapper; the teacher shelf is a full-width row of the bled
 *  feed grid, which pads it back onto the gutter), so the bleed lands 4px from the screen edge, never
 *  past it.
 *  `overscroll-x-contain` keeps a sideways overscroll INSIDE the rail: without it, flicking
 *  a rail that is already at either end CHAINS the scroll out to the nearest scrollable
 *  ancestor (and, in the iOS WebView, hands the gesture to the swipe-back navigation).
 *  ⚠️ Honest limit: this only stops CHAINING. It cannot suppress the platform's own
 *  edge-swipe — a drag that STARTS in the screen-edge gutter is claimed by the system
 *  before the page sees it, and `touch-action` can't refuse it either
 *  (w3c/pointerevents#358). Containment is a real improvement, not a guarantee. */
/** Shelf `phoneGrid` below sm: the rail's scroller as the feed's two columns (the prop's note). */
export const PHONE_GRID = 'max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-1 max-sm:gap-y-4 max-sm:overflow-visible max-sm:snap-none max-sm:[&>*]:w-auto max-sm:[&>:last-child:nth-child(odd):not(:first-child)]:hidden'
/** Shelf `phoneGrid="goods"` below sm (owner-approved 2026-11-14, cook r06 goods): the goods search's grid continued — rows 32px
 *  apart like the results above it, and every card drawn (a thin search's "More in …" has no "See all" to hold an odd one). */
export const GOODS_PHONE_GRID = 'max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-1 max-sm:gap-y-8 max-sm:overflow-visible max-sm:snap-none max-sm:[&>*]:w-auto'
export const RAIL_SCROLLER = '-mx-2 flex gap-1 overflow-x-auto overscroll-x-contain scrollbar-none snap-x sm:mx-0 sm:gap-2'

/**
 * ⛔ THE HOME LANE — A RAIL'S PHONE LOOK ON THE HOME PAGE (owner-approved 2026-11-14, cook r04 home-b "lanes as rails": "after
 * this cook round build all best options and deploy"). Below `sm` a home shelf is a LANE: a strong heading (the redesign's
 * `t-h2`, 22/28 bold ink, no icon), then a rail of SAME-SIZE 220px cards, 12px apart, bled to the screen edges with the 12px
 * text edge as its padding — so the first card sits on the page's text edge and the second peeks (1.66 cards at 390: the
 * swipe is obvious). 220 is LARGER than the 189px feed column, never smaller, and the photo stays square (owner, 2026-11-14:
 * "dont change the product card ratio also dont make it smaller"). From `sm` every class here is inert, so a lane is the
 * rail it always was: each one is `max-sm:` on top of the rail's own string.
 * ⚠️ THE CARD'S TEXT IS FLUSH WITH ITS PHOTO in a lane (<ListingCard lane>): the photo already
 * starts on the 12px edge, so the feed's 8px inset would put the text 20px in, off the line every heading uses.
 * ⚠️ THE SWIPE BEAM STAYS (owner, 2026-08-27 — RailBeam below): the mock hid it, and that ruling was not among the ones the
 * owner reversed.
 */
export type RailLook = 'rail' | 'lane'
/** A lane's card: 220px (13.75rem) below `sm`; RAIL_CARD_W's columns from `sm`. */
export const LANE_CARD_W = `${RAIL_CARD_W} max-sm:w-55`
/** A lane's scroller: bled to the screen edges (the explorer's #listings frame is `px-3` on a phone), padded back onto the
 *  12px text edge, 12px between cards, and that same edge when the rail is scrolled to a card. */
export const LANE_SCROLLER = `${RAIL_SCROLLER} max-sm:-mx-3 max-sm:gap-3 max-sm:px-3 max-sm:scroll-px-3`
/** A lane card photo's `sizes`: the grid's own from `sm` (a lane is a rail there), a fixed 220px below it. */
export const LANE_CARD_SIZES = LISTING_CARD_SIZES.replace(/calc\(50vw - 6px\)$/, '220px')
/** A lane's heading row: the shared row, 28px tall at the least on a phone (the heading's own line). */
export const LANE_HEADER_ROW = `${SECTION_HEADER_ROW} max-sm:min-h-7`
/** A lane's heading: the redesign's section role on a phone (`t-h2`, 22/28, -0.02em, bold ink); SECTION_TITLE from `sm`. */
export const LANE_TITLE = `${SECTION_TITLE} max-sm:text-t-h2`
/** The heading icon a rail draws beside its title: none on a phone lane ("no icons in headings", the redesign's System). */
export const LANE_ICON_HIDE = 'max-sm:hidden'
/** See all's chevron: 18px on a phone lane (the redesign's See all: the label role in the accent, then an 18px chevron). */
export const LANE_CHEVRON = 'h-4 w-4 max-sm:size-4.5'

/**
 * A lane's cards, drawn once the lane nears the screen (a viewport ahead), with same-size placeholders until then — the gate
 * category-rails.tsx always had, shared so Outstanding businesses and the later category lanes use one rule. Server
 * rendered as placeholders, so a lane below the first screen costs the page's hydration nothing; the placeholder is the
 * card's own geometry (ListingCardSkeleton: the square photo and the 76px phone text block), so nothing moves when the
 * cards replace it. `show` from the start draws the cards on the server (the first lanes, on the first screen).
 */
export function useLaneGate(scrollerRef: RefObject<HTMLDivElement | null>, initialShow = false) {
  const [show, setShow] = useState(initialShow)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || show) return
    if (typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { setShow(true); io.disconnect() } },
      // A viewport ahead (was 400px): the cards' photos start loading only when the cards mount, and at a phone's
      // flick 400px was a third of a second — the rail arrived as placeholders (owner, 2026-11-12).
      { rootMargin: '100% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [scrollerRef, show])
  return show
}

/**
 * ⛔ A RAIL THAT IS NOT DRAWN YET SHOWS ITS SHAPE, NEVER AN EMPTY PAGE (owner, 2026-11-12: "on mobile landing page from
 * services downwards loads slow and upon scroll user sees big blank page"). Home holds the place of the shelves under its
 * feed from the first byte (listings-explorer.tsx DeferredShelf / DeferredCategoryRails) and draws them later; that place
 * was empty, so a quick scroll met 1,900px of nothing on a phone (measured on eno.vn at 390). This is the header row and a
 * row of card placeholders at the rail's own geometry (RAIL_CARD_W, the scroller's bleed and gaps), not scrollable.
 * Decorative: aria-hidden, and the caller clips it to the height it already reserves, so nothing moves when it goes.
 * Still, not sweeping (globals.css `.skeleton-still`): measured, the sweeps of every held place cost the scroll more than they say.
 */
export function ShelfSkeleton({ look = 'rail' }: { look?: RailLook } = {}) {
  const lane = look === 'lane'
  // `skeleton-still`: the colour without the sweep (globals.css) — ~90 sweeping boxes under the fold cost a phone's scroll.
  return (
    <div aria-hidden="true" className="skeleton-still">
      <div className={cn(SECTION_HEADER_ROW, 'h-7 sm:h-8')}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-14" />
      </div>
      {/* The scroller's own bleed and gaps (a lane's when it is one), clipped instead of scrolling. */}
      <div className={cn('-mx-2 flex gap-1 overflow-hidden sm:mx-0 sm:gap-2', lane && 'max-sm:-mx-3 max-sm:gap-3 max-sm:px-3')}>
        {Array.from({ length: RAIL_SKELETON_COUNT }, (_, i) => (
          <ListingCardSkeleton key={i} className={lane ? LANE_CARD_W : RAIL_CARD_W} />
        ))}
      </div>
    </div>
  )
}

/**
 * ⛔ THE SWIPE HINT — A COMPONENT, NOT A LINE OF JSX IN `Shelf`, AND THAT WAS THE WHOLE BUG.
 * Owner, 2026-08-27: a line beam travelling RIGHT TO LEFT above every horizontal carousel, "to
 * indicate they can swipe left". It was first written inline in `Shelf` on the reasoning that all
 * the rails route through it. They do not: measured on the live home page, SIX scrollers genuinely
 * overflow and only ONE is a `Shelf`. `category-rails.tsx` hand-rolls its own header and scroller
 * (its own comment says so — it "cannot use <Shelf>" because of the button-title), so Services,
 * Travel, Home and Fashion — the sections in the owner's screenshot — had no beam at all. The
 * owner's report was exactly right: "absolutely nothing no beam".
 * ⚠️ COUNT THE SCROLLERS, NOT THE SHELVES, when checking this reaches everything — and expect
 * FIVE beams against SIX overflowing scrollers, because the sixth is deliberately left bare: the
 * `role="group"` / "Categories" chip row is a FILTER, not a carousel of things to browse, and the
 * same goes for the facet bar, the mobile ladder and the PDP gallery (whose beam would land on the
 * photo). The hint means "there are more PRODUCTS this way". A reviewer read 6-vs-5 as the bug
 * recurring one instance smaller, which is the right instinct and the reason the number is written
 * down here rather than left to be re-derived.
 *
 * ⚠️ IT OWNS THE LATCH so a call site is one line and cannot forget the state. Given the scroller
 * ref it already has, every rail adds `<RailBeam scrollerRef={…} canRight={canRight} />`.
 *
 * ⛔ THE TEST IS POSITIONAL — `scrollLeft > 8` — AND IT IS SEEDED, NOT ONLY LISTENED FOR. Reading
 * the position on mount is what handles the reader who comes BACK: browser scroll restoration puts
 * a rail at 400px before any listener exists, so an event-only latch hears nothing and sweeps
 * "swipe left" at someone already halfway along it. A reviewer caught that, and caught the comment
 * that used to sit here claiming the threshold "excludes" restoration and arrow clicks. It does
 * not, and it should not: being positional is the point. Anything that moved the rail off its
 * start — finger, arrow button, restored history — means the reader is past needing the hint.
 */
/**
 * ⛔ THE BEAM IS SEEDED IN THE SERVER HTML (K-RAIL-PEEK option B, owner O-18, 2026-09-30). `canRight` is
 * measured in an effect, so until hydration every rail's beam was dark — on a phone cold load that is
 * the whole first seconds, exactly when a first-time reader is deciding whether the rail scrolls. The
 * caller passes how many items the rail holds, and from that alone (no measurement, so the server and
 * the hydration render agree) the beam states where the row MUST overflow: a card is one feed column
 * (RAIL_CARD_W — two to a phone row, three from `sm`, four from `lg`), so more items than columns
 * cannot fit. `data-swipe-seed` names the breakpoint the seed stops at and globals.css turns the light
 * off from there (`sm`, `lg`); `all` overflows everywhere.
 * ⚠️ THE SEED ONLY RULES UNTIL THE FIRST MEASUREMENT. The mount effect drops it, and from then on
 * `canRight` + the scroll latch decide exactly as before — so a seed that guessed wrong (a narrow
 * desktop window, OS text scaling) fades out through the same 220ms opacity transition instead of
 * popping. No card peek: the option chosen was the beam alone.
 */
export function railSwipeSeed(items: number | undefined): 'sm' | 'lg' | 'all' | undefined {
  if (items == null || items <= 2) return undefined
  if (items === 3) return 'sm'
  if (items === 4) return 'lg'
  return 'all'
}

export function RailBeam({ scrollerRef, canRight, seedItems }: {
  scrollerRef: RefObject<HTMLDivElement | null>
  canRight: boolean
  /** The rail's item count, for the pre-hydration seed (see `railSwipeSeed`). Omit for no seed. */
  seedItems?: number
}) {
  // False on the server and in the hydration render, true from the first effect — see railSwipeSeed.
  const [measured, setMeasured] = useState(false)
  useEffect(() => { setMeasured(true) }, [])
  /** ⚠️ PER MOUNT, NOT PER PERSON — deliberately `useState`. The owner asked for a beam above every
   *  carousel; remembering it forever in storage would quietly delete a thing that was asked for.
   *  What the latch buys is that it stops competing with the reader the moment they are already
   *  doing the thing it suggests. */
  const [everScrolled, setEverScrolled] = useState(false)

  // ⚠️ `canRight` IS IN THE DEPS AND IS NOT DECORATION. A ref OBJECT is stable forever, so a
  // dependency list of just the ref can never re-run — and if `scrollerRef.current` were null on
  // the first pass (a late-mounted or conditionally rendered scroller) the listener would never
  // attach and that rail would sweep for the whole session. `canRight` flips when a rail's content
  // arrives, which is exactly the moment worth re-checking.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || everScrolled) return
    if (el.scrollLeft > 8) { setEverScrolled(true); return }   // already moved before we got here
    const onScroll = () => { if (el.scrollLeft > 8) setEverScrolled(true) }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollerRef, everScrolled, canRight])

  // ⚠️ ALWAYS RENDERED, VISIBILITY TOGGLED BY THE ATTRIBUTE — dropping the element instead would
  // shift the rail by 1px the moment a late fetch makes it scrollable. `aria-hidden` because it
  // restates an affordance the scroller already exposes to assistive tech.
  // `pointer-events-none`: a decorative 2px line, but `position:relative` and later in the DOM than the
  // header row, so it sat ON TOP of See all's 44px hit area and took the bottom 3px of it (measured
  // with elementFromPoint: 42px instead of 44). A mark that means "this scrolls" must not take taps.
  return (
    <div
      className="rail-beam pointer-events-none"
      data-swipeable={canRight && !everScrolled ? '' : undefined}
      data-swipe-seed={measured ? undefined : railSwipeSeed(seedItems)}
      aria-hidden="true"
    />
  )
}

export function Shelf({
  title,
  icon: Icon,
  seeAllHref,
  seeAllOnClick,
  sectionClassName,
  watch,
  phoneRows,
  look = 'rail',
  deferCards,
  phoneGrid = false,
  children,
}: {
  title: React.ReactNode
  icon?: IconComponent
  /** "See all" as a link (storefront/seller rails) … */
  seeAllHref?: string
  /** … or as an action (category rails that push a filter). */
  seeAllOnClick?: () => void
  sectionClassName?: string
  /** Pass the rail's item COUNT when items arrive/refresh after mount (async fetch,
   *  localStorage hydration). Only the scroller's children change then — its own
   *  border box doesn't — so the arrows' ResizeObserver never re-fires and a rail
   *  that filled up after mount stays arrow-less forever (the brand-rail bug,
   *  2026-07-23). Threading the count into useScrollArrows re-syncs on change;
   *  harmless for server-seeded rails whose count never moves. */
  watch?: unknown
  /**
   * Below sm, rows instead of the rail (batch 67: a job page's rails, job-rail-rows.tsx). Both shapes are in the HTML and a class
   * picks one, as the Jobs list does (seller-listings.tsx, batch 60); the header and "See all" are shared. Without it the shelf
   * renders exactly as before.
   */
  phoneRows?: React.ReactNode
  /** 'lane': the home page's phone look (LANE_* above) — inert from `sm`. The caller sizes its cards (LANE_CARD_W). */
  look?: RailLook
  /**
   * Draw the cards only once the shelf nears the screen (useLaneGate); until then this many same-size placeholders hold the
   * row (the server renders the header and the placeholders). For a home lane below the first screen.
   */
  deferCards?: number
  /**
   * ⛔ BELOW sm, A TWO-COLUMN GRID INSTEAD OF THE RAIL (owner-approved 2026-11-14, cook r06 "item": the goods listing page's
   * shelves; src/lib/goods-sheet.ts). The same cards in the same scroller, laid out as the feed's grid — the same bleed
   * (`-mx-2`) and 4px columns, so a card is exactly a feed column (189px at 390; the cards keep their ratio and size, owner
   * 2026-11-14) — 16px between rows, no beam (it reverses there the beam above every carousel, owner 2026-08-27: a grid is
   * not a carousel), and every row full: an odd last card is not drawn ("See all" holds it). The heading takes the
   * redesign's phone section role (LANE_TITLE). From sm it is the rail it always was.
   * ⛔ 'goods' (owner-approved 2026-11-14, cook r06 goods — a thin search's "More in …" / Trending under the goods results): the
   * same grid with the results' 32px between rows, every card drawn (GOODS_PHONE_GRID), and no heading icon on a phone ("no
   * icons in headings"). It reverses there the rail-as-carousel of the thin-search recovery and its swipe beam (2026-08-27).
   */
  phoneGrid?: boolean | 'goods'
  children: React.ReactNode
}) {
  const { tr } = useLanguage()
  const lane = look === 'lane'
  const label = tr('See all', 'Xem tất cả')
  const chevron = <ChevronRight className={lane ? LANE_CHEVRON : 'h-4 w-4'} />
  const seeAll = seeAllHref ? (
    <Link href={seeAllHref} className={SECTION_SEE_ALL}>
      {label} {chevron}
    </Link>
  ) : seeAllOnClick ? (
    <Button variant="bare" size="none" className={SECTION_SEE_ALL} onClick={seeAllOnClick}>
      {label} {chevron}
    </Button>
  ) : null

  // Desktop ← / → scroll arrows (see useScrollArrows): a mouse wheel scrolls only vertically and the
  // rail hides its scrollbar, so pointer users can't page it without a trackpad. Centre them on the
  // card PHOTO (data-rail-media), not the full card, so they sit level with the image.
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]', watch })
  // A deferred lane (`deferCards`): placeholders at the card's own geometry until it nears the screen, then the cards.
  const shown = useLaneGate(scrollerRef, deferCards === undefined)
  const items = shown
    ? children
    : Array.from({ length: Math.min(deferCards ?? 0, RAIL_SKELETON_COUNT) }, (_, i) => (
        <ListingCardSkeleton key={i} className={lane ? LANE_CARD_W : RAIL_CARD_W} />
      ))

  return (
    // `data-shelf` / `data-shelf-items`: a shelf whose every item is a shop the viewer blocked goes as a whole — heading
    // and all — rather than leaving a title over an empty scroller (src/lib/hidden-sellers.ts, App Store 1.2).
    <section data-shelf="" data-lane={lane ? '' : undefined} className={sectionClassName}>
      <div className={lane ? LANE_HEADER_ROW : SECTION_HEADER_ROW}>
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className={cn('h-4 w-4 shrink-0 text-accent-foreground', (lane || phoneGrid === 'goods') && LANE_ICON_HIDE)} />}
          {/* Rail titles wrap (e.g. same-seller's "Tin khác từ {sellerName}" can be long) — but to TWO lines,
              then clamp with the full title on hover (break-ui, 2026-10-05): a 120-character shop name
              wrapped to five lines on the PDP. min-w-0 on the wrapper lets it wrap at all. */}
          <h2 title={typeof title === 'string' ? title : undefined} className={`${lane || phoneGrid ? LANE_TITLE : SECTION_TITLE} line-clamp-2 [overflow-wrap:anywhere]`}>{title}</h2>
        </div>
        {seeAll}
      </div>
      {phoneRows && <div data-phone-rows="" className={`${COMPACT_LIST_GRID} sm:hidden`}>{phoneRows}</div>}
      {/* ONE tree position for the rail, rows or not, so the scroller never remounts under useScrollArrows when `phoneRows`
          comes or goes (review, batch 67). A plain block box without them: the layout is the one it always was. */}
      <div className={phoneRows ? 'max-sm:hidden' : phoneGrid ? 'max-sm:[&_.rail-beam]:hidden' : undefined}>
        <RailBeam scrollerRef={scrollerRef} canRight={canRight} seedItems={deferCards ?? Children.count(children)} />
        <div className="relative">
          <div ref={scrollerRef} data-shelf-items="" className={lane ? LANE_SCROLLER : phoneGrid ? `${RAIL_SCROLLER} ${phoneGrid === 'goods' ? GOODS_PHONE_GRID : PHONE_GRID}` : RAIL_SCROLLER}>{items}</div>
          <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
        </div>
      </div>
    </section>
  )
}
