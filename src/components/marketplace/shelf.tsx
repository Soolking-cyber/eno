'use client'

import Link from 'next/link'
import { Children, useEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { ChevronRight } from '@/components/ui/icons'
import type { IconComponent } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'

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
//  ⚠️ ALWAYS ONE STEP ABOVE THE CARD PRICE (D-TYPE, owner 2026-09-30): the card's <Price> is
//  text-base → sm:text-lg, so a text-lg title TIED it from sm up and the shelf read as a list of
//  prices with a caption. text-lg → sm:text-xl keeps 18>16 and 20>18; both have a 28px line box, so
//  the loading.tsx skeleton (h-7) still matches. Raise the price, raise this.
export const SECTION_TITLE = 'text-lg font-semibold text-foreground sm:text-xl'
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
 *  Was a copy-pasted literal in every rail. */
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
  'w-[calc((100%-0.5rem)/2)] shrink-0 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]'

/** Horizontal snap scroller, gaps matched to the feed grid (gap-2 / sm:gap-4).
 *  `overscroll-x-contain` keeps a sideways overscroll INSIDE the rail: without it, flicking
 *  a rail that is already at either end CHAINS the scroll out to the nearest scrollable
 *  ancestor (and, in the iOS WebView, hands the gesture to the swipe-back navigation).
 *  ⚠️ Honest limit: this only stops CHAINING. It cannot suppress the platform's own
 *  edge-swipe — a drag that STARTS in the screen-edge gutter is claimed by the system
 *  before the page sees it, and `touch-action` can't refuse it either
 *  (w3c/pointerevents#358). Containment is a real improvement, not a guarantee. */
export const RAIL_SCROLLER = 'flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none snap-x sm:gap-4'

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
  children: React.ReactNode
}) {
  const { tr } = useLanguage()
  const label = tr('See all', 'Xem tất cả')
  const seeAll = seeAllHref ? (
    <Link href={seeAllHref} className={SECTION_SEE_ALL}>
      {label} <ChevronRight className="h-4 w-4" />
    </Link>
  ) : seeAllOnClick ? (
    <Button variant="bare" size="none" className={SECTION_SEE_ALL} onClick={seeAllOnClick}>
      {label} <ChevronRight className="h-4 w-4" />
    </Button>
  ) : null

  // Desktop ← / → scroll arrows (see useScrollArrows): a mouse wheel scrolls only vertically and the
  // rail hides its scrollbar, so pointer users can't page it without a trackpad. Centre them on the
  // card PHOTO (data-rail-media), not the full card, so they sit level with the image.
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]', watch })

  return (
    <section className={sectionClassName}>
      <div className={SECTION_HEADER_ROW}>
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent-foreground" />}
          {/* Rail titles wrap (e.g. same-seller's "Tin khác từ {sellerName}" can be long) — but to TWO lines,
              then clamp with the full title on hover (break-ui, 2026-10-05): a 120-character shop name
              wrapped to five lines on the PDP. min-w-0 on the wrapper lets it wrap at all. */}
          <h2 title={typeof title === 'string' ? title : undefined} className={`${SECTION_TITLE} line-clamp-2 [overflow-wrap:anywhere]`}>{title}</h2>
        </div>
        {seeAll}
      </div>
      <RailBeam scrollerRef={scrollerRef} canRight={canRight} seedItems={Children.count(children)} />
      <div className="relative">
        <div ref={scrollerRef} className={RAIL_SCROLLER}>{children}</div>
        <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
      </div>
    </section>
  )
}
