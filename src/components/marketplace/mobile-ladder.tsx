'use client'

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from '@/components/ui/icons'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useLanguage } from '@/context/language-context'
import { ScrollArrows, useScrollArrows } from '@/hooks/use-scroll-arrows'
import type { DimensionCounts } from '@/lib/facet-counts'
import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import { formatCount, moneyLocale, type MoneyLocale } from '@/lib/vnd'
import { railEdgeMask } from './shelf'

/**
 * The breadcrumb separator, as a CONST rather than a literal in JSX.
 * `react/jsx-no-literals` — an error in `npm run lint`, which is its own CI step — cannot tell a
 * bare glyph from untranslated English, and that rule is what keeps copy from shipping unwrapped.
 * It is `aria-hidden` at the call site: the path is announced as its parts, and a screen reader
 * saying "single right-pointing angle quotation mark" between every level is noise, not structure.
 */
const PATH_SEP = '\u203a'


/**
 * THE MOBILE LADDER — the phone shape of category → subcategory → brand → model.
 *
 * On desktop the explorer rolls a category's subcategories OUT TO THE RIGHT as a 3×3 grid
 * beside the tile that opened it. That is a pointer-and-gutter move and it does not survive a
 * 390pt phone: the grid alone wants ~3 columns of chips plus a separator, so the rail it hangs
 * off is pushed entirely off-screen and the thing you just tapped is no longer visible.
 *
 * THE MOBILE ANSWER, one substitution: every roll-out grid becomes ONE horizontally scrollable
 * CHIP ROW docked under its own rail. Same options, same counts, no popover, no overflow menu —
 * everything rides the horizontal scroll, which is the decision brand-rail already made for
 * brands ("no More dropdown", 2026-07-06) and this simply applies one level down. The path stays
 * on screen as a stack of rows: category, then subcategory, then brand, then model, each row
 * appearing as the row above it produces options. Scroll into the results and the whole stack
 * collapses into ONE STICKY LINE that still names the path — "Vehicles › Manual › Honda › Vision"
 * — and can clear it.
 *
 * ⚠️ PURE AND PROPS-DRIVEN. It owns no filter state, no URL, no query, and it FETCHES NOTHING —
 * levels in, callbacks out, counts in as data. That is what lets it be tested without a router, a
 * DB or a network, and it is also the integration contract: this file never imports the explorer
 * and the explorer wires it. Everything this component decides for itself is a RENDERING rule
 * (which rows are on screen, what the path reads, where the sticky line docks); everything that
 * is a product decision (which chips exist, what a tap does to the URL) is the caller's.
 *
 *
 * ── WHAT IT ASSUMES ABOUT THE APP'S OTHER FIXED CHROME ──────────────────────────────────────
 * The sticky line is the only thing here that leaves the flow, so it is the only thing that can
 * fight the chrome. It docks at the TOP and it hard-codes NOTHING; both offsets and the stacking
 * order are props with CSS-var defaults, so the integrator sets them from the real values.
 *
 *   · #app-header — `sticky top-0 z-40`, three geometries (bare / +safe-area-inset-top on
 *     native / +prelaunch banner), and it SLIDES AWAY on scroll-down (header.tsx). The default
 *     here is deliberately `top: 0` and `z-index: 30`, i.e. UNDER the header: while the header is
 *     docked it covers this line, and the moment the user scrolls down — which is exactly when
 *     this line has a job — the header retracts and uncovers it. No measurement of a header
 *     whose height has three values, and no second bar stacked under a bar.
 *
 *     ⚠️ THE DEFAULT IS A SAFE FALLBACK, NOT THE RECOMMENDED PRODUCTION CONFIG, and the cost is
 *     worth stating plainly rather than leaving for someone to discover: the header returns on
 *     scroll-UP, so it covers the line again exactly when a user reverses to check what is
 *     filtering their feed. Two smaller consequences follow from the same choice — the dock line
 *     is only the bar's own 44px while the header occupies more than that, so rows in the band
 *     between them are hidden with no line yet; and the line is only ever visible mid-gesture.
 *     THE PRODUCTION SETTING IS `stickyTop` = the header's resolved height and `stickyZIndex`
 *     above 40. Both are props precisely so the integrator, who owns the header, sets them.
 *   · The bottom tab bar — `fixed bottom-0 z-40`, 72px measured (mobile-nav.tsx says 73→72 after
 *     the hairline moved to a pseudo-element), permanent except when the keyboard is up. This
 *     component NEVER docks at the bottom, so it does not touch that bar, its `--nav-h` (4.5rem)
 *     contract or the `.kb-*` keyboard rules. The rows themselves are in normal flow.
 *   · back-to-top — `fixed z-[60]`, a 44px control at `right-4`, anchored to the BOTTOM
 *     (`bottom-[calc(5rem+safe-area)]`). A top-docked line never meets it vertically, so the
 *     default horizontal reserve is 0. `stickyInsetEnd` exists for the integrator who moves this
 *     line to the bottom edge: the measured clearance there is 44px + the 16px gutter = 60px, so
 *     pass at least `3.75rem` (`4.25rem` leaves an 8px gap). It is a HORIZONTAL reserve on
 *     purpose — z-index cannot help, because that cluster is deliberately above everything that
 *     is not a modal.
 *
 *
 * ── WHAT IT ASSUMES ABOUT ITS CONTAINER ─────────────────────────────────────────────────────
 * Each row is a full-bleed scroller written `-mx-3 px-3`: it breaks out of the canonical mobile
 * gutter so a chip can run to the screen edge, and keeps its own 12px lead-in so the first chip
 * is not welded to the bezel. That pairs with `max-w-7xl px-3 sm:px-6 lg:px-8` (the canonical
 * page width, docs/design-language.md) — mount it inside that gutter, as the facet bar already
 * is. `useScrollArrows` knows about this shape: it reads the scroller's own start padding so the
 * resting `scrollLeft === 12` is not mistaken for "the user has scrolled" and does not paint an
 * edge fade over a first chip nobody has moved past.
 *
 * ⚠️ NO TRANSFORMED / FILTERED / `contain`-ing ANCESTOR. The sticky line is `position: fixed`, and
 * a `transform`, `filter`, `backdrop-filter`, `perspective` or `contain: paint` anywhere above it
 * makes that ancestor the containing block instead of the viewport — the line would then scroll
 * away with the ladder and look like it simply does not work. So do not wrap this in the
 * `animate-in slide-in-from-*` the desktop roll-out uses; animate a CHILD, or animate opacity.
 *
 * There is no `lg:hidden` in here. This is the mobile SHAPE, not the mobile BREAKPOINT — the
 * caller owns which widths mount it, because the caller is the one that also owns the desktop
 * roll-out it replaces.
 */

/** The "nothing chosen at this level" sentinel — the same string the explorer already puts in
 *  its own state (`activeCategory === 'all'`, `activeBrand === 'all'`) and in the URL. Exported
 *  so a caller never has to re-type the magic word. */
export const LADDER_ALL = 'all'

/** One chip. */
export type LadderOption = {
  /**
   * ⚠️ THE EXACT SEARCH-PARAM VALUE THIS CHIP SETS, because it is ALSO the key this component
   * indexes into `DimensionCounts.values` with — `'honda'` for `?brand=honda`. The counts module
   * keys its record by the param value for precisely this reason (see facet-counts.ts), so a
   * caller that passes a display string here gets a countless chip rather than a wrong count.
   */
  value: string
  /** Visible text, ALREADY LOCALISED. These are taxonomy words and the taxonomy owns its own
   *  en/vi fields — same contract as ResultCrumb in result-line.tsx. */
  label: string
  /** Optional leading mark (a CategoryIcon, a BrandLogo). The caller builds it: this file has no
   *  business knowing that brands have logos and conditions do not. */
  icon?: ReactNode
}

/** One rung: a rail plus its selection. */
export type LadderLevel = {
  /** Stable identity — the dimension name (`'category'`, `'brand'`) is the natural choice. Used
   *  as the React key, as the crumb id, and as the `data-ladder-level` hook. */
  id: string
  /** Accessible name for the row, already localised (`tr('Brand', 'Hãng')`). It is NOT rendered
   *  as visible text: on a 390pt screen four labelled rows spend a third of the fold on words
   *  the chips beneath them already say. Screen readers still get it, via `aria-label`. */
  label: string
  /**
   * The chips, IN THE ORDER THEY SHOULD APPEAR.
   *
   * ⚠️ BUILD THIS FROM THE TAXONOMY, NEVER FROM `Object.keys(counts.values)`. The counts payload
   * honestly reports a number for any value the DATA carries — a category row that exists only
   * in the DB, a legacy `rent` listing in a category that is now buy-sell-only — and rendering
   * those would grow a chip the category does not offer. Which chips EXIST is a reviewed product
   * decision that lives in src/lib/taxonomy.ts; this component indexes into `values` and never
   * enumerates it. (facet-counts.ts states the same rule at the type.)
   *
   * ⚠️ AND THE ORDER IS YOURS. Nothing here sorts — not by count, not alphabetically. Partly
   * because the desktop rail's count-ordering is a caller behaviour that should stay in one
   * place, and partly because the counts payload is DEEP-FROZEN (it is a shared 60s memo entry)
   * and so is anything a caller derives from it; an in-place `.sort()` on a frozen array throws.
   */
  options: LadderOption[]
  /** Current selection. `LADDER_ALL` (or empty) = nothing chosen at this level. */
  value: string
  /** Called with the chip's `value`, or with `LADDER_ALL` when the active chip is tapped again
   *  (tap-to-toggle, exactly like the desktop rails). */
  onSelect: (value: string) => void
  /**
   * This rail's counts, straight off `GET /api/listings` → `facets[dimension]`.
   *
   * ⚠️ ABSENT MEANS "NOT COMPUTED", NEVER ZERO — and this component renders it that way: with no
   * `counts` the row degrades to its countless appearance, chips and all. That is load-bearing,
   * not defensive: `facets` is `{}` on every load-more (`offset > 0`) and under `?facets=0`, and
   * a row of honest-looking zeros there would tell the user their next tap returns nothing.
   *
   * When it IS present, `all` is the row's "All" chip — that dimension released, every other
   * filter still applied — and it is legitimately LARGER than the sum of the visible chips
   * (rows in no bucket: no brand set, condition null). Nothing here sums.
   */
  counts?: DimensionCounts
  /** Override for the "All" chip's text. Default `tr('All', 'Tất cả')`. */
  allLabel?: string
}

/** One rung of the collapsed path. */
export type LadderCrumb = { id: string; label: string }

export type MobileLadderProps = {
  /** Root first: category, subcategory, brand, model. See `visibleLevels` for what shows. */
  levels: LadderLevel[]
  /**
   * Clears the whole path from the sticky line. OPTIONAL, and deliberately NOT derived by
   * calling every level's `onSelect(LADDER_ALL)` in a loop: the caller's selections live in a
   * URL, and four sequential pushes are four history entries, four feed requests and four
   * renders where the ladder is half-cleared. One atomic reset is the caller's to write. With
   * no handler the sticky line still names the path; it just does not offer to clear it.
   */
  onClear?: () => void
  /**
   * Replaces the sticky line's default tap action. By default, tapping the path scrolls the
   * rows back under the dock line (measured from the bar's own rect — no chrome constants), so
   * the line is a way BACK into the ladder rather than a dead end that only offers deletion.
   * Pass this to do something else (open a filter sheet, focus a rail).
   */
  onReopen?: () => void
  /** CSS length for the sticky line's `top`. Default `var(--ladder-sticky-top, 0px)` — see the
   *  chrome notes in the file header for why 0 is a sane default and when to change it. */
  stickyTop?: string
  /** Stacking order for the sticky line. Default 30 — under #app-header (40) and well under the
   *  back-to-top cluster (60). */
  stickyZIndex?: number
  /** Horizontal reserve at the END of the sticky line, for a bottom dock that would otherwise
   *  run under the z-[60] back-to-top cluster. Default `var(--ladder-sticky-inset-end, 0px)`. */
  stickyInsetEnd?: string
  className?: string
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * PURE HELPERS — exported so the rules below are testable without a DOM, and so the integrator
 * can read the behaviour instead of inferring it from JSX.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The options a rail can actually render.
 *
 * ⚠️ AN OPTION WHOSE VALUE IS THE RELEASE SENTINEL CANNOT WORK, SO IT IS NOT A CHIP.
 * `LADDER_ALL` — and the empty string, which `allActive` below treats identically — is the
 * caller's URL vocabulary for "this level is released", so `?model=all` is indistinguishable
 * from no model at all. The state is unrepresentable, not merely awkward, and it is reachable:
 * the model rail is keyed by `Listing.model`, which is seller-typed free text. Rendered, such a
 * chip lies twice — it sits `aria-pressed` alongside the All chip whose value it shares (two
 * pressed chips in one row), and tapping it CLEARS the level instead of applying it, so it can
 * never be selected.
 *
 * ⚠️ IT LIVES HERE, NOT IN THE RAIL, BECAUSE VISIBILITY AND RENDERING MUST AGREE. When the rail
 * filtered these out privately, `visibleLevels` still counted them: a level whose ONLY option was
 * `all` passed the "has options" test and then rendered as an orphan row holding nothing but an
 * All chip — exactly the empty rung the rule below exists to hide. One predicate, both callers.
 *
 * ⚠️ IT ALSO DROPS A REPEATED VALUE, KEEPING THE FIRST. Two options with the same value are the
 * same filter listed twice — no correct caller produces it, but the same seller-typed free text
 * that makes the sentinel reachable makes this reachable. Rendered, it is a React duplicate-key
 * warning plus two chips both `aria-pressed` for one selection, and removing one is undefined.
 * First-wins keeps the caller's pick order, which is the thing the array is carrying.
 */
export function usableOptions(options: LadderOption[]): LadderOption[] {
  const seen = new Set<string>()
  return options.filter((o) => {
    if (o.value === LADDER_ALL || o.value === '' || seen.has(o.value)) return false
    seen.add(o.value)
    return true
  })
}

/**
 * Which rows are on screen: EVERY LEVEL THAT HAS USABLE OPTIONS.
 *
 * ⚠️ THE CASCADE IS NOT RE-DERIVED HERE FROM "IS THE LEVEL ABOVE CHOSEN", AND THAT WAS THE FIRST
 * DRAFT'S BUG. The obvious rule — show level i only once level i−1 has a selection — is wrong in
 * this taxonomy: the brand rail opens as soon as a CATEGORY is chosen, and most categories are
 * browsed with no subcategory at all, so that rule would hide brands behind a tap nobody makes.
 * The real dependency is already encoded in the data: `options` is non-empty only once the level
 * above has narrowed enough to produce them (the caller fetches brands for the current
 * category+subcategory, models for the current brand). So the cascade emerges from the props,
 * lives where the knowledge is, and cannot disagree with the fetch that produced it.
 *
 * An empty row would be a row of one "All" chip that filters nothing, which is why zero options
 * hides the whole rung rather than rendering an orphan.
 */
export function visibleLevels(levels: LadderLevel[]): LadderLevel[] {
  return levels.filter((lv) => usableOptions(lv.options).length > 0)
}

/**
 * The path the sticky line names: one crumb per level that HAS a selection, root first.
 *
 * ⚠️ A GAP DOES NOT END THE PATH — a level with no selection is SKIPPED, not treated as a
 * terminator. "Vehicles › Honda" (category and brand chosen, no subcategory) is a real state in
 * this explorer and the line must say both words; stopping at the first gap would silently drop
 * the brand from a line whose entire job is to state what is filtering the results.
 *
 * ⚠️ AN UNMATCHED SELECTION FALLS BACK TO ITS RAW VALUE rather than vanishing. A model picked
 * before its option list has landed, or a stale pick the caller has not healed yet, is still
 * filtering the feed — showing `honda-vision` is ugly, showing nothing is a lie.
 *
 * ⚠️ THIS IS THE PATH, NOT A PROMISE THAT IT IS ON SCREEN. `<MobileLadder>` renders nothing at
 * all when NO level has options (see the early return), so a path computed entirely from
 * unmatched values has no rows to sit under and no line is drawn. That combination means the
 * whole ladder is still loading, which is the one state where saying nothing is right.
 */
export function ladderPath(levels: LadderLevel[]): LadderCrumb[] {
  const out: LadderCrumb[] = []
  for (const lv of levels) {
    if (!lv.value || lv.value === LADDER_ALL) continue
    const hit = lv.options.find((o) => o.value === lv.value)
    out.push({ id: lv.id, label: hit ? hit.label : lv.value })
  }
  return out
}

/** Clamp whatever arrived to something a chip can honestly display. */
function safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

/**
 * The number beside one chip — `null` when this rail has no counts at all.
 *
 * ⚠️ `hasOwnProperty`, NOT A BARE INDEX. `values` is keyed by free-form data for the model rail
 * (`Listing.model` is seller-typed text), so a plain `values[value]` on a model literally called
 * "constructor" or "toString" returns a FUNCTION off Object.prototype, which then formats as
 * "NaN" on the chip. An own-property check costs nothing and closes it by construction.
 *
 * A missing own key is 0, which is the contract facet-counts.ts states ("a missing key means
 * zero"): every dimension with a static option list is pre-seeded with zeros, and the one that
 * is not — model — is genuinely zero for anything the data did not report.
 */
export function optionCount(counts: DimensionCounts | undefined, value: string): number | null {
  if (!counts) return null
  /**
   * ⚠️ `values` IS GUARDED AT RUNTIME EVEN THOUGH THE TYPE PROMISES IT, BECAUSE THE TYPE IS A
   * COMPILE-TIME PROMISE ABOUT A JSON PAYLOAD NOBODY VALIDATES. These arrive straight off
   * `GET /api/listings` → `facets[dimension]`, and `hasOwnProperty.call(undefined, k)` does not
   * return false — it throws `TypeError: Cannot convert undefined or null to object` (measured).
   * A `{"all":12}` with no `values`, from a version skew or a truncated response, would therefore
   * take the whole explorer subtree down to an error boundary rather than costing one row its
   * numbers. `allChipCount` already clamps a hostile `all`; this is the same courtesy for the
   * field that can actually throw, and the asymmetry is what gave it away.
   */
  const values = counts.values
  if (typeof values !== 'object' || values === null) return 0
  return Object.prototype.hasOwnProperty.call(values, value) ? safeCount(values[value]) : 0
}

/**
 * The number beside the "All" chip — `null` when this rail has no counts.
 *
 * ⚠️ IT IS `counts.all` AND IT IS NOT THE SUM OF THE CHIPS. Releasing this dimension also
 * returns the rows that fall in NO bucket (no brand set, condition null), so `all` is always
 * ≥ the visible total and the difference is real inventory, not a bug to reconcile.
 */
export function allChipCount(counts: DimensionCounts | undefined): number | null {
  return counts ? safeCount(counts.all) : null
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * ONE ROW
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

// Chip geometry. `min-h-11` is a REAL 44px box, not the `tap-44` ::before: that pseudo grows an
// invisible hit area OUTSIDE the visual box, and in a row of chips separated by 8px the two hit
// areas overlap — a tap near the boundary then fires the neighbouring filter. (Same trap
// ui/icon-button documents for `tapTarget={false}`, seen from the other side: here there is room
// to make the control genuinely big, so we do that instead.)
//
// ⚠️ `whitespace-normal` IS REQUIRED, NOT COSMETIC: ui/button's base is `whitespace-nowrap` and
// white-space INHERITS, so without it the label below can never wrap and `max-w` just clips.
// ⚠️ `max-w-[75%]` bounds a pathological label ("Xe máy điện VinFast Feliz S 2023 bản đặc biệt")
// to three quarters of the viewport instead of letting one chip become the whole row.
// No `.press` here: ui/button already bakes the press scale at 0.97, and `.press` now emits the
// same `scale` property from @layer components, so adding it changes nothing but the reading.
// ⚠️ NO SCROLL SNAP ON A CHIP ROW — it was here and it was removed. `snap-x` is proximity
// snapping, so after a programmatic `scrollTo` the browser pulls the nearest chip flush to the
// edge, silently eating the 12px lead-in the auto-scroll below computes. Snapping earns its keep
// on a rail of CARDS, where each item is a page-sized unit; a row of variable-width chips just
// feels notchy, and one of the two behaviours had to give.
const CHIP =
  'min-h-11 max-w-[75%] shrink-0 items-center gap-1.5 whitespace-normal rounded-full px-3 py-1.5 text-left text-sm font-semibold transition-colors'
// Flat canon (§3b): a chip that must sit apart uses `tint`, and the ACTIVE state is the
// brand-50 tint pattern the rest of the app already uses for selection — never a restored card.
const CHIP_IDLE = 'bg-tint text-body hover:text-foreground'
const CHIP_ACTIVE = 'bg-brand-50 text-accent-foreground'

function LadderRail({ level }: { level: LadderLevel }) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang)

  // Unusable options never become chips — see `usableOptions`. The diagnostic for that lives
  // in <MobileLadder>, not here, because a level whose options are ALL unusable never mounts a
  // rail at all and this effect would never run for it.
  const options = usableOptions(level.options)

  /**
   * ⚠️ `watch` MUST CHANGE WHEN THE COUNTS ARRIVE, NOT ONLY WHEN THE OPTIONS DO.
   *
   * useScrollArrows' ResizeObserver watches the scroller's OWN border box, which does not move
   * when its children overflow it — only `scrollWidth` grows — so a rail that mounted narrow
   * stays arrow-less forever unless something re-runs `sync` (the brand-rail bug, 2026-07-23).
   * Options arriving is the obvious trigger; counts arriving is the one that is easy to miss,
   * because `facets` lands in a SECOND payload and every chip in the row gets wider by a number
   * at once.
   *
   * ⚠️ SO THE DEP IS A SIGNATURE OF WHAT IS ACTUALLY RENDERED, NOT A COUNT OF IT. Three separate
   * things move this row's total width without moving its LENGTH, and each was a real stale-arrow
   * bug on its own:
   *   · the counts landing — `facets` arrives in a second payload and every chip grows a number;
   *   · a count VALUE changing — applying another filter turns "5" into "1.2k", which is wider;
   *   · the language — EN↔VI rewrites every label ("For sale" → "Đang bán", "All" → "Tất cả").
   * A same-length option REPLACEMENT (one brand's models swapped for another's) is covered too,
   * because the values differ. Building the string is O(chips) on a row of at most a few dozen,
   * which is nothing next to the layout the hook is about to force.
   *
   * ⚠️ KNOWN GAP, AND IT IS WIDER THAN "RELABELLING" — do not read this dep as total coverage.
   * It cannot see anything that changes a chip's width without changing its VALUE, its COUNT or
   * the language. Two such things:
   *   · a relabel at a fixed value — not reachable from the taxonomy, whose labels are keyed to
   *     their values, and including labels would churn this dep on every render of a caller that
   *     builds them inline;
   *   · an `icon` that resolves LATE. An image with no intrinsic size reflows every chip when it
   *     loads, and the hook's ResizeObserver still sees an unchanged scroller box. The repo's own
   *     marks avoid it by reserving their box up front (`<BrandLogo size={48}>` sets width and
   *     height), which is the fix at the call site: pass an icon that has a size before it loads.
   */
  // ⚠️ JSON, NOT a joined string. Values are free-form caller text, so ANY literal separator can
  // appear inside one and two different rows could encode to the same key. JSON escapes its own
  // delimiters, so this is unambiguous by construction rather than by hoping. (Same argument
  // ResultLine's `chipKey` makes, for the same reason.)
  const railSignature = JSON.stringify([
    lang,
    options.map((o) => o.value),
    options.map((o) => optionCount(level.counts, o.value)),
    allChipCount(level.counts),
  ])
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows<HTMLDivElement>({
    watch: railSignature,
  })

  /**
   * Bring the active chip into view when the selection changes from somewhere OTHER than a tap
   * on this row — a back/forward navigation, a URL restore, a healed stale pick.
   *
   * ⚠️ NEVER `el.scrollIntoView()`. It walks up and scrolls EVERY scrollable ancestor including
   * the document, which on this page drags the whole results view sideways and clips its left
   * edge (brand-rail and category-rail both carry this warning; this is the third copy on
   * purpose, so the three stay comparable). Move this container's own `scrollLeft` instead.
   *
   * ⚠️ AND ONLY WHEN THE CHIP IS ACTUALLY OFF-SCREEN. The common case is a tap on a chip that is
   * already visible; re-anchoring it to the left edge there would slide the row out from under
   * the finger that just used it.
   *
   * ⚠️ IT WAITS FOR THE CHIP TO EXIST, WHICH IS THE WHOLE CASE IT WAS WRITTEN FOR AND THE FIRST
   * VERSION MISSED IT. Keying on `level.value` alone fails on exactly a URL restore: the value
   * lands immediately, this runs while the rail is still empty, finds nothing, and returns — and
   * because the value never changes again, no later render re-runs it. The chips arrive and the
   * selected one is left off-screen, so the user has to swipe to find what is filtering their
   * feed. `chipExists` flips false→true on the render the options land, which is the trigger.
   * (It is deliberately NOT `level.options`, whose identity churns on every parent render for a
   * caller that builds the array inline — that would drag the rail back under the user's finger
   * every time anything above re-rendered.)
   */
  const chipExists = options.some((o) => o.value === level.value)
  useEffect(() => {
    const container = scrollerRef.current
    if (!container || !level.value || level.value === LADDER_ALL) return
    // ⚠️ FOUND BY SCANNING `dataset`, NOT BY AN ATTRIBUTE SELECTOR. The model rail is keyed by
    // `Listing.model`, which is SELLER-TYPED FREE TEXT — a quote, a bracket or a backslash in it
    // makes `[data-ladder-chip="…"]` either throw or silently match nothing, and `CSS.escape` is
    // not present in every environment this file is exercised in.
    const el = Array.from(container.querySelectorAll<HTMLElement>('[data-ladder-chip]')).find(
      (n) => n.dataset.ladderChip === level.value,
    )
    if (!el || typeof container.scrollTo !== 'function') return
    const cr = el.getBoundingClientRect()
    const pr = container.getBoundingClientRect()
    /**
     * ⚠️ THE MINIMUM SCROLL THAT REVEALS THE CHIP — NOT "ANCHOR IT TO THE LEFT EDGE", WHICH CAUSED
     * THE EXACT JOLT THE COMMENT ABOVE PROMISES TO AVOID.
     *
     * The first version bailed out only when the chip was ENTIRELY inside the rail and otherwise
     * pulled it flush to the left. So tapping a chip poking half-way past the RIGHT edge — an
     * ordinary thing to do, the chip is right there under the thumb — slid the whole row a screen
     * sideways to re-anchor it, moving every other chip out from under the finger that just acted.
     * A reviewer caught it; it is the same failure the guard was written to prevent, one case over.
     *
     * So: nudge from whichever edge is cutting it, by exactly enough plus a 12px lead-in so the
     * chip does not land welded to the edge fade. Fully visible with room to spare, nothing moves.
     */
    const LEAD = 12
    const delta =
      cr.left < pr.left + LEAD ? cr.left - pr.left - LEAD : cr.right > pr.right - LEAD ? cr.right - pr.right + LEAD : 0
    if (delta === 0) return
    container.scrollTo({
      left: Math.max(0, container.scrollLeft + delta),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
    /**
     * ⚠️ `railSignature` IS A DEP, NOT JUST THE ARROWS' — the chip can leave the viewport without
     * anything about the SELECTION changing. Deep-link `?brand=honda` with honda ninth in the row:
     * first paint has no counts, this brings it into view, then `facets` lands and every chip to
     * its left grows a number and pushes it back off the right edge. `level.value` and
     * `chipExists` are both unchanged, so without this the chip filtering the feed sits off-screen
     * behind a swipe. Same signature the arrows already re-sync on, for the same reason.
     *
     * ⚠️ THIS DEP IS ONLY SAFE BECAUSE THE SCROLL ABOVE IS A MINIMUM NUDGE. While it anchored the
     * chip to the left edge, re-running on every count update would have yanked the row sideways
     * each time the feed refreshed. A no-op when the chip is comfortably visible is what makes
     * "re-check whenever the row's geometry moves" the cheap, correct thing to do.
     */
  }, [level.value, chipExists, railSignature, scrollerRef])

  const allActive = !level.value || level.value === LADDER_ALL
  const allCount = allChipCount(level.counts)

  return (
    // `relative` anchors the arrows, which sit OUTSIDE the scroller's edges.
    <div role="group" aria-label={level.label} data-ladder-level={level.id} className="relative">
      <div
        ref={scrollerRef}
        // railEdgeMask — the repo's ONE edge treatment (shelf.tsx): a MASK, never a painted
        // overlay (the flat canon bans new fills), fading ONLY the side that can still scroll,
        // so the first chip is never dimmed at rest and the fade disappears once the row fits.
        // ScrollArrows is the same rule for the pointer affordance: each chevron renders solely
        // when there is room to scroll THAT way, and neither renders on touch.
        style={railEdgeMask(canLeft, canRight)}
        // overscroll-x-contain keeps a sideways flick that hits either end INSIDE this row
        // instead of chaining out to an ancestor scroller / the iOS WebView swipe-back. It
        // cannot suppress a drag that STARTS in the system edge gutter — see RAIL_SCROLLER.
        // -mx-3 px-3: full-bleed to the screen edge, own 12px lead-in. See the file header.
        className="-mx-3 flex items-center gap-2 overflow-x-auto overscroll-x-contain scrollbar-none px-3 py-1"
      >
        <Chip
          value={LADDER_ALL}
          label={level.allLabel ?? tr('All', 'Tất cả')}
          count={allCount}
          locale={locale}
          active={allActive}
          // ⚠️ NO-OP WHEN IT IS ALREADY THE STATE. The caller's selections live in a URL, so an
          // unconditional call here is a redundant history entry and a redundant feed request
          // every time someone taps the chip they are already standing on. The option chips need
          // no such guard: tapping an active one is a real change (it releases the level).
          onSelect={() => {
            if (!allActive) level.onSelect(LADDER_ALL)
          }}
        />
        {options.map((opt) => {
          const active = level.value === opt.value
          return (
            <Chip
              key={opt.value}
              value={opt.value}
              label={opt.label}
              icon={opt.icon}
              count={optionCount(level.counts, opt.value)}
              locale={locale}
              active={active}
              // Tap-to-toggle, matching the desktop rails: tapping the chip you are already on
              // releases the level rather than re-applying it.
              onSelect={() => level.onSelect(active ? LADDER_ALL : opt.value)}
            />
          )
        })}
      </div>
      <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} tight />
    </div>
  )
}

function Chip({
  value,
  label,
  icon,
  count,
  locale,
  active,
  onSelect,
}: {
  value: string
  label: string
  icon?: ReactNode
  count: number | null
  locale: MoneyLocale
  active: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="bare"
      size="none"
      // ⚠️ `iconSize={false}` — ui/button's base carries `[:where(&)_svg]:size-4`, which
      // out-specificities an svg's width/height ATTRIBUTES (presentational attrs have
      // specificity 0) and silently shrinks a BrandLogo passed as `icon` to 16px. The caller
      // owns the mark and therefore owns its size; this just stops the primitive overriding it.
      // (brand-rail.tsx hit exactly this and carries the same flag.)
      iconSize={false}
      data-ladder-chip={value}
      /**
       * A chip is a toggle, so it reports PRESSED state rather than pretending to be a link.
       *
       * ⚠️ WHAT WAS RULED OUT, NAMED, because "why not the primitive" is the first question canon
       * asks of a hand-composed control:
       *   · A RADIOGROUP — no. Base UI radios are selection-follows-focus, so arrowing along this
       *     row would fire a feed request per key press.
       *   · Base UI's own TOGGLE / TOGGLE-GROUP — measured, both ship in `@base-ui/react`, and it
       *     is the standing first choice. But there is still no `src/components/ui/toggle-group`
       *     primitive, and canon is "Base UI first VIA a ui/* primitive"; creating that primitive
       *     is a shared-surface change outside this component's remit. The repo already made this
       *     exact call twice — the trip stay/stop refine dialogs are `role="group"` + `<Button
       *     aria-pressed>` with the same note — so this matches the established shape instead of
       *     hand-rolling a third one. If `ui/toggle-group` ever lands, this row should move to it.
       */
      aria-pressed={active}
      onClick={onSelect}
      className={cn(CHIP, active ? CHIP_ACTIVE : CHIP_IDLE)}
    >
      {icon}
      {/* ⚠️ ALL THREE CLASSES, AND `line-clamp-2` IS THE ONE THAT MAKES THE OTHER TWO WORK.
          This span is a flex item, so its automatic minimum size is its MIN-CONTENT width — and
          `break-words` (overflow-wrap) does NOT reduce min-content, it only permits a break to
          avoid overflow once a width is settled. So on a single unbreakable seller-typed token
          the span refuses to shrink, `w-full` resolves against a content-sized parent, and the
          label paints straight over the chip beside it. What fixes it is the clamp's
          `overflow: hidden`: CSS zeroes a flex item's automatic minimum size when overflow is not
          visible, so the span can finally shrink to `w-full` and wrap/ellipsise inside the chip.
          This is byte-for-byte the trio category-rail and brand-rail carry on their tile labels;
          shipping two of the three was the regression, and a reviewer caught it. */}
      <span className="line-clamp-2 w-full break-words">{label}</span>
      {/* ⚠️ THROUGH THE REPO'S COUNT FORMATTER, NEVER `{count}`. Vietnamese groups thousands with
          a DOT, so a bare number is wrong at 1000 and up; formatCount is also the COMPACT one
          ("1,2k"), which is the right tool on a chip — result-line.tsx uses groupVnd instead
          precisely because the exact total is its whole point. `count === null` = this rail has
          no counts, which is a different thing from zero and renders nothing at all. */}
      {count !== null && <span className="shrink-0 text-3xs font-semibold text-ink-4">{formatCount(count, locale)}</span>}
    </Button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE LADDER
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Fallback sticky chrome. NAMED so the component can tell whether the caller actually chose it
 *  — see the development warning in <MobileLadder>, and the chrome notes in the file header for
 *  why these are a safe fallback rather than the production setting. */
export const STICKY_TOP_DEFAULT = 'var(--ladder-sticky-top, 0px)'
/**
 * ⛔ 29, NOT 30 — z-30 IS ALREADY TAKEN BY THE BAR THIS ONE DOCKS BESIDE.
 *
 * The explorer's own sort strip (explorer-toolbar.tsx) is `sticky z-30 … bg-background/95
 * backdrop-blur`, in the SAME subtree, docking at the SAME top band, driven by the same
 * useHideOnScroll() as the header. Neither it nor the ladder has a stacking-context ancestor —
 * `#listings` is `relative` with z-index auto — so at equal z-index the root stacking context
 * falls back to DOM ORDER, and the sort strip is mounted later. Its opaque background would paint
 * straight over the collapsed path line: the one piece of chrome whose entire job is to still tell
 * you where you are after everything else has scrolled away.
 *
 * Sitting one BELOW is the correct answer rather than one above. The path line is a passive
 * indicator; the sort strip is interactive and its dropdown must not open behind anything. If they
 * ever need to coexist visually, the fix is a shared docking offset so they stack, not a z-index
 * race — and either way the integrator can override this per surface.
 */
export const STICKY_Z_DEFAULT = 29
export const STICKY_INSET_END_DEFAULT = 'var(--ladder-sticky-inset-end, 0px)'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function MobileLadder({
  levels,
  onClear,
  onReopen,
  stickyTop = STICKY_TOP_DEFAULT,
  stickyZIndex = STICKY_Z_DEFAULT,
  stickyInsetEnd = STICKY_INSET_END_DEFAULT,
  className,
}: MobileLadderProps) {
  const { tr } = useLanguage()
  const rows = visibleLevels(levels)
  const path = ladderPath(levels)

  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  /**
   * DEVELOPMENT DIAGNOSTIC. The one thing this component silently absorbs, named out loud so a
   * caller fixes it instead of wondering where a chip went.
   *
   * ⚠️ THE DROPPED-OPTION WARNING LIVES HERE, NOT IN THE RAIL, AND THAT IS THE WHOLE POINT. It was
   * in `LadderRail` first, which put it exactly where it could not fire in the worst case: a level
   * whose options are ALL unusable fails `visibleLevels`, so no rail mounts, so no effect runs —
   * a caller shipping `options: [{ value: 'all' }]` lost the entire rung in silence. Walking
   * `levels` (not `rows`) sees every one of them.
   *
   * ⛔ A "YOU LEFT THE STICKY CHROME AT ITS DEFAULT" WARNING WAS ADDED HERE AND THEN REMOVED — do
   * not re-add it in this form. It compared the PROP against `STICKY_TOP_DEFAULT`, and that
   * default is itself `var(--ladder-sticky-top, 0px)`: setting that CSS variable on an ancestor
   * is one of the two documented ways to configure this component, so an integrator who had done
   * exactly the right thing was warned anyway, forever. A check that fires on the correct
   * configuration is worse than none, because the first thing anyone does with it is mute it.
   * Making it sound means resolving the variable (`getComputedStyle` on the bar) rather than
   * comparing a string. The trade-off is documented in the chrome notes at the top of the file
   * instead, where it can be read before the component is wired rather than after.
   */
  const dropped = levels.reduce((n, lv) => n + (lv.options.length - usableOptions(lv.options).length), 0)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    if (dropped > 0) {
      console.warn(
        `<MobileLadder>: dropped ${dropped} option(s) that cannot be rendered as a chip — a value ` +
          `of "${LADDER_ALL}" or "" (both mean "nothing chosen at this level", here and in the ` +
          'URL, so the chip would CLEAR the level instead of applying it), or a value repeated ' +
          'within its row (one filter, two chips). Give each option a distinct, non-sentinel ' +
          'value. The listings themselves are untouched and still reach the feed.',
      )
    }
  }, [dropped])

  /**
   * ⚠️ THE STICKY LINE IS ALWAYS MOUNTED WHILE THERE IS A PATH, AND ONLY ITS VISIBILITY MOVES.
   *
   * It is what the observer's threshold is measured FROM: the dock line is `bar.top + bar.height`,
   * read from the bar's own rect. Reading it that way is the whole point — `stickyTop` may be a
   * `var()`, a `calc()`, or an `env(safe-area-inset-top)` that only the browser can resolve, and
   * #app-header has three heights, so any JS that adds up chrome constants is wrong on some
   * device. An unmounted bar has no rect, which is why this fades rather than unmounts.
   *
   * Hidden state is `opacity-0 pointer-events-none` + `inert` — NOT a transform and NOT `hidden`.
   * A transform would move the rect we measure; `hidden` would delete it. `inert` is the one
   * lever that takes an invisible control out of the tab order AND the accessibility tree
   * (back-to-top.tsx makes the same three-part argument for the same reason).
   */
  useEffect(() => {
    /**
     * Nothing rendered means nothing to collapse — and the flag must not SURVIVE the gap. Left
     * true, the bar remounts already opaque and already swallowing taps (including Clear) for the
     * frame before the observer's first callback lands.
     *
     * ⚠️ BOTH CONDITIONS, AND `rows.length` WAS THE ONE MISSING. The component also disappears
     * when every rail empties, which happens with the path INTACT: switch category while scrolled
     * into the results and the brand/model rails go empty for a tick while they refetch, so
     * `path.length` never moves and the reset never fired. The page then shortens, the browser
     * lands near the top, the rails return — and the bar reappears docked over content the user
     * is looking straight at. Same defect as the path case, one condition over.
     */
    if (path.length === 0 || rows.length === 0) {
      setCollapsed(false)
      return
    }
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    let io: IntersectionObserver | null = null
    const attach = () => {
      io?.disconnect()
      const r = barRef.current?.getBoundingClientRect()
      const dock = r ? Math.max(0, Math.round(r.top + r.height)) : 0
      io = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1]
          if (!e) return
          /**
           * ⚠️ `boundingClientRect` IS VIEWPORT-RELATIVE AND `rootBounds` IS THE SHIFTED ONE —
           * COMPARING THE TARGET AGAINST 0 WAS WRONG, AND WRONG BY EXACTLY THE DOCK OFFSET.
           *
           * `rootMargin` moves the ROOT rectangle, which surfaces as `entry.rootBounds`. The
           * target's own rect is never adjusted. So the first version — `!isIntersecting &&
           * boundingClientRect.top < 0` — asked "have the rows passed the top of the SCREEN",
           * when the question is "have they passed the DOCK LINE". Everything in between reads
           * as neither: the rows are already hidden under the bar, `isIntersecting` is false,
           * and `top` is still positive, so no line appears.
           *
           * The size of the hole is the dock offset, and it bites the DEFAULT configuration too
           * — `stickyTop: 0` still docks at the bar's bottom edge, so `dock` is the bar's own
           * 44px height and the line arrives 44px late. An integrator who follows this file's
           * own advice and sets `stickyTop` to the resolved header height gets 100px+ of
           * scrolling with the rows behind the header and no path line at all. Three reviewer
           * families converged on it independently.
           *
           * The honest predicate is purely geometric: the rows are behind the dock when their
           * BOTTOM edge is at or above the root's top edge. That also subsumes the old
           * `!isIntersecting` half — a ladder still below the fold has a bottom far greater than
           * the root top, so it cannot be mistaken for a collapsed one. `rootBounds` is nullable
           * (a cross-origin iframe root), so the measured `dock` is the fallback, which is the
           * same number the margin was built from.
           */
          setCollapsed(e.boundingClientRect.bottom <= (e.rootBounds?.top ?? dock))
        },
        { rootMargin: `-${dock}px 0px 0px 0px`, threshold: 0 },
      )
      io.observe(root)
    }
    attach()
    // Re-attach on anything that can move the dock line or the rows: the rows growing a level,
    // the bar's own box changing, a rotation, the safe-area resolving on a native launch.
    //
    // ⚠️ HONEST LIMIT, STATED RATHER THAN IMPLIED: a ResizeObserver reports SIZE, not POSITION,
    // so a change that only moves the bar DOWN — the prelaunch banner mounting above the header,
    // one of #app-header's three geometries swapping — does not re-attach here, and the
    // observer keeps firing at the old threshold until the next resize. The consequence is
    // bounded to the delta: the predicate above reads the CURRENT `rootBounds`, so the answer
    // stays correct, only the pixel at which it is recomputed is stale. Closing it properly
    // needs the integrator to remount on the geometry change, which is why `stickyTop` is a
    // prop — a component cannot observe chrome it does not own.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(attach) : null
    ro?.observe(root)
    if (barRef.current) ro?.observe(barRef.current)
    window.addEventListener('resize', attach)
    return () => {
      io?.disconnect()
      ro?.disconnect()
      window.removeEventListener('resize', attach)
    }
    /**
     * ⚠️ ALL THREE DEPS ARE LOAD-BEARING, AND `rows.length` WAS MISSING — WHICH KILLED THE STICKY
     * LINE OUTRIGHT ON A DEEP LINK. The element this observes only exists while `rows.length > 0`
     * (the component returns null otherwise), so `rootRef.current` is null on any render before
     * the options land. Land on `?category=vehicles&brand=honda`: first paint has empty option
     * lists, `ladderPath` still yields two crumbs from its raw-value fallback, so the effect DOES
     * run — hits `if (!root) return`, attaches nothing, registers no cleanup. The options then
     * arrive with `path.length` still 2, the effect never re-runs, and no IntersectionObserver is
     * ever constructed: the bar stays inert for the whole life of the mount and the feature
     * simply does not exist in the restore case. Two reviewer families found it independently.
     * The same dep also covers rows vanishing and returning across a refetch, which would
     * otherwise leave the observer watching a detached node.
     *
     * `path.length`: the bar only exists once there IS a path, so this is the render where
     * `barRef` first becomes measurable and the dock must be re-read rather than left at 0.
     * `stickyTop`: it IS the dock offset. A caller that swaps it (the prelaunch banner mounting,
     * a header geometry change) must get a new rootMargin, and a ResizeObserver cannot see a
     * position-only move. The residual gap is a `--ladder-sticky-top` CSS var changing underneath
     * a constant prop, which is noted above and is the integrator's to remount on.
     */
  }, [path.length, rows.length, stickyTop])

  /**
   * Default action for the sticky line: put the rows back on screen, just under the dock.
   *
   * `window.scrollBy` with a MEASURED delta, not `scrollIntoView`: the rows sit inside a
   * horizontal scroller stack, and scrollIntoView would scroll every scrollable ancestor —
   * including those rows sideways — to satisfy a vertical request.
   */
  const reopen = useCallback(() => {
    if (onReopen) {
      onReopen()
      return
    }
    const root = rootRef.current
    if (!root || typeof window.scrollBy !== 'function') return
    /**
     * ⚠️ THE TARGET IS THE BAR'S TOP, NOT THE DOCK LINE — because by the time the scroll lands the
     * BAR IS GONE. Bringing the rows back into view is exactly what un-collapses them, so aiming
     * at `top + height` (the threshold the observer uses) overshoots by the bar's own 44px and
     * parks the rows that far below the header, with a strip of whatever precedes them showing
     * through the space the bar had occupied. `r.top` is where the chrome above actually ends.
     */
    const r = barRef.current?.getBoundingClientRect()
    const restTo = r ? Math.max(0, r.top) : 0
    window.scrollBy({ top: root.getBoundingClientRect().top - restTo, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [onReopen])

  // ⚠️ NO ROWS MEANS NO COMPONENT, INCLUDING NO STICKY LINE — a decision, not an oversight.
  // The line's whole affordance is "tap to go back to the ladder", so drawing it above a ladder
  // that does not exist yet is a control that leads nowhere. The state only occurs while
  // everything is still loading, since one level having options is what makes a rung reachable.
  if (rows.length === 0) return null

  return (
    <div ref={rootRef} data-slot="mobile-ladder" className={cn('flex flex-col gap-1', className)}>
      {rows.map((level) => (
        <LadderRail key={level.id} level={level} />
      ))}

      {path.length > 0 && (
        <div
          ref={barRef}
          data-slot="mobile-ladder-sticky"
          aria-hidden={!collapsed || undefined}
          inert={!collapsed}
          style={{
            top: stickyTop,
            zIndex: stickyZIndex,
            // The gutter plus whatever the integrator must keep clear of the z-[60] cluster.
            paddingRight: `calc(0.75rem + ${stickyInsetEnd})`,
          }}
          // Flat canon: a bar is the canvas plus a hairline, never a floating box. `hairline-b`
          // is that line at ONE device pixel rather than two on a dpr-2 phone.
          className={cn(
            'fixed inset-x-0 flex min-h-11 items-center gap-2 bg-background pl-3 hairline-b transition-opacity duration-200 motion-reduce:transition-none',
            collapsed ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <nav aria-label={tr('Selected path', 'Đường dẫn đã chọn')} className="min-w-0 flex-1">
            <Button
              type="button"
              variant="bare"
              size="none"
              onClick={reopen}
              className="min-h-11 w-full min-w-0 justify-start gap-1 py-1.5 text-left text-xs font-semibold"
            >
              {path.map((c, i) => {
                const last = i === path.length - 1
                return (
                  <Fragment key={`${c.id}-${i}`}>
                    {i > 0 && (
                      <span aria-hidden="true" className="shrink-0 text-ink-4">
                        {PATH_SEP}
                      </span>
                    )}
                    {/* ⚠️ THE DEEPEST RUNG NEVER ELLIPSISES AWAY. Earlier rungs are `min-w-0
                        shrink truncate`, so they give up width first; the last one is
                        `shrink-0` inside its own `max-w` cap, so it is bounded (and truncates
                        within that bound) but is never the thing that disappears. A path line
                        that ends in "Vehicles › Manual › …" has told the user nothing — the
                        rung they just chose is the one they are looking for. */}
                    <span
                      className={cn(
                        'truncate',
                        last ? 'max-w-[60%] shrink-0 text-accent-foreground' : 'min-w-0 shrink text-body',
                      )}
                    >
                      {c.label}
                    </span>
                  </Fragment>
                )
              })}
            </Button>
          </nav>

          {onClear && (
            <IconButton
              size="lg"
              aria-label={tr('Clear selection', 'Xóa lựa chọn')}
              onClick={onClear}
              className="shrink-0 text-body transition-colors hover:text-foreground"
            >
              <X className="h-[42px] w-[42px] shrink-0" strokeWidth={STROKE_UI} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  )
}
