'use client'

import { useId, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { MapPin, ChevronDown, SlidersHorizontal, X } from '@/components/ui/icons'
import { CustomSelect } from './custom-select'
import { PriceRangeFilter } from './price-range-filter'
import { RangeFacetControl } from './range-facet-control'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLanguage } from '@/context/language-context'
import { facetsFor, typesFor, LISTING_TYPES, type ListingType, type FacetDef } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'
import { formatCount, moneyLocale } from '@/lib/vnd'
// The chip counter's SPOKEN form. Reused rather than re-worded: this helper already groups per
// language and already knows Vietnamese has no plural -s, and it is unit-tested for both.
import { resultCountLabel } from './result-line'
// ⚠️ TYPE-ONLY, AND IT HAS TO STAY THAT WAY. src/lib/facet-counts.ts reaches
// edition-scope.ts → `import 'server-only'` → src/lib/db.ts, so a VALUE import from it in this
// 'use client' file is a build error (and worse: vitest aliases `server-only` to a no-op module,
// so the unit suite would stay green while the build broke). `import type` is erased by SWC
// before the client graph is walked, so the shape travels and the module does not. That is also
// why the year-band rail is NOT built here — see the note on `facetCounts` below.
import type { DimensionCounts, FacetCounts } from '@/lib/facet-counts'

/* ── LIVE CHIP COUNTS ────────────────────────────────────────────────────────────────────────────
 * "How many results do I get if I tap this?", on every chip this bar draws. The numbers are
 * computed server-side (src/lib/facet-counts.ts) and arrive under the feed response's `facets` key;
 * this file only READS them. Three properties of that payload are load-bearing here:
 *
 * ⚠️ AN ABSENT DIMENSION MEANS "NOT COMPUTED", NEVER ZERO. `facets` is `{}` on a load-more page
 * (offset > 0) and with `?facets=0`, and a dimension the active category has no rail for is simply
 * missing. Every one of those must degrade to the bar's PREVIOUS, COUNTLESS APPEARANCE — a row of
 * zeros would state, falsely, that every filter is empty. That is what the `number | null` split
 * below is for: `null` = render no count, `0` = render an honest zero.
 *
 * ⚠️ THE CHIPS COME FROM THE TAXONOMY; `values` IS ONLY A LOOKUP. Never build a rail from
 * `Object.keys(values)`. The payload honestly reports whatever the DATA carries — a legacy `rent`
 * row in a category that is now buy-sell-only, a category that exists only in the database — and
 * which chips EXIST is a reviewed product decision that lives in src/lib/taxonomy.ts.
 *
 * ⚠️ THE PAYLOAD IS DEEP-FROZEN (it is a shared 60s memo entry, frozen at the end of
 * computeFacetCounts). Nothing here may sort, splice or assign into it; every helper below reads.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The count for one option chip, or `null` when this chip must render countless.
 *
 * A dimension that IS present but carries no key for this option is an honest `0` — the rails with
 * a known, static option list are pre-seeded with zeros server-side precisely so a chip nothing
 * matches shows 0 instead of vanishing, and the contract states a missing key as zero.
 *
 * ⚠️ A KEY THAT IS PRESENT BUT IS NOT A VALID COUNT IS CORRUPTION, NOT A ZERO, and the two must not
 * collapse. `values` is typed `Record<string, number>` and built from `_count._all`, so `null`,
 * `"lots"` and `-1` can only arrive from a malformed payload — and rendering any of them as `0`
 * states "nothing matches this filter" on a chip that may have hundreds of results, which is
 * exactly the lie the ⚠️ block above forbids. Suppressing the count is the honest degradation.
 * `isCount` is shared with `allCount` so the two guards cannot drift apart; they did, and the codex
 * and opus reviewers both caught this file answering the same corruption two different ways.
 */
export function chipCount(dim: DimensionCounts | undefined, key: string): number | null {
  if (!dim || !dim.values) return null
  if (!(key in dim.values)) return 0
  const n = dim.values[key]
  return isCount(n) ? n : null
}

/**
 * A count is a ROW count: a non-negative safe integer. Anything else — `NaN`, `-1`, `1.5`,
 * `"lots"` — is a malformed payload, and the caller renders no count rather than a wrong one.
 * `Number.isSafeInteger` covers finiteness as well, so this is the whole guard.
 */
function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
}

/**
 * The count for a group's "All" chip.
 *
 * ⚠️ IT IS `dim.all`, NEVER THE SUM OF THE CHIPS BESIDE IT. "All" releases this dimension and keeps
 * every other filter applied, so it legitimately counts rows that fall in NO bucket (condition
 * null, no subcategory set). It is therefore always ≥ the sum of the visible chips, and rendering
 * it as that sum would under-report exactly the rows the tap returns.
 */
export function allCount(dim: DimensionCounts | undefined): number | null {
  if (!dim) return null
  return isCount(dim.all) ? dim.all : null
}

/**
 * The dimension a rail may READ, or `undefined` when the payload is not about this rail.
 *
 * ⚠️ THIS CLOSES THE ONE WINDOW WHERE THE HONEST-ZERO RULE INVERTS INTO A ROW OF ZEROS, and it is
 * a real window, not a hypothetical: the chips are drawn synchronously from `activeCategory`, while
 * the counts arrive with the NEXT feed response. Tap Electronics → Vehicles with the Filter panel
 * open and, until that response lands, `subcategoriesFor('vehicles')` is asking a payload keyed by
 * Electronics slugs. Every key misses, every chip reads a confident `0`, and the panel states that
 * the whole category is empty — precisely the lie the ⚠️ block at the top forbids.
 *
 * The test is structural rather than a heuristic, because the server SEEDS every static rail with
 * zeros (`subcategoryDimension`, and the `type`/`condition` seeds in facet-counts.ts): a payload
 * that really is about this rail contains its keys even when every one of them is 0. So "not one of
 * the chips I am drawing appears in `values`" means the payload answers a different question, and
 * the rail degrades to countless — the documented behaviour for a dimension it does not have.
 *
 * It is a SAFETY NET, not the contract. The producer still owes this component counts that belong
 * to the state it is rendering; see `facetCounts` in the props.
 */
export function railDimension(dim: DimensionCounts | undefined, chipKeys: readonly string[]): DimensionCounts | undefined {
  if (!dim || !dim.values) return undefined
  return chipKeys.some((k) => k in dim.values) ? dim : undefined
}

/**
 * `label` with its count appended, for a control whose options are plain STRINGS.
 * <CustomSelect> takes `{ value, label }[]`, so a count on a listing-type option cannot be its own
 * element the way it can on a segmented chip. Returns the label untouched when the count is `null`,
 * which is what keeps an absent dimension invisible rather than zeroed.
 */
export function labelWithCount(label: string, n: number | null, lang: string): string {
  return n == null ? label : `${label} · ${formatCount(n, moneyLocale(lang))}`
}

/**
 * The count that rides on a segmented chip (`segBtn` below) — the same micro-counter treatment the
 * category rail's subcategory chips use (`text-3xs` is the 10px micro-counter step, globals.css).
 *
 * ⚠️ WHAT IS SEEN AND WHAT IS ANNOUNCED ARE DELIBERATELY DIFFERENT, AND BOTH ARE HERE. The visible
 * glyph is the compact `formatCount` ("1.2k") because a chip has room for four characters — but a
 * bare number appended to a label makes the accessible name "Used 860", which a screen reader
 * reads as two unrelated things, and "1.2k" comes out as "one point two k". So the digits are
 * aria-hidden and an `sr-only` sibling carries the exact figure with its noun, through
 * `resultCountLabel` — the repo's existing, unit-tested count phrase (grouped per language,
 * correct English plural, no plural inflection in Vietnamese). The name then reads
 * "Used, 860 listings", which still CONTAINS the visible label, so label-in-name (WCAG 2.5.3)
 * holds. `sr-only` is position:absolute, so the extra node costs no layout.
 *
 * ⚠️ NO MARGIN ON PURPOSE. These chips are ui/button, whose base is `inline-flex items-center
 * gap-2`, so the gap between the label and this counter is the primitive's own — the same rhythm
 * every icon+label pair in a chip already has. The category rail's `ml-1` exists because its chips
 * override the base with `block`, where there is no gap to inherit; copying the margin here would
 * add 4px on top of the 8px gap and make these chips the one pair spaced differently.
 *
 * `text-white/80` on the selected chip is not decoration: `segBtn` paints the selected state
 * `bg-primary text-white`, and `text-ink-4` on that fill is unreadable. Same pair as the post
 * wizard's segmented hints.
 */
function ChipCount({ n, selected }: { n: number | null; selected: boolean }) {
  const { lang, tr } = useLanguage()
  if (n == null) return null
  // Hoisted: react/jsx-no-literals rejects a template literal in JSX position. See count-chip.tsx.
  const srName = `, ${resultCountLabel(n, lang, tr)}`
  return (
    <>
      <span aria-hidden="true" className={cn('text-3xs font-semibold tabular-nums', selected ? 'text-white/80' : 'text-ink-4')}>
        {formatCount(n, moneyLocale(lang))}
      </span>
      {/* ⚠️ THE LEADING COMMA IS LOAD-BEARING, and it was measured, not assumed. Accessible names
          are built by concatenating inline text with NO separator, so without it the name computed
          as "Used860 listings" — the label and the figure fused into one token. With it the name is
          "Used, 860 listings" and the comma is also the pause a screen reader wants. */}
      <span className="sr-only">{srName}</span>
    </>
  )
}

export type FacetBarProps = {
  activeCategory: string
  activeSubcategory: string // drives subcategory-specific facets (e.g. cc vs L engine)
  /** ⚠️ NO LONGER A PICKER — the panel's subcategory chips were removed on 2026-08-12 (see
   *  `hasAdvanced`). The one caller left is the bar's own "Clear" reset; `activeSubcategory`
   *  above is still read, because it decides which advanced facets the panel offers. */
  setActiveSubcategory: Dispatch<SetStateAction<string>>
  province: Geo | null
  setProvince: Dispatch<SetStateAction<Geo | null>>
  ward: Geo | null
  setWard: Dispatch<SetStateAction<Geo | null>>
  nearby: Nearby | null
  setNearby: Dispatch<SetStateAction<Nearby | null>>
  priceRange: string
  setPriceRange: Dispatch<SetStateAction<string>>
  conditionFilter: string
  setConditionFilter: Dispatch<SetStateAction<string>>
  listingType: string
  setListingType: Dispatch<SetStateAction<string>>
  customFilters: Record<string, string>
  setCustomFilters: Dispatch<SetStateAction<Record<string, string>>>
  verifiedOnly: boolean
  setVerifiedOnly: Dispatch<SetStateAction<boolean>>
  histogramQuery: string // active filters (sans price/pagination) for the price histogram
  trailing?: ReactNode // extra control at the end of the chip row (e.g. the mobile sort chip)
  /**
   * Live chip counts — the `facets` key of the GET /api/listings response, passed straight through
   * (see src/lib/facet-counts.ts for the shape and the ⚠️ block at the top of this file for the
   * three rules that govern reading it). Omit it, or pass `{}`, and every chip renders exactly as
   * it did before counts existed.
   *
   * ⚠️ THE PRODUCER'S HALF OF THE CONTRACT: pass counts that belong to the state this bar is
   * CURRENTLY rendering. The chips are drawn synchronously from `activeCategory`, while the counts
   * ride the NEXT feed response, so handing over the previous query's payload asks the wrong rail
   * the wrong question. Two rules follow, and both live in the caller because only it knows which
   * response is in flight: (1) `facets` arrives in the SAME response object as the rows, so set
   * both from that one object and they can never disagree; (2) on a load-more page the API sends
   * `{}` by design — KEEP the payload you already have rather than clobbering it, because no filter
   * changed and those counts are still true. `railDimension()` above is the safety net for when
   * this is got wrong; it degrades a mismatched rail to countless instead of to a row of zeros, but
   * it can only catch a rail whose KEYS moved, not a stale number under an unchanged one.
   *
   * The dimensions this bar can actually spend: `type` (the listing-type chip's menu),
   * `condition` and `subcategory` (the Filter panel). `year` and `area` are NOT read here — the
   * year facet is a range slider, not band chips, and the area chips live in <AreaFilter>; both
   * would need a file this component does not own.
   */
  facetCounts?: FacetCounts
}

// Compact, category-aware facet bar (faceted-search pattern) — all facets come
// from the canonical taxonomy (src/lib/taxonomy.ts). Only the facets relevant to
// the active category show.
export function FacetBar({
  activeCategory,
  activeSubcategory,
  setActiveSubcategory,
  province,
  setProvince,
  ward,
  setWard,
  nearby,
  setNearby,
  priceRange,
  setPriceRange,
  conditionFilter,
  setConditionFilter,
  listingType,
  setListingType,
  customFilters,
  setCustomFilters,
  verifiedOnly,
  setVerifiedOnly,
  histogramQuery,
  trailing,
  facetCounts = {},
}: FacetBarProps) {
  const { lang, tr } = useLanguage()
  const [areaOpen, setAreaOpen] = useState(false)
  const [advOpen, setAdvOpen] = useState(false) // advanced per-category filter panel
  // Per-facet label ids so each toggle group can be NAMED — those <label>s dangle
  // otherwise, naming nothing.
  const uid = useId()
  // Load-bearing ref: <AreaFilter anchorRef> reads this node's rect to place its popover.
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  // The area pill is "active" when a ward/province or a near-you search is set.
  const areaActive = !!ward || !!province || !!nearby
  const areaLabel = ward
    ? (lang === 'vi' ? ward.name : ward.nameEn)
    : nearby
    ? tr(`Within ${nearby.radiusKm} km`, `Trong ${nearby.radiusKm} km`)
    : province
    ? (lang === 'vi' ? province.name : province.nameEn)
    : tr('Area', 'Khu vực')

  const setFacet = (key: string, value: string) =>
    setCustomFilters((prev) => {
      const n = { ...prev }
      if (value === 'all') delete n[key]
      else n[key] = value
      return n
    })

  const cls = ''
  const active = 'text-accent-foreground'
  // Content-sized pills (no fixed min-width) so they pack into one swipable
  // row on mobile; widen a touch on desktop where they wrap.
  const wrap = 'w-auto shrink-0 lg:min-w-[7.5rem]'

  // Intent (listingType) options — those valid for the active category, or the
  // full set on "all". Surfaced as the first facet so Rent/Buy/Free/etc. is one tap.
  const typeValues: ListingType[] = activeCategory === 'all'
    ? LISTING_TYPES.map((t) => t.value)
    : typesFor(activeCategory)
  // ⚠️ FROM THE TAXONOMY, indexed into `facetCounts.type.values` — never the other way round. A
  // legacy `rent` row left in a buy-sell-only category is reported by the payload (honestly: that
  // chip WOULD return it) and must still not grow a chip the category no longer offers.
  // The COUNTLESS labels, kept separately because the trigger uses them (see `triggerLabel` below).
  // Typed to the taxonomy's own union rather than widened to `string`, so a value that is not a
  // ListingType cannot be spelled here even though <CustomSelect>'s option type would accept it.
  const typeLabels: [ListingType | 'all', string][] = [
    ['all', tr('Any type', 'Mọi loại')],
    ...LISTING_TYPES.filter((t) => typeValues.includes(t.value)).map((t) => [t.value, tr(t.label, t.labelVi)] as [ListingType, string]),
  ]
  const typeCounts = railDimension(facetCounts.type, typeValues)
  const typeOptions = typeLabels.map(([value, label]) => ({
    value,
    label: labelWithCount(label, value === 'all' ? allCount(typeCounts) : chipCount(typeCounts, value), lang),
  }))

  const facets: ReactNode[] = []

  // Intent filter (only meaningful when the category offers >1 intent, or on "all").
  // `typeOptions` now carries the "Any type" row, so the >1 test that used to mean "more than one
  // real intent" is >2 here — same condition, one more element in the array.
  if (typeOptions.length > 2) {
    facets.push(
      <CustomSelect
        key="listingType"
        value={listingType}
        onChange={setListingType}
        options={typeOptions}
        label={tr('Listing type', 'Loại tin')}
        placeholder={tr('Type', 'Loại')}
        // ⚠️ THE TRIGGER STAYS COUNTLESS ON PURPOSE, and it is the reason this bar's width is
        // independent of the payload. This pill is a PICKER, not a value chip: its text is the
        // current selection, whose count is just the result total already stated above the grid.
        // Putting a number on it would widen the one row that is horizontally scrollable at 390px
        // (see the -mx-3 note on the row below) to say nothing new. The counts belong on the
        // OPTIONS, which is where the choice is actually made. Falls back to CustomSelect's own
        // `selectedOption.label ?? placeholder` when `listingType` is a value this category does
        // not offer — identical to the behaviour before counts.
        triggerLabel={typeLabels.find(([v]) => v === listingType)?.[1]}
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
      />,
    )
  }

  facets.push(
    <PriceRangeFilter
      key="price"
      value={priceRange}
      onChange={setPriceRange}
      query={histogramQuery}
      className="text-body hover:bg-muted"
      activeClassName={active}
      wrapperClassName={wrap}
    />,
  )

  // Area / location — to the RIGHT of price (it was awkwardly leading the bar).
  facets.push(
    <Button
      key="area"
      variant="bare"
      size="none"
      // Load-bearing ref: <AreaFilter anchorRef> reads this node's rect to place the
      // popover. Base UI's Button forwards its ref onto the real <button>, so the
      // anchor survives the primitive — do not swap this for a render-prop child.
      ref={areaBtnRef}
      type="button"
      // This pill OPENS A POPOVER and never said so. Base UI's PopoverTrigger supplies
      // aria-expanded/haspopup/controls for free, but both popovers here are hand-portaled and
      // rect-positioned from a load-bearing ref (see the comment above), and <AreaFilter> lives in
      // another file — routing them through a real PopoverTrigger is a rewrite of two components,
      // and this bar is coupled to the page gutter (-mx-3 px-3). So the aria goes on by hand.
      // aria-controls is deliberately ABSENT: AreaFilter's panel carries no id of its own, and a
      // dangling aria-controls is worse than none. aria-expanded + aria-haspopup are the two that
      // actually carry the disclosure.
      aria-haspopup="dialog"
      aria-expanded={areaOpen}
      onClick={() => setAreaOpen((o) => !o)}
      className={cn(
        // h-12 (48px) — kid-friendly tap target; flat, borderless (bg-muted only on hover).
        'flex min-h-12 shrink-0 items-center justify-between gap-1.5 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,scale] duration-100 active:scale-[0.96] cursor-pointer',
        wrap,
        areaOpen ? 'text-foreground' : areaActive ? active : 'text-body hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <MapPin className={cn('h-3.5 w-3.5', areaActive ? 'text-accent-foreground' : 'text-ink-4')} />
        <span className="truncate">{areaLabel}</span>
      </span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', areaOpen && 'rotate-180')} />
    </Button>,
  )

  // All category facets live in the advanced "Filter" panel — a real per-category
  // form (condition + the per-category fields). The quick bar keeps area/type/price.
  const advFacets = facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory)
  /**
   * ⛔ THE SUBCATEGORY PICKER IS GONE FROM THIS PANEL (owner, 2026-08-12: "filter shouldnt have
   * subcategories as chip remove subcats from filter"), AND `activeSubcategory` IS STILL A PROP —
   * it drives `advFacets` one line above, which is the half that was never the duplication.
   *
   * What it used to be: a "Type" chip group at the top of the panel, with counts, that SET the
   * subcategory. Its stated job was to unlock the subcategory-gated facets (transmission, engine
   * cc, bike type, fuel, origin…) for someone who arrived by brand or keyword with no subcategory
   * chosen. That reasoning was sound when the panel was the only place to choose one — but as of
   * the home-page merge the CategoryRail rolls the active category's subcategories out inline, on
   * every browse state, directly above this bar. Two controls for one value, six inches apart, and
   * the rail is the one the ladder and the breadcrumb agree with.
   *
   * ⚠️ SO A DEEP FACET IS NOW REACHED BY THE RAIL, NOT BY THIS PANEL, and that is the one real
   * cost: pick the subcategory above, and the gated facets appear here. Do not "restore" the
   * picker to shorten that path — put the affordance in the rail instead.
   *
   * ⚠️ AND IT LEFT `activeAdvCount` WITH IT. The badge counts what this panel can CLEAR; leaving
   * the subcategory in it would print "Filters · 2" for a rail tap the panel no longer shows and
   * whose chip is not in here to remove. Same reason it left the panel's own "Clear all" below.
   */
  const hasAdvanced = advFacets.length > 0
  const activeAdvCount =
    (conditionFilter !== 'all' ? 1 : 0) +
    advFacets.filter((f) => f.key !== 'condition' && customFilters[f.key]).length

  const hasActive =
    !!province || !!ward || !!nearby || conditionFilter !== 'all' || priceRange !== 'all' ||
    listingType !== 'all' || Object.keys(customFilters).length > 0 || !verifiedOnly

  // A segmented toggle button (selected = filled blue; same height either way).
  // Fed to <Button variant="bare" size="none">: `bare` paints nothing, so both
  // branches below stay fully in charge of the border/background/label colour.
  // whitespace-normal restores the plain <button> wrapping these labels had (the
  // Button base is whitespace-nowrap).
  //
  // ⚠️ SELECTION IS PAINT ONLY — the caller MUST also pass aria-pressed={selected}. This helper
  // returns a className, so it cannot put the state in the accessibility tree itself; every call
  // site below does it. These are aria-PRESSED toggle buttons and not a radio group on purpose:
  // clicking the selected chip DESELECTS it (back to 'all'), which a radio cannot express.
  const segBtn = (selected: boolean) =>
    cn('rounded-lg border px-3 py-1.5 text-sm font-semibold whitespace-normal transition-colors cursor-pointer',
      selected ? 'border-brand bg-primary text-white' : 'border-line-strong text-body hover:bg-muted')
  // condition maps to the dedicated column; everything else to attr_* customFilters.
  const facetValue = (f: FacetDef) => (f.key === 'condition' ? conditionFilter : customFilters[f.key] || 'all')
  const setFacetValue = (f: FacetDef, v: string) => { if (f.key === 'condition') setConditionFilter(v); else setFacet(f.key, v) }
  /**
   * The counted dimension a panel facet reads, or `undefined` for the many that have none.
   *
   * ⚠️ ONLY `condition` MAPS TODAY, and the `undefined` is the correct answer for the rest, not a
   * gap: transmission, fuel, bedrooms, storage… are `attr_*` facets that src/lib/facet-counts.ts
   * does not count, so their chips must keep their countless appearance rather than show 0.
   * `year` is a counted dimension but reaches the panel as a RANGE SLIDER, not as band chips — see
   * the ⚠️ on `facetCounts` in the props for why the band rail is not built here.
   */
  const facetDimension = (f: FacetDef): DimensionCounts | undefined => {
    const dim = f.key === 'condition' ? facetCounts.condition : undefined
    // ⚠️ THE GUARD SITS OUTSIDE THE LOOKUP, NOT INSIDE THE `condition` BRANCH. Whatever dimension a
    // future facet key resolves to gets railDimension()'d on its way out, so a new rail cannot be
    // added here and quietly skip the stale-payload check. A range facet has no options, so it
    // resolves to undefined and never asks — which is right, it draws no chips.
    return railDimension(dim, f.options.map((o) => o.value))
  }

  return (
    <div className="relative">
      {/* Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps. */}
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-none -mx-3 px-3 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible">
        {/* Advanced per-category filter form — leftmost. Only when the category has facets. */}
        {hasAdvanced && (
          // Advanced per-category filter panel. Base UI Popover now supplies the whole
          // disclosure contract that used to be hand-rolled: aria-expanded/haspopup/controls on
          // the trigger, Escape, focus move-and-return on open/close, and anchoring + portaling.
          <Popover open={advOpen} onOpenChange={setAdvOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="bare"
                  size="none"
                  type="button"
                  className={cn(
                    // h-12 (48px) to match the Area pill — flat, borderless.
                    'flex min-h-12 shrink-0 items-center justify-start gap-1.5 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,scale] duration-100 active:scale-[0.96] cursor-pointer',
                    advOpen || activeAdvCount > 0 ? active : 'text-body hover:bg-muted',
                  )}
                >
                  <SlidersHorizontal className={cn('h-3.5 w-3.5', activeAdvCount > 0 ? 'text-accent-foreground' : 'text-ink-4')} />
                  <span>{tr('Filter', 'Bộ lọc')}</span>
                  {activeAdvCount > 0 && (
                    <Badge variant="counter-brand" size="count" className="ml-0.5">{activeAdvCount}</Badge>
                  )}
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', advOpen && 'rotate-180')} />
                </Button>
              }
            />
            {/* Base UI portals this itself, so sitting inside the swipable facet row is fine.
                `backdrop` absorbs the outside dismiss-tap so it can't fall through to a listing
                card. `block` overrides the primitive's base flex-col so the panel's own spacing
                (mb-3 header, space-y-3.5 body) is preserved. */}
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={6}
              backdrop
              aria-label={tr('Filters', 'Bộ lọc')}
              className="block w-[416px] max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto scroll-thin p-4 shadow-pop ring-0"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">{tr('Filters', 'Bộ lọc')}</span>
                <IconButton size="xs" onClick={() => setAdvOpen(false)} aria-label={tr('Close', 'Đóng')} className="h-6 w-6 text-ink-4 hover:bg-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="space-y-3.5">
                {/* ⛔ NO SUBCATEGORY GROUP HERE — see the note on `hasAdvanced` above for why it
                    was removed and what the rail now owns. The `facetCounts.subcategory`
                    dimension it read is still produced by the route and still consumed by the
                    CategoryRail; nothing about the payload changed. */}
                {advFacets.map((f) => {
                  const value = facetValue(f)
                  const dim = facetDimension(f)
                  const opts = f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                      <label id={`${uid}-${f.key}-label`} className="text-2xs font-bold uppercase tracking-wider text-muted-foreground sm:w-24 sm:shrink-0">{tr(f.label, f.labelVi)}</label>
                      {f.kind === 'range' && f.range ? (
                        <RangeFacetControl range={f.range} value={value} onChange={(v) => setFacetValue(f, v)} />
                      ) : f.kind === 'toggle' ? (
                        // ⚠️ NO "All" CHIP HERE, AND NO COUNT FOR ONE — that is not an omission.
                        // These are aria-PRESSED toggles: the released state is reached by
                        // re-tapping the selected chip (see segBtn), so the group has no "All"
                        // element to hang `dim.all` on. Growing one only for the facets that
                        // happen to have counts would make the panel's shape depend on the
                        // payload, which is exactly what the degradation rule forbids.
                        <div role="group" aria-labelledby={`${uid}-${f.key}-label`} className="flex flex-1 flex-wrap gap-1.5">
                          {opts.map((o) => (
                            <Button key={o.value} variant="bare" size="none" type="button" aria-pressed={value === o.value} onClick={() => setFacetValue(f, value === o.value ? 'all' : o.value)} className={segBtn(value === o.value)}>
                              {o.label}
                              <ChipCount n={chipCount(dim, o.value)} selected={value === o.value} />
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <CustomSelect
                            value={value}
                            onChange={(v) => setFacetValue(f, v)}
                            // Same split as the listing-type pill: counts on the OPTIONS, and the
                            // trigger keeps the plain label so a panel field cannot reflow when a
                            // count arrives. `dim` is undefined for every select facet today, so
                            // labelWithCount is an identity here — it is wired anyway so a facet
                            // that later gains a dimension needs no edit at this call site.
                            options={[
                              { value: 'all', label: labelWithCount(tr('All', 'Tất cả'), allCount(dim), lang) },
                              ...opts.map((o) => ({ value: o.value, label: labelWithCount(o.label, chipCount(dim, o.value), lang) })),
                            ]}
                            triggerLabel={value === 'all' ? tr('All', 'Tất cả') : opts.find((o) => o.value === value)?.label}
                            label={tr(f.label, f.labelVi)}
                            placeholder={tr(f.label, f.labelVi)}
                            activeClassName="text-accent-foreground border-accent-foreground/35"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {activeAdvCount > 0 && (
                <Button
                  variant="bare"
                  size="none"
                  // ⛔ NO `setActiveSubcategory('all')` — this button clears THIS PANEL, and the
                  // subcategory is not in it any more (see `hasAdvanced`). Resetting a rail
                  // selection from a panel that never showed it would look like the category
                  // ladder collapsing on its own; the rail's own "All" chip is the way back.
                  onClick={() => { setConditionFilter('all'); setCustomFilters({}) }}
                  className="mt-3.5 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
                >
                  {tr('Clear all', 'Xóa tất cả')}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}
        {facets}
        {hasActive && (
          <Button
            variant="bare"
            size="none"
            onClick={() => {
              setProvince(null)
              setWard(null)
              setNearby(null)
              setConditionFilter('all')
              setPriceRange('all')
              setListingType('all')
              setActiveSubcategory('all')
              setCustomFilters({})
              setVerifiedOnly(true)
            }}
            className="shrink-0 px-1 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
          >
            {tr('Clear', 'Xóa lọc')}
          </Button>
        )}
        {trailing}

        <AreaFilter
          open={areaOpen}
          anchorRef={areaBtnRef}
          onClose={() => setAreaOpen(false)}
          province={province}
          ward={ward}
          nearby={nearby}
          onApply={({ province: p, ward: w, nearby: nb }) => { setProvince(p); setWard(w); setNearby(nb) }}
          onReset={() => { setProvince(null); setWard(null); setNearby(null) }}
        />
      </div>
    </div>
  )
}
