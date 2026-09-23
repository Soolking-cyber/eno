import { conditionWhere } from '@/lib/listing-condition'

/**
 * THE ONE PRISMA PREDICATE AN SEO LANDING PAGE SELECTS BY.
 *
 * ⛔ IT EXISTS SO THE RAIL AND THE `robots` TAG CANNOT DISAGREE ABOUT THE PREDICATE.
 *
 * ⚠️ THAT IS A NARROWER CLAIM THAN "cannot disagree", AND THE DIFFERENCE MATTERS (opus). They are
 * two separate database round trips — `generateMetadata` and the RSC body — so on the ISR path they
 * can still straddle a write and see different COUNTS. What this removes is the far likelier
 * failure: two hand-built where clauses drifting apart. And `seoLandingRobots` deliberately
 * swallows a failed count into "indexable", so an outage yields indexable + empty rather than a
 * silently de-indexed site — the right trade, but not the same as agreement. `generateMetadata` and the
 * component render in separate passes, so "does this page have inventory" gets asked twice. Asked
 * with two hand-built where clauses, they drift — and the drift is invisible in the worst
 * direction: a page that renders eight listings while telling Google `noindex`, or an empty page
 * submitted as indexable. `/c/[category]` already learned this and answers both from one cached
 * loader (load-category.ts); this is the same fix for the landing pages.
 *
 * ⛔ IT RETURNS THE UNSCOPED PREDICATE, AND THE CALLER MUST WRAP IT IN `scopedListingWhere()`.
 * That looks like a missed opportunity to centralise one more thing; it is the opposite. edition-lint
 * verifies the licensing boundary by checking that every `db.listing` read literally names
 * `scopedListingWhere` — the guard against e-visa SKUs (ordinary Listing rows on one desk seller)
 * reaching eno.vn's feed, sitemap and product feeds. Hiding the call one hop inside this helper made
 * both call sites fail that lint, and "fixing" it with an ALLOW entry would have exempted them
 * PERMANENTLY, so a later edit dropping the scope here would never be caught. The narrowings are
 * shared; the scope stays where it can be read.
 *
 * ⚠️ AND IT IS WHY THE NARROWINGS ARE BUILT IN ONE ARRAY. Both the condition predicate and the
 * attribute filters are `AND`-shaped; spread as two `AND` keys in one object literal the later
 * silently wins. That bug shipped once in seo-landing.tsx and was caught in review — keeping the
 * construction here means it can only be got right or wrong ONCE.
 */

/** The narrowing fields of `SeoContent`, without dragging the component's React types in. */
export type SeoLandingTarget = {
  categorySlug: string
  subcategorySlug?: string
  listingType?: string
  condition?: string
  brandSlug?: string
  models?: string[]
  attributes?: Record<string, string>
}

export function seoLandingWhere(content: SeoLandingTarget) {
  const narrowings: object[] = []

  const condition = conditionWhere(content.condition)
  if (condition) narrowings.push(condition)

  if (content.attributes) {
    // One `contains` per attribute rather than one over the whole object: key order inside the
    // stored JSON is whatever the wizard happened to write, so a multi-key substring would match
    // nothing on most rows. Measured — the live visa listings carry visaEntryType/visaSpeed in
    // three different orders.
    for (const [k, v] of Object.entries(content.attributes)) {
      narrowings.push({ attributes: { contains: `"${k}":"${v}"` } })
    }
  }

  return {
    verified: true,
    status: 'active',
    category: { slug: content.categorySlug },
    ...(content.subcategorySlug ? { subcategorySlug: content.subcategorySlug } : {}),
    ...(content.listingType ? { listingType: content.listingType } : {}),
    ...(content.brandSlug ? { brandSlug: content.brandSlug } : {}),
    ...(content.models?.length ? { model: { in: content.models } } : {}),
    /**
     * ⚠️ ONE CURRENCY, AND ONLY ON A PRODUCT PAGE. A model-narrowed rail sorts by price ASC, so a
     * listing priced in USD sorts above every đồng listing — $1,200 is a smaller number than
     * 38,000,000. Scoped to `models` rather than applied everywhere because the category landing
     * pages do not sort by price and have lived happily with mixed-currency inventory.
     */
    ...(content.models?.length ? { currency: '₫' } : {}),
    ...(narrowings.length ? { AND: narrowings } : {}),
  }
}
