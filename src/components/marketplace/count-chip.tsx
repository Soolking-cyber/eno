'use client'

import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { groupVnd, moneyLocale } from '@/lib/vnd'
import type { DimensionCounts } from '@/lib/facet-counts'
import type { TrFn } from './result-line'

/**
 * THE NUMBER BESIDE A CHIP — "how many results if I tap this".
 *
 * One component for all four rails (category tiles, subcategory chips, brand tiles, model chips)
 * so they cannot drift in size, colour, grouping or the way a screen reader says them. Before
 * this existed the app had exactly one of them — a hand-written
 * `<span className="ml-1 text-3xs font-semibold text-ink-4">{count}</span>` restated in
 * category-rail.tsx (twice) and brand-rail.tsx (twice) — and every copy formatted the number by
 * interpolating it raw, which is a comma-grouped English figure shown to a Vietnamese reader.
 *
 * ⚠️ THE TYPE IS `number | null | undefined` AND THE THREE MEAN DIFFERENT THINGS. `0` renders
 * "0", because a zero is information: "Scooter 0" tells a buyer the taxonomy still has that shelf
 * and it is empty today, while hiding the chip is how a taxonomy silently shrinks. `null` /
 * `undefined` render NOTHING, because an absent dimension in the payload means "not computed"
 * (`facets` is `{}` on a load-more page and with `?facets=0` — see src/lib/facet-counts.ts), and a
 * rail with no numbers is the honest degraded state. A component that mapped both to "0" would
 * publish a row of zeros over a catalogue full of listings.
 *
 * ⚠️ ON THE CURRENTLY SELECTED CHIP THE NUMBER MEANS "WHAT YOU ARE LOOKING AT", NOT "WHAT THIS TAP
 * RETURNS" — because every rail in this app toggles, so tapping the active chip CLEARS it and
 * returns more. The count describes the OPTION, which is the same thing for the other chips and
 * the size of the current selection for this one; the number that answers the active chip's tap is
 * the "All" chip sitting beside it, which is why every rail renders one. Pre-existing behaviour of
 * the subcategory and model chips, now uniform across the tiles too; a rail that blanked its
 * selected chip would lose the one number a user most wants to read back.
 */

/** Clamp to a countable integer. A row count can only ever arrive negative or fractional from a
 *  caller bug, and "0" beside a chip is the least wrong thing to say when that happens. */
function clampCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

/**
 * The digits a viewer sees: "2,418" (en) / "2.418" (vi).
 *
 * ⚠️ `groupVnd`, NOT `formatCount`, AND THAT IS MEASURED RATHER THAN ASSUMED. `formatCount` is the
 * module's COMPACT count formatter: `formatCount(2418, 'vi')` returns '2,4k' (src/lib/vnd.test.ts
 * pins the same shape at 1200 → '1.2k'), which is both imprecise and — because the compact form
 * puts a COMMA where Vietnamese puts a decimal comma — reads as "2.4 thousand" spelled with the
 * wrong separator on the one screen where the number is meant to be an exact answer. `groupVnd` is
 * the grouping half of the same module and the only one that gets the Vietnamese separator right:
 * vi groups thousands with a DOT, en with a comma. count-chip.test.tsx asserts both, and asserts
 * the formatCount value too, so the reason this is not formatCount cannot rot silently.
 */
export function countDigits(count: number, lang: string): string {
  return groupVnd(String(clampCount(count)), moneyLocale(lang))
}

/**
 * What the chip SOUNDS like: "412 listings" / "412 tin đăng".
 *
 * ⚠️ THIS EXISTS BECAUSE "Honda 412" IS NOT WHAT A SCREEN READER SHOULD SAY. A bare number
 * appended to a label is concatenated into the button's accessible name, so the tile announces
 * "Honda 412, button" — and "Honda 412" is a perfectly plausible model designation. The number
 * stops being a result count and becomes part of the product name, which is worse than silence: a
 * blind buyer would hear a brand that does not exist. So the digits are `aria-hidden` and this
 * phrase is what the accessible name carries instead: "Honda, 412 listings". The unit is named,
 * the comma gives the pause, and the visual stays a bare number for the sighted reader who has
 * the whole rail for context.
 *
 * ⚠️ VIETNAMESE HAS NO PLURAL INFLECTION, so the noun is chosen PER LANGUAGE rather than by
 * pluralising English and translating the result — `tr('listing', …)` and `tr('listings', …)` are
 * two independent catalogue entries whose Vietnamese side is the same invariant "tin đăng". Both
 * halves are plain single-quoted literals with no apostrophes, which is what
 * scripts/gen-ui-strings.mjs can actually harvest (it reads quoted `tr(` arguments only, so a
 * template literal would never reach the catalogue and all eleven machine-translated languages
 * would silently fall back to English).
 *
 * ⚠️ DELIBERATELY THE SAME SENTENCE AS `resultCountLabel` IN result-line.tsx, AND NOT AN IMPORT OF
 * IT. Same words, same formatter, same binary plural — count-chip.test.tsx pins the two as equal
 * across both languages so they cannot drift apart. It is a copy rather than a call because
 * result-line.tsx is a component module that imports ui/breadcrumb and ui/badge at its top, the
 * app sets no `sideEffects: false`, and these rails sit in the explorer's eager chunk — so
 * importing one five-line helper out of it would drag a breadcrumb and a badge onto the hot path
 * for nothing. The TYPE comes from there (types are erased, so that import costs no bytes).
 */
export function countChipLabel(count: number, lang: string, tr: TrFn): string {
  const safe = clampCount(count)
  const noun = safe === 1 ? tr('listing', 'tin đăng') : tr('listings', 'tin đăng')
  return `${countDigits(safe, lang)} ${noun}`
}

/**
 * One option's count out of a dimension, or `undefined` when the dimension was not computed.
 *
 * ⚠️ THIS IS THE "INDEX INTO `values`, NEVER ITERATE IT" RULE, WRITTEN ONCE. Which chips exist is
 * a reviewed product decision that lives in src/lib/taxonomy.ts; `values` is a lookup table that
 * honestly reports a count for whatever the DATA carries, including a category row that exists
 * only in the database and legacy values a category no longer offers. Building a rail from
 * `Object.keys(values)` would grow a chip from one stray row.
 *
 * ⚠️ A MISSING KEY IN A PRESENT DIMENSION IS ZERO, NOT ABSENT. Most dimensions are pre-seeded with
 * zeros, but `brand` and `model` are explicitly not (their option lists are data-driven — see
 * FacetCounts in src/lib/facet-counts.ts), so a brand the rail renders and the filters exclude
 * simply has no key. That brand has zero matching listings and must read "0"; returning
 * `undefined` there would silently blank the number on exactly the chips a buyer most needs
 * warning about.
 */
export function optionCount(dim: DimensionCounts | undefined, key: string): number | undefined {
  if (!dim) return undefined
  // `Object.hasOwn`, not a bare index with `?? 0`: `values` comes from `Object.fromEntries`, so it
  // carries Object.prototype and an option keyed `constructor` or `toString` would index to a
  // FUNCTION, which `??` does not catch. It would clamp to 0 rather than crash, but reading a
  // lookup table through its own keys is the only version of this that is obviously right.
  return Object.hasOwn(dim.values, key) ? dim.values[key] : 0
}

/**
 * The dimension a rail should actually render, or `undefined` when the payload in hand is not an
 * answer about the options this rail is showing.
 *
 * ⚠️ THIS EXISTS BECAUSE "A MISSING KEY IS ZERO" IS ONLY TRUE OF A FRESH PAYLOAD, AND THE RAILS ARE
 * FED FROM STATE THAT NECESSARILY LAGS ONE FETCH BEHIND A FILTER CHANGE. A `facets` object carries
 * no record of which filters produced it. That lag is harmless where the keys still line up — a
 * category tile shows last second's number for a beat — and actively WRONG where they do not: tap
 * Vehicles → Electronics and the held payload's `brand` and `subcategory` buckets are still keyed
 * by vehicle slugs, every Electronics option misses, and `optionCount` reads each miss as 0. The
 * rail would then publish a wall of zeros over a full catalogue until the feed answers, which on a
 * search is up to the 2.5s `semanticRank` is allowed (src/app/api/listings/route.ts). Two of three
 * external reviewers found this independently; it is the one way this feature can lie loudly.
 *
 * The test is a KEY-SET test and nothing more: a dimension that does not carry a single one of the
 * keys being rendered is answering a different question. Nothing here needs to know which category
 * the payload came from.
 *
 * ⚠️ THE `all` TOTAL IS NOT CONSULTED, AND AN EARLIER VERSION THAT SHORT-CIRCUITED ON `all <= 0`
 * WAS WRONG IN THE HIGHEST-FREQUENCY TRANSITION THERE IS. All three external reviewers found it
 * independently: a user filters until nothing matches and then taps a different category *because*
 * it showed nothing, so the held payload is both stale AND empty — and an `all <= 0` fast path
 * returned it, after which every key missed and every chip in the new category read a confident 0.
 * Emptiness is not evidence of freshness. The key-set test alone already keeps the honest-zero
 * case, because the dimensions that CAN report an honest zero are the seeded ones: a fresh
 * `subcategory` payload with no results still carries every subcategory slug of its category with a
 * 0 (`subcategoryDimension`), so it overlaps and passes.
 *
 * ⚠️ TWO LIMITS, STATED RATHER THAN DISCOVERED LATER.
 *  · A FRESH `brand`/`model` PAYLOAD IN WHICH NO RENDERED OPTION HAS A SINGLE ROW IS SUPPRESSED.
 *    Those two are not zero-seeded (their option lists are data-driven), so "nothing matched" and
 *    "not this category" look identical, and this errs toward no numbers. ⚠️ AN EARLIER VERSION OF
 *    THIS NOTE EXCUSED IT BY CLAIMING SUCH A PAYLOAD MEANS THE FEED IS EMPTY. IT DOES NOT, and a
 *    reviewer was right to call it: the base releases brand+model but KEEPS the category, so
 *    `{ all: 40, values: {} }` is the ordinary shape whenever the forty matching listings simply
 *    carry no brand — a full grid beside a rail that shows no numbers. The trade is still the
 *    right one, but on its own terms: no numbers is this rail's honest pre-counts appearance,
 *    whereas the alternative is a wall of zeros that cannot be told apart from a stale payload.
 *  · PARTIAL OVERLAP PASSES, so this does not catch a scope change that keeps some options.
 *    Vehicles/Motorbike → Vehicles/Car refetches the car brands while the held payload is
 *    motorbike-keyed; they share Honda, so the guard passes and Toyota reads 0 until the feed
 *    answers. Tightening to "every rendered key must be present" is not available — a fresh
 *    brand payload legitimately omits any brand with no matches. THE REAL FIX IS AT THE CALLER,
 *    and it is one line: the payload does not say which filters produced it, so the owner of the
 *    filters must drop it when they change (listings-explorer already computes a `filterSig` for
 *    exactly this kind of invalidation). This function is the net for the gross case, not a
 *    substitute for that.
 */
export function railDimension(
  dim: DimensionCounts | undefined,
  optionKeys: readonly string[],
): DimensionCounts | undefined {
  if (!dim) return undefined
  // ⚠️ NO OPTIONS TO CHECK AGAINST MEANS "CANNOT JUDGE", AND CANNOT-JUDGE RESOLVES TO NO NUMBERS.
  // An earlier version returned the dimension here on the reasoning that a rail with no options
  // has no chip to get wrong. A reviewer pushed on it, and the reasoning is only true because of
  // where the rails happen to put their "All" chip today — both nest it INSIDE the `subs.length >
  // 0` / `models.length > 0` guard, so it disappears with the options (verified in both files).
  // That is a coincidence of layout, not a property of this function, and the day an "All" chip
  // moves outside the guard it would start advertising a stale total. Fail closed instead.
  if (optionKeys.length === 0) return undefined
  return optionKeys.some((k) => Object.hasOwn(dim.values, k)) ? dim : undefined
}

/**
 * The count itself. Renders NOTHING for `null`/`undefined` (see the header), so a rail degrades to
 * its countless appearance by passing the value straight through — no call site needs a guard.
 *
 * ⚠️ TWO ELEMENTS, ONE OF THEM VISUALLY HIDDEN, AND THE HIDDEN ONE IS NOT A FLEX ITEM. `sr-only`
 * is absolutely positioned, so it is out of flow and cannot participate in a parent's
 * `justify-between` / `gap-*` — which is what lets this drop into the flex chips and the
 * `display:block` chips alike without changing either layout.
 *
 * SPACING IS THE CALLER'S, via `className`: an inline chip wants `ml-1` from its label, a
 * `justify-between` overflow row wants `shrink-0` and no margin at all, and a tile wants neither
 * because the count sits on its own line. Type and colour are NOT the caller's — that is the
 * whole point of the component.
 */
export function CountChip({
  count,
  pending = false,
  className,
}: {
  count?: number | null
  /**
   * ⛔ THE NUMBER IS COMING, SO HOLD ITS PLACE — owner, 2026-08-28: "revealing category
   * subcateogory is gittery … once subcat is shown with 0 items and after fetch it jumps".
   *
   * That jump is this component being honest at the wrong moment. `count == null` renders NOTHING,
   * which is right for a dimension that was never computed (a load-more page, `?facets=0`) — but
   * it is also the state of every chip in the second between a filter tap and the feed's answer.
   * The chip renders at its bare label width, the number arrives, every chip in the row grows, and
   * the whole rail reflows under a thumb that is already reaching for one of them.
   * ⚠️ SO THIS IS A THIRD STATE, NOT A REPLACEMENT FOR `null`. `pending` means "a number is on its
   * way"; `null` still means "there is no number to say". Only the caller knows which — the rails
   * pass the feed's own fetching flag — and conflating them would put a shimmer on the load-more
   * page forever.
   */
  pending?: boolean
  className?: string
}) {
  const { lang, tr } = useLanguage()
  if (count == null) {
    if (!pending) return null
    /**
     * ⚠️ SIZED IN `ch`, WHICH IS WHY IT ACTUALLY STOPS THE REFLOW. The reserved box has to match
     * what lands in it, and what lands is `tabular-nums` digits at `text-3xs`; `2.5ch` of that font
     * is the width of a three-digit count, which is the common case on these rails. A fixed px
     * width would be right at one font size and wrong at every other, including the OS text-zoom
     * this app already supports.
     * ⚠️ `aria-hidden` and NO screen-reader text: there is nothing to announce yet, and "loading"
     * on every chip in a row would be a wall of noise for the one reader who cannot see the row.
     */
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block h-2.5 w-[2.5ch] shrink-0 rounded-full align-[-1px] shimmer', className)}
      />
    )
  }
  const srName = `, ${countChipLabel(count, lang, tr)}`
  return (
    <>
      <span
        aria-hidden="true"
        className={cn('whitespace-nowrap text-3xs font-semibold tabular-nums text-ink-4', className)}
      >
        {countDigits(count, lang)}
      </span>
      {/* ⚠️ HOISTED INTO A CONST, NOT INLINED. `react/jsx-no-literals` (a `npm run lint` error, and
          lint is its own CI step separate from tsc) rejects a template literal in JSX position —
          it cannot tell a computed accessible name from a hardcoded English string, and the rule
          exists because the second kind is how untranslated copy ships. Building the string above
          and rendering the identifier keeps the guard meaningful and the name intact. */}
      <span className="sr-only">{srName}</span>
    </>
  )
}
