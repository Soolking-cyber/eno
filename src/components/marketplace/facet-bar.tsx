'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import { isValidElement, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { MapPin, ChevronDown, SlidersHorizontal, X } from '@/components/ui/icons'
import { CustomSelect } from './custom-select'
import { PriceRangeFilter } from './price-range-filter'
import { RangeFacetControl } from './range-facet-control'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { DISTRICTS_PROVINCE_CODE, districtSlugLabel, districtSurvivesArea } from './listings-explorer.constants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { CloseButton } from '@/components/ui/close-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { useIsPhone } from '@/hooks/use-is-phone'
import { useBackToClose } from '@/lib/back-to-close'
import { scrollBehavior } from '@/lib/reduced-motion'
import { useLanguage } from '@/context/language-context'
import { CONDITION_FACET, facetsFor, typesFor, LISTING_TYPES, type ListingType, type FacetDef } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'
import { formatCount, formatInteger, moneyLocale } from '@/lib/vnd'
// The chip counter's SPOKEN form. Reused rather than re-worded: this helper already groups per
// language and already knows Vietnamese has no plural -s, and it is unit-tested for both.
import { resultCountLabel } from './result-line'
import { offeredKeys } from './count-chip'
import { viewScope } from '@/lib/attr-match'
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
  /** Bump to open the advanced filter panel; see the note on the destructured prop in FacetBar. */
  openFilterSignal?: number
  activeCategory: string
  activeSubcategory: string // drives subcategory-specific facets (e.g. cc vs L engine)
  province: Geo | null
  setProvince: Dispatch<SetStateAction<Geo | null>>
  ward: Geo | null
  setWard: Dispatch<SetStateAction<Geo | null>>
  nearby: Nearby | null
  setNearby: Dispatch<SetStateAction<Nearby | null>>
  /** The applied district slug (`?district=`) and its setter — see the note in <AreaFilter>.
   *  Optional so every other consumer of this bar is unaffected; without the setter the Area panel
   *  draws no district list. The bar calls it with 'all' whenever an area pick REPLACES the
   *  district (districtSurvivesArea), so the parent can drop a district TYPED into the search box
   *  at the same moment. */
  district?: string
  setDistrict?: (slug: string) => void
  priceRange: string
  setPriceRange: Dispatch<SetStateAction<string>>
  conditionFilter: string
  setConditionFilter: Dispatch<SetStateAction<string>>
  listingType: string
  setListingType: Dispatch<SetStateAction<string>>
  customFilters: Record<string, string>
  setCustomFilters: Dispatch<SetStateAction<Record<string, string>>>
  histogramQuery: string // active filters (sans price/pagination) for the price histogram
  histogramApproximate?: boolean // the grid's set differs from what the histogram can count (nearby / text search)
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
   * The dimensions this bar spends: `type` (the listing-type menu), `condition`, `attr` +
   * `rangePresent` (the Filter panel, only while `attrScope` names the view on screen), and `area` +
   * `province`, handed to <AreaFilter>. `year` is NOT read here — the year facet is a range slider,
   * not band chips. Every one of them now also decides which options are DRAWN (offeredKeys).
   */
  facetCounts?: FacetCounts
  /**
   * The feed's current result count, for the phone Filter sheet's "Show {n} results" button — the
   * sheet covers the grid, so this is the one place the reader sees what the panel has done. `null`
   * or omitted = no answer yet, and the button says "Show results" without a number.
   */
  resultCount?: number | null
  /**
   * Told when ANY of this bar's panels (Filter, Price, Area) opens or closes. The explorer holds its
   * phone ladder still while one is open (E-FILTER-SHEET): a preset that directs the feed folds the
   * ladder, and a fold behind an open panel moved the page ~220px under the reader's finger.
   */
  onPanelOpenChange?: (open: boolean) => void
  /**
   * Called just before the Area panel APPLIES a place (Apply, a district chip, Clear) — a committed view
   * change, so the explorer gives it its own history entry and Back undoes it (UX3 NAV-1). Live taps in the
   * Filter and Price panels are not commits: on a phone their sheet's own entry carries them (see
   * `useBackToClose`), and from sm up they stay in-place tweaks.
   */
  onCommit?: () => void
}

// Compact, category-aware facet bar (faceted-search pattern) — all facets come
// from the canonical taxonomy (src/lib/taxonomy.ts). Only the facets relevant to
// the active category show.
export function FacetBar({
  /**
   * ⛔ AN OPEN SIGNAL, NOT AN OPEN BOOLEAN. The map's "narrow it down" prompt has to be able to open
   * this panel, but it must not OWN whether it is open — the reader closing it has to stick, and a
   * controlled boolean from a parent that never hears about the close would reopen it on the next
   * render. A monotonically increasing counter says "open it now" once per bump and leaves the state
   * here, where the trigger and the Escape key already live.
   * ⚠️ Its previous target, `ExplorerFiltersDrawer`, was deleted upstream when filtering moved into
   * this bar and the Area panel; this is the surviving surface that holds the same facets.
   */
  openFilterSignal,
  activeCategory,
  activeSubcategory,
  province,
  setProvince,
  ward,
  setWard,
  nearby,
  setNearby,
  district,
  setDistrict,
  priceRange,
  setPriceRange,
  conditionFilter,
  setConditionFilter,
  listingType,
  setListingType,
  customFilters,
  setCustomFilters,
  histogramQuery,
  histogramApproximate,
  trailing,
  facetCounts = {},
  resultCount,
  onPanelOpenChange,
  onCommit,
}: FacetBarProps) {
  const { lang, tr } = useLanguage()
  const isPhone = useIsPhone()
  const [areaOpen, setAreaOpen] = useState(false)
  const [advOpen, setAdvOpen] = useState(false) // advanced per-category filter panel
  const [priceOpen, setPriceOpen] = useState(false)
  // ⛔ BACK CLOSES THE PHONE FILTER SHEET (UX3 NAV-1): one history entry while it is open. Taps inside apply
  // live, so a sheet closed after a tap KEEPS its entry as the step it made (Back undoes it) and one closed
  // untouched pops it — src/lib/back-to-close.ts. Phone only: from sm the panel is a popover, not a layer.
  // Declared before the open-change effect below, so the entry exists by the time the explorer hears of it.
  useBackToClose(isPhone && advOpen, () => setAdvOpen(false), 'filters')
  // One signal for the three panels (see `onPanelOpenChange`). Through a ref so a parent that passes a
  // fresh closure every render does not re-fire it; only a real open/close change reaches the parent.
  const panelOpen = areaOpen || advOpen || priceOpen
  const onPanelOpenChangeRef = useRef(onPanelOpenChange)
  useEffect(() => { onPanelOpenChangeRef.current = onPanelOpenChange }, [onPanelOpenChange])
  useEffect(() => { onPanelOpenChangeRef.current?.(panelOpen) }, [panelOpen])
  // Per-facet label ids so each toggle group can be NAMED — those <label>s dangle
  // otherwise, naming nothing.
  const uid = useId()
  // Load-bearing ref: <AreaFilter anchorRef> reads this node's rect to place its popover.
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  // The area pill is "active" when a ward/province/district or a near-you search is set.
  const districtPicked = !!district && district !== 'all'
  const areaActive = !!ward || !!province || !!nearby || districtPicked
  // ⚠️ THE DISTRICT OUTRANKS THE PROVINCE: with HCMC applied as well, "Quận 7" says what narrows.
  const areaLabel = ward
    ? (lang === 'vi' ? ward.name : ward.nameEn)
    : nearby
    ? fillTemplate(tr('Within {radiusKm} km', 'Trong {radiusKm} km'), 'Within {radiusKm} km', { radiusKm: String(nearby.radiusKm) })
    : districtPicked
    ? districtSlugLabel(district!, lang)
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

  // ⛔ 44px, NOT CustomSelect's 48px default (home fold, 2026-09-30, owner: "try a little from both
  // categ and filter"). These pills are the facet ROW, and the row is half of the sticky strip above the
  // home feed; 44 is the house tap-target floor (WCAG 2.5.8 / our 44px rule) and it gave the fold 4px at
  // every width. The Area, Filter and Price triggers carry the same `min-h-11`, and so does
  // FacetBarFallback's picture of the row and the explorer's reservation around it — change all or none.
  const cls = 'min-h-11'
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
  const typeCounts = railDimension(facetCounts.type, typeValues)
  // ⛔ ONLY THE INTENTS THAT NARROW (owner, 2026-09-25 — see offeredKeys): in Electronics "For sale"
  // was all 64,144 rows and every other intent was 0, so the whole menu was chips that did nothing.
  const offeredTypes = offeredKeys(typeCounts, typeValues, listingType, { hideNoOp: true })
  const typeLabels: [ListingType | 'all', string][] = [
    ['all', tr('Any type', 'Mọi loại')],
    ...LISTING_TYPES.filter((t) => offeredTypes.includes(t.value)).map((t) => [t.value, tr(t.label, t.labelVi)] as [ListingType, string]),
  ]
  const typeOptions = typeLabels.map(([value, label]) => ({
    value,
    label: labelWithCount(label, value === 'all' ? allCount(typeCounts) : chipCount(typeCounts, value), lang),
  }))

  const facets: ReactNode[] = []

  // Intent filter (only meaningful when the category offers >1 intent, or on "all") — and, with
  // counts in hand, only while at least one intent would actually narrow the feed or one is picked.
  if (typeValues.length > 1 && (offeredTypes.length > 0 || listingType !== 'all')) {
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
        // ⌄, like Price and Area beside it — ⇅ is the Price SORT tab's glyph on the row below (E-TOOLBAR).
        indicator="down"
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
      countsApproximate={histogramApproximate}
      onOpenChange={setPriceOpen}
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
        // min-h-11 (44px) — the facet row's height, see `cls`; flat, borderless (bg-muted only on hover).
        'flex min-h-11 shrink-0 items-center justify-between gap-1.5 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,scale] duration-100 active:scale-[0.96] cursor-pointer',
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

  /**
   * CONDITION — the 4th quick pill (owner, 2026-09-14: "4th dropdown here to select used or new items").
   * Offered on the "all" browse state (the home page, where there is no Filter panel at all) and in every category
   * whose taxonomy has a `condition` facet; a category without one (services, jobs…) gets no pill, because every
   * row there has condition null and the filter could only empty the feed.
   * ⚠️ IT IS A SECOND CONTROL FOR THE SAME VALUE AS THE PANEL'S Condition GROUP, deliberately: both read and write
   * `conditionFilter`, so they cannot disagree, and the panel group is what facet-bar.test.tsx pins. Same shape as
   * the listing-type pill — counts on the OPTIONS from `facetCounts.condition`, a countless trigger, so the one
   * horizontally scrolling row at 390px does not widen when a count arrives.
   */
  // ⚠️ A SET FILTER KEEPS ITS PILL (astra, opus): pick "Used" on the home page, then open Services — no condition facet
  // there, and without this the pill would vanish while `conditionFilter` still emptied the feed, with nothing on the
  // bar saying why. So a category without the facet still shows the pill while a value is set, to be read and cleared.
  const conditionFacet = activeCategory === 'all'
    ? CONDITION_FACET
    : facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory).find((f) => f.key === 'condition')
      ?? (conditionFilter !== 'all' ? CONDITION_FACET : undefined)
  const conditionCounts = conditionFacet ? railDimension(facetCounts.condition, conditionFacet.options.map((o) => o.value)) : undefined
  // Same rule as the intent menu: "New" was every row in Sports (5,591 of 5,591) and "Used" none.
  const offeredConditions = conditionFacet
    ? offeredKeys(conditionCounts, conditionFacet.options.map((o) => o.value), conditionFilter, { hideNoOp: true })
    : []
  if (conditionFacet && offeredConditions.length > 0) {
    const conditionLabels: [string, string][] = [
      ['all', tr('Any condition', 'Mọi tình trạng')],
      ...conditionFacet.options.filter((o) => offeredConditions.includes(o.value)).map((o) => [o.value, tr(o.label, o.labelVi)] as [string, string]),
    ]
    facets.push(
      <CustomSelect
        key="condition"
        value={conditionFilter}
        onChange={setConditionFilter}
        options={conditionLabels.map(([value, label]) => ({
          value,
          label: labelWithCount(label, value === 'all' ? allCount(conditionCounts) : chipCount(conditionCounts, value), lang),
        }))}
        label={tr('Condition', 'Tình trạng')}
        placeholder={tr('Condition', 'Tình trạng')}
        triggerLabel={conditionLabels.find(([v]) => v === conditionFilter)?.[1]}
        indicator="down"
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
      />,
    )
  }

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
  /**
   * ⛔ ONLY THE OPTIONS THAT WOULD NARROW, AND ONLY THE FACETS THAT HAVE ONE (owner, 2026-09-25 —
   * see offeredKeys). Measured on production: 627 of the 1,083 Filter-panel options in non-empty
   * views returned nothing (rentals "Rental period" 5 of 5, electronics warranty and colour, every
   * vehicle year position), and a slider over a column no row fills could only empty the feed.
   * The counts are the `attr` rail from src/lib/facet-counts.ts — each facet counted with the other
   * filters applied and its own released, through the feed's own predicate (src/lib/attr-match.ts).
   * ⚠️ ONLY WHEN THE PAYLOAD IS ABOUT THIS VIEW (`attrScope`): the facets change with the
   * subcategory, and a payload held across a subcategory tap describes the previous one's. Until
   * the new counts land the panel shows the taxonomy's options, countless — never an empty panel.
   */
  const scopeOk = facetCounts.attrScope === viewScope(activeCategory, activeSubcategory)
  /**
   * The counted dimension a panel facet reads, or `undefined` when there is none to read.
   *
   * `condition` reads its own rail; every other chip facet reads the `attr` rail (2026-09-25 —
   * until then `attr_*` facets had no counts at all), but only while `attrScope` says the payload
   * is about the view on screen. `year` is a counted dimension but reaches the panel as a RANGE
   * SLIDER, not as band chips — see the ⚠️ on `facetCounts` in the props.
   */
  function facetDimension(f: FacetDef): DimensionCounts | undefined {
    const dim = f.key === 'condition' ? facetCounts.condition : scopeOk ? facetCounts.attr?.[f.key] : undefined
    // ⚠️ THE GUARD SITS OUTSIDE THE LOOKUP. Whatever dimension a facet key resolves to gets
    // railDimension()'d on its way out, so a new rail cannot be added here and quietly skip the
    // stale-payload check. A range facet has no options, so it resolves to undefined.
    return railDimension(dim, f.options.map((o) => o.value))
  }

  const shownAdvFacets = advFacets.flatMap((f) => {
    const value = f.key === 'condition' ? conditionFilter : customFilters[f.key] || 'all'
    if (f.kind === 'range' && f.range) {
      const present = scopeOk ? facetCounts.rangePresent?.[f.range.column] : undefined
      return present === 0 && value === 'all' ? [] : [{ f, offered: [] as string[] }]
    }
    const offered = offeredKeys(facetDimension(f), f.options.map((o) => o.value), value, { hideNoOp: true })
    return offered.length ? [{ f, offered }] : []
  })
  const hasAdvanced = shownAdvFacets.length > 0

  /**
   * ⛔ THE ADVANCED PANEL DOES NOT ALWAYS EXIST, AND THAT IS THE WHOLE DIFFICULTY. `facetsFor()`
   * returns nothing for "all categories", so `hasAdvanced` is false on the DEFAULT map — which is
   * exactly the surface where a ">100 results" prompt fires. Setting `advOpen` there opened a
   * Popover with no trigger and no content: the button appeared to do nothing, which is how it
   * tested (verified on the built app before this).
   * So: open the panel when there IS one, and otherwise bring this bar's own controls — Price, Area,
   * Condition, which exist on every surface — into view and put focus on the first, which is a real
   * outcome rather than a no-op. Done from inside FacetBar because this is its DOM; reaching into it
   * from the explorer would be the fragile version.
   */
  const barRef = useRef<HTMLDivElement | null>(null)
  const lastOpenSignal = useRef(openFilterSignal ?? 0)
  useEffect(() => {
    const next = openFilterSignal ?? 0
    if (next === lastOpenSignal.current || next <= 0) return
    lastOpenSignal.current = next
    if (hasAdvanced) { setAdvOpen(true); return }
    const el = barRef.current
    if (!el) return
    // ⚠️ `scrollBehavior()`, NOT a literal 'smooth' — design-lint caught this: an explicit behavior
    // in the options bag outranks `scroll-behavior: auto !important` in globals.css, so the
    // reduced-motion kill switch would read as if it worked and do nothing.
    el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
    // The first facet trigger — focus makes the hand-off visible without forcing a panel open.
    el.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus()
  }, [openFilterSignal, hasAdvanced])
  const activeAdvCount =
    (conditionFilter !== 'all' ? 1 : 0) +
    advFacets.filter((f) => f.key !== 'condition' && customFilters[f.key]).length

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
   * ⛔ COVER AREA, A PILL OF ITS OWN ON THE COVER BROWSE (preview check, 2026-10-07). With "Available for cover" on,
   * the Area pill still filters where a teacher LIVES, while a school looking for a cover wants where they will TRAVEL
   * — and that facet was reachable only inside Filter. So the cover-area facet gets a pill just before Area, labelled
   * as such; Area stays (a school may want a local teacher too). The same value as the panel's group, so the two
   * cannot disagree — the Condition pill's pattern.
   */
  // Also while an area is still set with the cover filter off: a set filter keeps its pill (the Condition pill's rule).
  const coverAreaFacet = activeCategory === 'teachers' && (customFilters.cover === 'open' || (!!customFilters.coverArea && customFilters.coverArea !== 'all'))
    ? advFacets.find((f) => f.key === 'coverArea')
    : undefined
  if (coverAreaFacet) {
    const value = facetValue(coverAreaFacet)
    const dim = facetDimension(coverAreaFacet)
    const offered = offeredKeys(dim, coverAreaFacet.options.map((o) => o.value), value, { hideNoOp: true })
    // i18n-invariant: cover areas are places — their own English or Vietnamese name, never machine-translated.
    const opts = coverAreaFacet.options.filter((o) => offered.includes(o.value)).map((o) => ({ value: o.value, label: lang === 'vi' ? o.labelVi : o.label }))
    const title = tr('Cover area', 'Khu vực dạy thay')
    if (opts.length || value !== 'all') {
      // By the Area pill's own key, found NOW — never an index captured 200 lines earlier that a later insert would skew.
      const areaAt = facets.findIndex((el) => isValidElement(el) && el.key === 'area')
      facets.splice(areaAt >= 0 ? areaAt : facets.length, 0, (
        <CustomSelect
          key="coverArea"
          value={value}
          onChange={(v) => setFacetValue(coverAreaFacet, v)}
          options={[
            { value: 'all', label: labelWithCount(tr('All', 'Tất cả'), allCount(dim), lang) },
            ...opts.map((o) => ({ value: o.value, label: labelWithCount(o.label, chipCount(dim, o.value), lang) })),
          ]}
          triggerLabel={value === 'all' ? title : `${title}: ${opts.find((o) => o.value === value)?.label ?? value}`}
          label={title}
          placeholder={title}
          indicator="down"
          className={cls}
          activeClassName={active}
          wrapperClassName={wrap}
        />
      ))
    }
  }

  // The Filter pill. One element for both containers, so the trigger never differs between them.
  const filterTrigger = (
    <Button
      variant="bare"
      size="none"
      type="button"
      className={cn(
        // min-h-11 (44px) to match the Area pill — flat, borderless.
        'flex min-h-11 shrink-0 items-center justify-start gap-1.5 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,scale] duration-100 active:scale-[0.96] cursor-pointer',
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
  )
  const panelBody = (
    <div className="space-y-3.5">
      {/* ⛔ NO SUBCATEGORY GROUP HERE — see the note on `hasAdvanced` above for why it
          was removed and what the rail now owns. The `facetCounts.subcategory`
          dimension it read is still produced by the route and still consumed by the
          CategoryRail; nothing about the payload changed. */}
      {shownAdvFacets.map(({ f, offered }) => {
        const value = facetValue(f)
        const dim = facetDimension(f)
        // i18n-invariant: `placeNames` (cover areas) — a place is its own English or Vietnamese name, never machine-translated.
        const opts = f.options.filter((o) => offered.includes(o.value)).map((o) => ({ value: o.value, label: f.placeNames ? (lang === 'vi' ? o.labelVi : o.label) : tr(o.label, o.labelVi) }))
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
                  // count arrives.
                  options={[
                    { value: 'all', label: labelWithCount(tr('All', 'Tất cả'), allCount(dim), lang) },
                    ...opts.map((o) => ({ value: o.value, label: labelWithCount(o.label, chipCount(dim, o.value), lang) })),
                  ]}
                  triggerLabel={value === 'all' ? tr('All', 'Tất cả') : opts.find((o) => o.value === value)?.label}
                  label={tr(f.label, f.labelVi)}
                  placeholder={tr(f.label, f.labelVi)}
                  indicator="down"
                  activeClassName="text-accent-foreground border-accent-foreground/35"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
  // ⛔ NO `setActiveSubcategory('all')` — this clears THIS PANEL, and the subcategory is not in it any
  // more (see `hasAdvanced`). Resetting a rail selection from a panel that never showed it would look
  // like the category ladder collapsing on its own; the rail's own "All" chip is the way back.
  const clearPanel = () => { setConditionFilter('all'); setCustomFilters({}) }
  /** The phone sheet's closing action: "Show 1,204 results" — the answer the panel has produced. */
  const showLabel = typeof resultCount !== 'number'
    ? tr('Show results', 'Xem kết quả')
    : (resultCount === 1 ? tr('Show {n} result', 'Xem {n} kết quả') : tr('Show {n} results', 'Xem {n} kết quả'))
      .replace('{n}', formatInteger(resultCount, moneyLocale(lang)))
  /**
   * ⛔ A BOTTOM SHEET ON A PHONE (E-FILTER-SHEET, 2026-09-29; canon §5 "mobile filters → ui/drawer").
   * The 416px popover was capped at the viewport and anchored to a pill that could move under it,
   * and it ended on "Clear all" with nothing saying what the filters had done to the feed. The sheet
   * spans the screen, sits over the tab bar, scrolls its own body, and ends on "Show {n} results".
   * Filters still APPLY AS THEY ARE TAPPED (the grid under the sheet updates live); the button only
   * closes — which is why its number is the feed's own count, not a preview.
   */
  const filterPanel = isPhone ? (
    <Drawer open={advOpen} onOpenChange={setAdvOpen}>
      <DrawerTrigger render={filterTrigger} />
      <DrawerContent>
        <DrawerHeader className="flex-row items-center justify-between gap-3 pb-1 text-left">
          <DrawerTitle className="text-base font-bold">{tr('Filters', 'Bộ lọc')}</DrawerTitle>
          {/* The 24px box the header row was laid out for — CloseButton's `2xs` (D-CLOSE). */}
          <CloseButton size="2xs" onClick={() => setAdvOpen(false)} className="-mr-1 hover:bg-muted" />
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 scroll-thin">{panelBody}</div>
        <DrawerFooter className="flex-row gap-3 border-t border-border pt-3">
          {activeAdvCount > 0 && (
            <Button
              variant="ghost"
              size="none"
              type="button"
              onClick={clearPanel}
              className="min-h-11 flex-1 rounded-xl text-sm font-bold text-body hover:bg-muted hover:text-body"
            >
              {tr('Clear all', 'Xóa tất cả')}
            </Button>
          )}
          <Button variant="cta" size="none" type="button" onClick={() => setAdvOpen(false)} className="min-h-11 flex-[2] rounded-xl px-4 text-sm">
            {showLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    // Advanced per-category filter panel. Base UI Popover now supplies the whole
    // disclosure contract that used to be hand-rolled: aria-expanded/haspopup/controls on
    // the trigger, Escape, focus move-and-return on open/close, and anchoring + portaling.
    <Popover open={advOpen} onOpenChange={setAdvOpen}>
      <PopoverTrigger render={filterTrigger} />
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
            <X className="h-[29px] w-[29px] shrink-0" />
          </IconButton>
        </div>
        {panelBody}
        {activeAdvCount > 0 && (
          <Button
            variant="bare"
            size="none"
            onClick={clearPanel}
            className="mt-3.5 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
          >
            {tr('Clear all', 'Xóa tất cả')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="relative" ref={barRef}>
      {/* Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps. */}
      {/* ⚠️ `overscroll-x-contain` — see the note in listing-gallery.tsx: without it a flick at
          either end of this strip chains to an ancestor, or to the iOS swipe-back gesture. It only
          applies while the strip is a scroller; from `lg` it wraps and the property is inert. */}
      {/* ⛔ BELOW sm IT DOES NOT SCROLL (2026-09-30, owner's one-row try): the explorer's SortStrip puts
          the sort pill, this row and Good price on ONE phone line and that line is the scroller, so this
          row is content-sized there (`max-sm:overflow-visible`, no bleed of its own). Two nested scrollers
          would trap the swipe in whichever one the thumb landed on (explorer-toolbar.tsx). sm–lg unchanged. */}
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto overscroll-x-contain scrollbar-none -mx-3 px-3 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible max-sm:mx-0 max-sm:overflow-visible max-sm:px-0">
        {/* Advanced per-category filter form — leftmost. Only when the category has facets.
            A Base UI Popover from `sm` up and a bottom sheet (ui/drawer) on a phone — see `filterPanel`. */}
        {hasAdvanced && filterPanel}
        {facets}
        {/* ⛔ NO "CLEAR" OF THE BAR'S OWN (E-ACTIVE, 2026-09-29). It was the third reset on one screen —
            this row's "Clear", the result line's "Clear all" and the Filter panel's "Clear all" — and
            it cleared a different set from each of them. Every way back is still one tap: a chip's ✕,
            the result line's "Clear all" (from two chips), the panel's own "Clear all", and every
            pill's "Any …" / Reset. The explorer's un-latch effect returns to undirected browse from
            any of them. */}
        {trailing}

        <AreaFilter
          open={areaOpen}
          anchorRef={areaBtnRef}
          onClose={() => setAreaOpen(false)}
          province={province}
          ward={ward}
          district={district}
          // The Area panel's chips follow the same rule as every other rail: a district or province
          // with nothing in view is not drawn (see offeredKeys).
          districtCounts={facetCounts.area}
          provinceCounts={facetCounts.province}
          /**
           * ⛔ A PLACE REPLACES A PLACE, IN BOTH DIRECTIONS (districtSurvivesArea). Picking a district
           * drops the ward, the radius and a province outside HCMC; applying a ward, a radius or
           * another province drops the district. HCMC alone contains the district and keeps it.
           */
          onPickDistrict={setDistrict ? (slug) => {
            onCommit?.()
            if (slug !== 'all') {
              setWard(null)
              setNearby(null)
              if (province && province.code !== DISTRICTS_PROVINCE_CODE) setProvince(null)
            }
            setDistrict(slug)
          } : undefined}
          nearby={nearby}
          onApply={({ province: p, ward: w, nearby: nb }) => {
            onCommit?.()
            // Only a CHANGED place replaces the district: an Apply that re-sends the radius already
            // applied must not strip a district from the search box (opus). The panel's province
            // defaults to HCMC, and HCMC contains every curated district, so that is no change here.
            const changed = w?.code !== ward?.code ||
              nb?.lat !== nearby?.lat || nb?.lng !== nearby?.lng || nb?.radiusKm !== nearby?.radiusKm ||
              (p?.code !== province?.code && !!p && p.code !== DISTRICTS_PROVINCE_CODE)
            setProvince(p); setWard(w); setNearby(nb)
            // …but a PICKED district that the applied place already contradicts (a landing slug under
            // Hà Nội) is resolved by any Apply (opus): the pick is dropped, the place stays.
            if ((changed || districtPicked) && !districtSurvivesArea({ province: p, ward: w, nearby: nb })) setDistrict?.('all')
          }}
          onReset={() => { onCommit?.(); setProvince(null); setWard(null); setNearby(null); setDistrict?.('all') }}
        />
      </div>
    </div>
  )
}
