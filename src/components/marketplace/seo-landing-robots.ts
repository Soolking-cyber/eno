import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { seoLandingWhere, type SeoLandingTarget } from './seo-landing-where'

/**
 * `noindex, follow` FOR A LANDING PAGE WITH NOTHING TO SHOW — COMPUTED, NEVER HARD-CODED.
 *
 * ⛔ THE PROBLEM THIS SOLVES IS MEASURED, NOT THEORETICAL. `/motorbikes-for-sale-vietnam` points at
 * `vehicles`, which holds 100 listings and not one motorbike; `/jobs-vietnam-expats` points at
 * `jobs`, which holds zero. Both were indexable. A visitor who searched for a motorbike landed on a
 * page whose first row was a car-seat organiser — and Search Console shows both pages earning
 * exactly ZERO impressions over 93 days, so suppressing them costs nothing and the bounce they
 * would produce is the only thing at stake.
 *
 * ⛔ `follow`, NOT `noindex, nofollow`. The page still carries real internal links to sibling
 * categories and guides, and we want those crawled. Same choice `/c/[category]` makes.
 *
 * ⚠️ COMPUTED IS THE WHOLE POINT: it lifts ITSELF the moment somebody lists a motorbike, with no
 * list to maintain. A hard-coded `robots: { index: false }` goes stale silently and keeps
 * suppressing a page that has filled up — which is exactly how `/c/[category]` justifies doing the
 * same thing, in its own words.
 *
 * ⚠️ AND A DATABASE OUTAGE MUST NOT DE-INDEX THE SITE. `count()` throwing at build time is not
 * evidence of an empty shelf, so the catch returns `{}` — the page stays indexable, which is the
 * behaviour it had before this helper existed. Treating "couldn't look" as "nothing there" would
 * quietly noindex every landing page on one bad build.
 */
export async function seoLandingRobots(content: SeoLandingTarget): Promise<Pick<Metadata, 'robots'>> {
  try {
    const live = await db.listing.count({ where: await scopedListingWhere(seoLandingWhere(content)) })
    return live === 0 ? { robots: { index: false, follow: true } } : {}
  } catch {
    return {}
  }
}
