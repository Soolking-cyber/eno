import { groupVnd, moneyLocale } from '@/lib/vnd'
import type { TrFn } from './result-line'

/*
 * ⛔ ITS OWN MODULE, SO THE HEADER'S SEARCH STAYS LIGHT (speed audit, 2026-11-02). search-suggest.tsx needs only these two, it is on every page, and
 * count-chip.tsx imports SUBCATEGORIES: that one import put the whole of lib/taxonomy.ts (168 KB of source, 17.6 KB on the wire with its
 * electronics specs) on every page of the site. Nothing else on a category or listing page reaches the taxonomy.
 */

/** Clamp to a countable integer. A row count can only ever arrive negative or fractional from a
 *  caller bug, and "0" beside a chip is the least wrong thing to say when that happens. */
export function clampCount(n: number): number {
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
