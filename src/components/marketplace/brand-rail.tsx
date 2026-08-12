'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BrandLogo } from './brand-logo'
import { CountChip, optionCount, railDimension } from './count-chip'
import { MoreOverflow } from './more-overflow'
import { railEdgeMask } from './shelf'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
// Type only — erased at compile time, so the client bundle never reaches for the module's
// Prisma/`server-only` chain. Imported rather than restated so the rail's prop and the payload
// the route ships are literally the same type.
import type { FacetCounts } from '@/lib/facet-counts'

type BrandItem = { slug: string; name: string; count: number; iconPath: string | null }

// Line 2 of the search header. Large, flat square brand tiles (logo in a square
// field + name + live count under, on the canvas — no fill) in one horizontally scrollable
// line. Tapping a brand filters by it and rolls its MODELS out to the right
// (pushing the brands after it); tapping again collapses. Matches the category
// rail's interaction + the home grid's flat look.
//
// ⚠️ TWO DIFFERENT COUNTS MEET IN THIS FILE AND THEY ANSWER DIFFERENT QUESTIONS. `/api/brands`
// returns a `count` per brand and per model scoped ONLY by category + subcategory — that is the
// directory figure this rail has always ORDERED itself by. `facets.brand` / `facets.model` are
// conditional: "how many results if I tap this, given the condition, price, district and
// everything else already chosen" (src/lib/facet-counts.ts). The conditional number is the one
// worth SHOWING; the directory number stays the one that ORDERS. See `sortedBrands` for why the
// order is deliberately not moved onto the conditional counts.
export function BrandRail({
  category,
  subcategory = 'all',
  activeBrand,
  activeModel,
  facets,
  onPickBrand,
  onPickModel,
}: {
  category: string
  subcategory?: string
  activeBrand: string
  activeModel: string
  /**
   * Live chip counts from the feed response's `facets` key (src/lib/facet-counts.ts).
   *
   * OMIT IT ENTIRELY and this rail is byte-for-byte the rail it was before counts existed: no
   * number on a brand tile, the `/api/brands` directory figure on the model chips. PASS `{}` and
   * it carries no numbers at all — because `{}` is a caller that knows about counts and has none
   * to give, which is a different statement from a caller that has never heard of them. See
   * `legacyModelCount`.
   *
   * ⚠️ AN ABSENT DIMENSION IS "NOT COMPUTED", NEVER ZERO — `facets` is `{}` for `offset > 0`, with
   * `?facets=0`, and whenever the computation is shed or fails (all whole-payload states, never
   * per-dimension). ⚠️ THE CALLER MUST NOT OVERWRITE A COMPUTED PAYLOAD WITH AN EMPTY ONE, AND
   * MUST REPLACE IT WHOLESALE RATHER THAN MERGING DIMENSIONS, AND MUST DROP IT WHEN THE FILTER
   * SIGNATURE CHANGES — that last one is the obligation no component can take over, because the
   * payload does not say which filters produced it. See the full note on <CategoryRail>.
   *
   * ⚠️ `facets.model` ONLY EXISTS ONCE A BRAND IS CHOSEN, which is also the only time this rail
   * renders a model grid, so the two appear together. It arrives because the explorer sends
   * `priorityCategory` (not `category`) once a brand is picked and `defaultDimensions()` reads
   * both — if that ever changes, tap four goes numberless first.
   */
  facets?: FacetCounts
  onPickBrand: (slug: string) => void
  onPickModel: (model: string) => void
}) {
  const { tr } = useLanguage()
  // Desktop ← / → arrows, same as the home rails (owner, 2026-07-22: "category brand reels
  // also need arrows like in home page"). The hook's ref IS the rail element, so it also
  // serves the auto-centre-the-active-brand effect below — one node, one ref.
  const [brands, setBrands] = useState<BrandItem[]>([])
  const { scrollerRef: railRef, canLeft, canRight, page, arrowTop } = useScrollArrows<HTMLDivElement>({ watch: brands.length })
  const [models, setModels] = useState<{ model: string; count: number }[]>([])
  // Read through refs inside the fetch effects so validating the CURRENT pick
  // doesn't add it to the deps (which would refetch on every brand/model tap).
  const pick = useRef({ activeBrand, activeModel, onPickBrand, onPickModel })
  pick.current = { activeBrand, activeModel, onPickBrand, onPickModel }

  // Slide the rail so the chosen brand sits at the left edge, models rolled out beside it.
  useEffect(() => {
    // Only scroll when OPENING a brand; on close/clear keep the scroll position.
    if (activeBrand === 'all') return
    const container = railRef.current
    const el = container?.querySelector(`[data-brand="${activeBrand}"]`) as HTMLElement | null
    if (!container || !el) return
    // Scroll ONLY this rail — NOT via el.scrollIntoView, which walks up and scrolls
    // every scrollable ancestor (incl. the document), shifting the whole results view
    // sideways and clipping the left edge. Move the container's own scrollLeft instead.
    const left = container.scrollLeft + (el.getBoundingClientRect().left - container.getBoundingClientRect().left)
    container.scrollTo({ left, behavior: 'smooth' })
  }, [activeBrand])

  useEffect(() => {
    let off = false
    fetch(`/api/brands?category=${encodeURIComponent(category)}&subcategory=${encodeURIComponent(subcategory)}&limit=40`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        const list: BrandItem[] = d.brands || []
        setBrands(list)
        // Hierarchy is category → subcategory → brand → model: a brand picked
        // under one scope may not exist in the next (Honda under Motorbike →
        // switch to Bicycle). Clear it instead of filtering the feed to zero.
        const { activeBrand: cur, onPickBrand: pb, onPickModel: pm } = pick.current
        if (cur !== 'all' && !list.some((b) => b.slug === cur)) { pb('all'); pm('all') }
      })
      .catch(() => { if (!off) setBrands([]) })
    return () => { off = true }
  }, [category, subcategory])

  useEffect(() => {
    if (activeBrand === 'all') { setModels([]); return }
    let off = false
    setModels([])
    fetch(`/api/brands/${encodeURIComponent(activeBrand)}/models?category=${encodeURIComponent(category)}&subcategory=${encodeURIComponent(subcategory)}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        const list: { model: string; count: number }[] = d.models || []
        setModels(list)
        // Same healing one level down: a model picked under one scope may not
        // exist for this (brand, category, subcategory) — drop the stale pick.
        const { activeModel: cur, onPickModel: pm } = pick.current
        if (cur !== 'all' && !list.some((m) => m.model === cur)) pm('all')
      })
      .catch(() => {})
    return () => { off = true }
  }, [activeBrand, category, subcategory])

  if (brands.length === 0) return null

  // The two rails' conditional counts. `brand` is present whenever the category has a brand rail;
  // `model` only once a brand is chosen, which is exactly when the model grid exists.
  //
  // ⚠️ BOTH GO THROUGH `railDimension`, AND ON THIS RAIL IT IS LOAD-BEARING RATHER THAN A NO-OP.
  // The tiles come from /api/brands — ONE round trip, refetched on every category/subcategory
  // change — while `facets` rides the feed response, which can lag it by seconds (semanticRank).
  // So after a category switch this component genuinely re-renders new brands against the PREVIOUS
  // category's `brand` dimension, whose keys are all misses, and a miss inside a present dimension
  // is a legitimate 0: every tile would read "0" over a full catalogue for that whole window.
  // Requiring one overlapping key turns that state back into "no numbers yet", which is what the
  // rail looked like before counts existed. Neither dimension is zero-seeded (their option lists
  // are data-driven), so nothing else here can tell a stale payload from a fresh one.
  const brandDim = railDimension(facets?.brand, brands.map((b) => b.slug))
  const modelDim = railDimension(facets?.model, models.map((m) => m.model))

  /**
   * The /api/brands directory count for a model chip, used ONLY by a caller that knows nothing
   * about facets.
   *
   * ⚠️ THE CONDITION IS "THE PROP WAS NEVER PASSED", NOT "THIS DIMENSION IS MISSING", AND THE
   * DIFFERENCE IS THE WHOLE POINT. Falling back whenever `modelDim` is absent puts an
   * UNCONDITIONAL number (scoped only by category+subcategory) in the same type, on the same row,
   * as the conditional ones — and the state that makes that indefensible is a brand filtered to
   * zero: `facets.model` comes back empty, is indistinguishable from a stale payload, gets
   * suppressed, and every chip would then advertise "Vision 30" over zero results while the "All"
   * chip beside it showed nothing. Keying on `facets === undefined` instead means exactly one
   * thing: this call site predates counts, so give it the rail it had. The moment a caller passes
   * anything — even `{}` — this rail speaks only in conditional counts or in silence.
   *
   * It exists at all so that wiring the explorer can be a SEPARATE commit from this one without a
   * window where the model chips silently lose the numbers they have had all along.
   */
  const legacyModelCount = (m: { count: number }) => (facets === undefined ? m.count : undefined)

  // Most-used first (by listing count). Full-width swipeable rail like the category row
  // (user decision 2026-07-06): every brand rides the horizontal scroll — no More dropdown.
  //
  // ⚠️ THE ORDER STAYS ON THE `/api/brands` DIRECTORY COUNT EVEN THOUGH THE NUMBER SHOWN IS THE
  // CONDITIONAL ONE, AND THAT IS A DELIBERATE, MEASURED TRADE. Ranking on the facet counts would
  // re-sort this strip every time the FEED response lands — and the feed response can lag the
  // brand list by seconds, because /api/listings awaits `semanticRank`, which is allowed up to
  // 2.5s on a Vertex call (src/app/api/listings/route.ts), while /api/brands answers in one round
  // trip. So the rail would paint in one order, sit still long enough to be reached for, and then
  // re-order under the finger: the exact failure a ranked rail must not have. The directory order
  // instead arrives with the tiles themselves, in one moment, and never moves afterwards — the
  // brand and model count bases both RELEASE brand+model, so even tapping a brand or a model does
  // not change these numbers.
  // The visible cost, stated rather than discovered: the numbers are then not monotonic down the
  // rail — under `?condition=new` a Honda showing 1 can sit ahead of a Yamaha showing 12, and on a
  // phone (about four tiles in view) the first screenful can read all zeros with the stocked brand
  // off to the right. That is the sharpest form of this trade and it is still the right one,
  // because NOTHING IS HIDDEN: every brand rides the same swipe the rail already invites, so the
  // answer is one gesture away and it never moves while being reached for. Contrast the model grid
  // below, which CUTS at seven — a cut is where an order stops being presentation and starts
  // deciding what exists, which is why that one ranks on the number it shows and this one does not.
  const sortedBrands = [...brands].sort((a, b) => b.count - a.count)

  /**
   * ⚠️ THE MODEL GRID RANKS ON THE NUMBER IT SHOWS, AND THE BRAND RAIL DOES NOT. That is not an
   * inconsistency, it is the rule: A RAIL THAT CUTS MUST CUT ON THE NUMBER IT DISPLAYS.
   *
   * Every brand rides the horizontal scroll — no "More", nothing hidden (user decision
   * 2026-07-06) — so ordering the tiles by the stable directory count costs a reader nothing and
   * buys a strip that never moves. The model grid is the opposite shape: 3×3, seven visible and
   * the rest folded into "+N". Cutting THAT on the directory count while showing conditional ones
   * hides options for a reason the numbers contradict — a reviewer's case, verified against this
   * code: Vehicles → Honda → condition=new, where the only in-stock model sits at directory rank
   * 9. The grid would read "All 3 / Vision 0 / Wave 0 / …" with the one tappable option buried in
   * More, and the brand would read as empty when it is not.
   *
   * The cost is the one the brand tiles refuse: this grid can re-order once, when the feed answers
   * after the models fetch. Accepted here and not there because the grid has only just rolled out
   * from a tap, everything in it stays reachable through "More", the ACTIVE model is promoted out
   * of the overflow whatever it ranks (see `visibleModels`), and the alternative is hiding the
   * answer. It falls back to the directory count per model, so an unwired caller keeps today's
   * exact order.
   *
   * ⚠️ THE DIRECTORY COUNT IS ALSO THE TIE-BREAK, AND WITHOUT IT THE ZEROES WOULD SCRAMBLE. Under
   * a narrow filter most models rank 0, and `Array.prototype.sort` is stable — so every tie would
   * simply keep the order /api/brands returned, which is its DEMAND ranking (views + 5×contacts,
   * see the models route), not size. Losing the size ordering inside "+N" is a real regression
   * against what this grid does today, and one extra comparison closes it: rank first, size
   * second, and the demand order still breaks the remaining ties underneath.
   */
  const modelRank = (m: { model: string; count: number }) => optionCount(modelDim, m.model) ?? m.count
  const sortedModels = [...models].sort((a, b) => modelRank(b) - modelRank(a) || b.count - a.count)
  // 3×3 grid (9 cells): "All" + up to 8 models fills it exactly, so only collapse into
  // a "More" cell when there are MORE than 8 — at ≤8 show them all.
  const modelsNeedMore = sortedModels.length > 8
  const visibleModels = modelsNeedMore ? sortedModels.filter((m, i) => i < 7 || m.model === activeModel) : sortedModels
  const overflowModels = modelsNeedMore ? sortedModels.filter((m, i) => i >= 7 && m.model !== activeModel) : []

  const tileCls = 'group flex w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 py-1 text-center cursor-pointer select-none'
  // ⚠️ w-full + break-words — same containment as category-rail. The span is a flex item
  // under `items-center`, so without w-full its width is fit-content and a long brand name
  // ("Mercedes-Benz", or anything once OS text scaling is on) spills outside the fixed
  // 4.75rem tile instead of wrapping into the line-clamp. break-words covers a single
  // unbreakable wordmark that is wider than the tile on its own.
  const nameCls = (active: boolean) =>
    cn('line-clamp-2 w-full break-words text-xs font-bold leading-tight transition-colors', active ? 'text-accent-foreground' : 'text-foreground group-hover:text-accent-foreground')
  const modelChip = (active: boolean) =>
    cn('w-full shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors cursor-pointer', active ? 'bg-card text-accent-foreground shadow-sm' : 'text-body hover:bg-card/70 hover:text-accent-foreground')

  return (
    // `relative` anchors the arrows, which sit OUTSIDE the scroller's edges (-left-8).
    <div className="relative">
    <div
      ref={railRef}
      // overscroll-x-contain: a sideways flick that hits either end must not CHAIN out to an
      // ancestor scroller / the iOS WebView's swipe-back. It does not (and cannot) stop a swipe
      // that STARTS in the system edge gutter — see the note on RAIL_SCROLLER in shelf.tsx.
      // railEdgeMask: fade — never hard-clip — the tile at the cut edge (see shelf.tsx).
      style={railEdgeMask(canLeft, canRight)}
      className="flex items-center gap-4 overflow-x-auto overscroll-x-contain scrollbar-none snap-x py-1"
    >
      {sortedBrands.map((b) => {
        const isActive = activeBrand === b.slug
        return (
          <Fragment key={b.slug}>
            {/* whitespace-normal: the base is whitespace-nowrap and white-space INHERITS,
                which would turn the line-clamp-2 brand name into one unwrappable line. */}
            <Button
              variant="bare"
              size="none"
              // ⚠️ iconSize={false} is REQUIRED. ui/button's base carries `[:where(&)_svg]:size-4`,
              // which out-specificities the BrandLogo svg's width/height ATTRIBUTES (presentational
              // attrs = specificity 0) and silently shrank the mark to 16px — the CategoryIcon dodged
              // it only because it sets h-11/w-11 CLASSES. Turning the rule off lets `size={48}` land.
              iconSize={false}
              data-brand={b.slug}
              onClick={() => { onPickBrand(isActive ? 'all' : b.slug); onPickModel('all') }}
              className={cn(tileCls, 'whitespace-normal')}
            >
              {/* Logo sits in the same h-11 box as the category icon, but at 48px (not 44) so a
                  brand MARK — which carries less internal ink than a full-bleed line icon, and is
                  short on wordmark brands (Samsung) — reads as visually the SAME size as the
                  category glyphs beside it. The 4px overflow is centered in the (un-clipped) box. */}
              <span className="flex h-11 items-center justify-center">
                <BrandLogo
                  name={b.name}
                  iconPath={b.iconPath}
                  size={48}
                  flat
                  className={cn('transition-transform duration-200 group-hover:scale-110', isActive ? '!text-accent-foreground' : '!text-body group-hover:!text-accent-foreground')}
                />
              </span>
              {/* ⛔ NO COUNT UNDER THE BRAND NAME (owner, 2026-08-12: "remove counters under
                  categories and brands"). The paragraphs that stood here argued the cost of one:
                  the tiles arrive from /api/brands in one round trip while the counts ride the
                  feed response, so with a text query active the strip could grow a text line a
                  beat AFTER the rail appeared and push the grid down. That whole class of shift
                  is gone with the line. The category rail lost the same second line for the same
                  instruction; the two rails are meant to read identically.
                  ⚠️ THE MODEL CHIPS BELOW KEEP THEIR INLINE COUNTS, including their `b.count`
                  fallback — see their own note. The instruction is about the figure UNDER a tile
                  name, and a chip's count reads as part of the chip. */}
              <span className={nameCls(isActive)}>{b.name}</span>
            </Button>

            {/* Models roll out to the right of the active brand */}
            {isActive && models.length > 0 && (
              <div className="flex shrink-0 items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                <span className="h-12 w-px shrink-0 bg-border" />
                {/* 3×3 grid (column-fill): All first, 7 most-used in between, More last. */}
                <div className="grid grid-rows-3 grid-flow-col auto-cols-max gap-x-1.5 gap-y-0.5 rounded-2xl bg-brand-50 p-1.5">
                  {/* justify-start: the base CENTRES, these chips are full-width text-left rows.
                      gap-0 for the same reason as the model chips below — the count's spacing is
                      its own ml-1, and the base gap-2 would double it.
                      "All" = the model rail released with the brand still applied, so it is the
                      chosen brand's total under the current filters — legitimately larger than
                      the model chips sum to, since a listing with no `model` set comes back when
                      the rail is cleared. Never rendered as a sum of what is on screen. */}
                  <Button variant="bare" size="none" onClick={() => onPickModel('all')} className={cn(modelChip(activeModel === 'all'), 'justify-start gap-0')}>
                    {tr('All', 'Tất cả')}
                    <CountChip count={modelDim?.all} className="ml-1" />
                  </Button>
                  {visibleModels.map((m) => {
                    const mActive = activeModel === m.model
                    return (
                      // gap-0 too: the count's spacing comes from its own ml-1; the base gap-2 would double it.
                      <Button
                        key={m.model}
                        variant="bare"
                        size="none"
                        onClick={() => onPickModel(mActive ? 'all' : m.model)}
                        className={cn(modelChip(mActive), 'justify-start gap-0')}
                      >
                        {m.model}
                        {/* ⚠️ NO `?? m.count` FALLBACK, AND REMOVING IT WAS A CORRECTION. The first
                            version fell back to the /api/brands directory figure whenever the
                            conditional one was unavailable, on the reasoning that keeping today's
                            number is the gentlest degrade. Two reviewers showed where that lands:
                            filter a brand down to nothing and `facets.model` arrives empty, which
                            `railDimension` cannot distinguish from a stale payload, so it is
                            suppressed — and every chip would then advertise the UNFILTERED count
                            ("Vision 30" over zero results) while the "All" chip beside it, which
                            has no fallback, showed nothing. Two number semantics, identical
                            styling, one screen. One rail, one question: this chip carries the
                            conditional count or no count at all. `optionCount` already returns 0
                            rather than undefined for a real miss, so a genuine dead end still
                            reads "0". The one exception is a caller that has not been wired for
                            counts at all — see `legacyModelCount`. */}
                        <CountChip count={optionCount(modelDim, m.model) ?? legacyModelCount(m)} className="ml-1" />
                      </Button>
                    )
                  })}
                  {overflowModels.length > 0 && (
                    <MoreOverflow count={overflowModels.length}>
                      {overflowModels.map((m) => {
                        const mActive = activeModel === m.model
                        return (
                          // All four base-colliding classes ride the BUTTON: w-full (the base is
                          // inline-flex), justify-between (the base CENTRES), gap-3 (the base gap-2)
                          // and font-semibold (the base font-medium would inherit into the spans).
                          <Button
                            key={m.model}
                            variant="bare"
                            size="none"
                            onClick={() => onPickModel(mActive ? 'all' : m.model)}
                            className={cn('w-full justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold transition-colors active:scale-100', mActive ? 'bg-accent text-accent-foreground' : 'text-body hover:bg-muted hover:text-accent-foreground')}
                          >
                            <span className="truncate">{m.model}</span>
                            <CountChip count={optionCount(modelDim, m.model) ?? legacyModelCount(m)} className="shrink-0" />
                          </Button>
                        )
                      })}
                    </MoreOverflow>
                  )}
                </div>
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
      <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} tight />
    </div>
  )
}
