import { provinceWhere } from '@/lib/province-match'
import type { ListingCondition } from '@/lib/listing-condition'
import { seoLandingWhere } from './seo-landing-where'

/**
 * THE PURE HALF OF `<LiveCounts>` (live-count.tsx): which rows a live count selects, and what a page
 * may say about the answer.
 *
 * ⛔ IT EXISTS BECAUSE A COUNT TYPED INTO PROSE IS A CLAIM WITH AN EXPIRY, AND FIVE OF THEM EXPIRED.
 * "19,359 rental listings" was measured on 2026-09-23 and written into five guides; four days later
 * the live figure was 25,502 and every one of those pages was wrong, on `revalidate = 3600` pages that
 * re-render hourly and never re-read a word of their own prose. A number the page computes when it
 * renders cannot drift from the thing it counts.
 *
 * ⚠️ ITS OWN LEAF MODULE for the reason seo-landing-href.ts gives: live-count.tsx imports the Prisma
 * client, so nothing in it can be unit-tested without a database. Everything that decides WHAT to
 * count and WHAT the page may then assert lives here instead.
 */

/**
 * What to count. `categorySlug` + `condition` select exactly the rows an SEO landing rail selects
 * (seoLandingWhere — one predicate, so a guide and the landing it links to agree on a number).
 *
 * `allIn` names ONE province, by the English name `/api/listings?province=` takes ('Ho Chi Minh').
 * It asks a yes/no question — "is EVERY counted row in that province?" — which is what lets a page
 * say "all of them in Ho Chi Minh City" only while that is true, and stop saying it the hour it is
 * not, without anyone re-measuring anything.
 */
export type LiveCountTarget =
  | {
      categorySlug: string
      condition?: ListingCondition
      /** Several subcategories at once (seoLandingWhere's `subcategoryIn`) — e.g. only the kinds of
       *  rental that are a home (src/lib/rental-homes.ts), so a page's count is its rail's set. */
      subcategoryIn?: readonly string[]
      allIn?: string
    }
  /** Every public listing on the site, no category. Condition needs a category, so it is not offered. */
  | { categorySlug?: undefined; condition?: undefined; subcategoryIn?: undefined; allIn?: string }

/** A count the page may print, already formatted for the prose it sits in. */
export type LiveCountFacts = {
  /** The raw number, for a page that needs to branch on size. */
  n: number
  /** Grouped for the prose language: en "25,502", vi "25.502". */
  count: string
  /**
   * true ONLY when `allIn` was asked, both counts came back, and they are equal. Anything else —
   * not asked, the second count failed, one row elsewhere — is false, so a failure can only ever
   * REMOVE the claim, never assert it.
   */
  allInside: boolean
}

/**
 * The Prisma predicate for a target, UNSCOPED.
 *
 * ⛔ THE CALLER WRAPS IT IN `scopedListingWhere()`, same contract as seoLandingWhere and for the same
 * reason: edition-lint Rule A counts that literal at the read site, and hiding it in here would make
 * the read look unguarded — or worse, get an ALLOW entry that stays after somebody drops the scope.
 */
export function liveCountWhere(target: LiveCountTarget, province?: string) {
  const base = target.categorySlug
    ? seoLandingWhere({ categorySlug: target.categorySlug, condition: target.condition, subcategoryIn: target.subcategoryIn })
    : { verified: true, status: 'active' }
  // ⚠️ AN `AND` ARRAY, NOT A SPREAD. seoLandingWhere may already carry its own `AND` (the condition
  // narrowing); spreading the province predicate beside it would silently overwrite one of the two.
  return province ? { AND: [base, provinceWhere(province)] } : base
}

const EN = new Intl.NumberFormat('en-US')
const VI = new Intl.NumberFormat('vi-VN')

/**
 * A full, grouped count — never compacted. en "25,502", vi "25.502".
 *
 * ⚠️ NOT `formatCount` FROM src/lib/vnd.ts: that one is the COMPACT label ("25.5k") for view and save
 * counters. A guide that says "there are 25.5k rental listings" reads as a UI chip, not a sentence.
 * The separators are the same ones vnd.ts uses for money, so a Vietnamese page never mixes the two.
 */
export function formatListingCount(n: number, lang: 'en' | 'vi'): string {
  return (lang === 'vi' ? VI : EN).format(n)
}

/**
 * Turn the two raw counts into what a page may say.
 *
 * ⛔ ZERO IS `null`, THE SAME AS "COULD NOT COUNT". A page that prints "0 rental listings, all of them
 * in Ho Chi Minh City" is wrong in two ways at once, and a zero at render time is far likelier to be a
 * transient state than the truth on a category that held 25,502 rows. Both cases fall back to the
 * page's neutral wording, which is written to be true whatever the count is.
 */
export function liveCountFacts(total: number | null, inside: number | null, lang: 'en' | 'vi'): LiveCountFacts | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null
  return {
    n: total,
    count: formatListingCount(total, lang),
    allInside: inside !== null && inside === total,
  }
}
