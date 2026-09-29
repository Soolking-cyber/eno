import type { ModelPageConfig } from './model-landing'
import type { PriceRow } from './lowest-prices'

/**
 * THE ONE Product A MODEL PAGE PUBLISHES — one model, its lowest live price, and how many listings
 * stand behind that price.
 *
 * ⚠️ ITS OWN LEAF MODULE, for the reason `seo-landing-href.ts` gives at the top of itself:
 * `model-landing.tsx` renders `<SeoLanding>`, which imports the Prisma client, so a builder defined
 * there cannot be unit-tested without dragging a database in. Both imports above are type-only.
 *
 * ⛔ ONE Product PER PAGE, NOT ONE PER STORAGE TIER. This replaced an ItemList of four Products (one
 * per tier) under a page printing "12 listings", and the hub's twelve across three different models.
 * Google: "product rich results only support pages that focus on a single product (or multiple
 * variants of the same product)". Search Console also failed the hub's twelve for missing images
 * (2026-09-28). So the hub publishes no Product at all, and each model page exactly this one.
 *
 * ⚠️ AN AggregateOffer, BECAUSE THIS PAGE SELLS NOTHING. Google's merchant-listing docs: "merchant
 * listings require an Offer as the merchant has to be the seller"; product snippets accept an
 * AggregateOffer. The retailers are the sellers, each on their own listing page — so this node
 * summarises their offers rather than claiming one.
 */

/** Same origin rule as the breadcrumb beside it: absolute URLs inside JSON-LD, never relative. */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

/** A stored photo as an absolute URL, or null. Real rows are absolute already; fixtures are `/…`. */
function absoluteImage(src: string): string | null {
  if (/^https?:\/\//i.test(src)) return src
  if (src.startsWith('/') && !src.startsWith('//')) return `${ORIGIN}${src}`
  return null
}

export function modelProductLd(
  cfg: Pick<ModelPageConfig, 'model' | 'slug' | 'intro' | 'shipDate'>,
  rows: PriceRow[],
): Record<string, unknown> | null {
  /**
   * ⚠️ `priceCurrency` IS ONE CURRENCY FOR ALL ROWS, so a row in another one publishes nothing
   * rather than a wrong minimum. `lowestPrices` already selects đồng rows only; this makes the node
   * depend on that contract visibly instead of silently.
   */
  if (rows.length === 0 || rows.some((r) => r.currency !== '₫')) return null
  const floor = rows.reduce((a, b) => (b.price < a.price ? b : a))
  /**
   * ⛔ NO IMAGE, NO Product. Search Console's first complaint about these pages was a Product
   * without an image; publishing one again whenever the cheapest row happens to lack a photo would
   * re-create it. The floor row's photo comes first — the listing the headline price links to —
   * then any other row's, in table order.
   */
  const image = [floor, ...rows]
    .map((r) => (r.image ? absoluteImage(r.image) : null))
    .find((u): u is string => u !== null)
  if (!image) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: cfg.model,
    // The config's own intro — the first sentence the page prints, so the description is visible
    // text, and it carries no price that could drift from the offer below.
    description: cfg.intro,
    image,
    brand: { '@type': 'Brand', name: 'Apple' },
    url: `${ORIGIN}/${cfg.slug}`,
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: floor.price,
      priceCurrency: 'VND',
      /**
       * ⚠️ THE SAME SUM THE TABLE PRINTS AS "N listings" (`PriceTable`'s `offers`), not the number
       * of rows — a row is a storage tier, and several listings can stand behind one.
       */
      offerCount: rows.reduce((n, r) => n + r.offers, 0),
      /**
       * ⚠️ NO `highPrice`. The table shows the LOWEST price per tier, so its largest cell is not the
       * highest offer on the marketplace; publishing it would state a ceiling nobody measured.
       *
       * ⚠️ A PRE-ORDER IS NOT IN STOCK, and each page's copy says so. The flag flips by itself on the
       * ship date rather than waiting for somebody to remember.
       */
      availability: Date.now() < cfg.shipDate ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock',
    },
  }
}
