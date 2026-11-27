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
 * AggregateOffer. The sellers are the shops behind each listing — so this node summarises
 * their offers rather than claiming one.
 *
 * ⛔ ONE CONDITION, SINCE 2026-11-26. From 2026-10-03 the node said `UsedCondition` and published nothing for a row that was
 * not used. A model page now quotes TWO tables — new units from three shops above, second-hand ones below (lowest-prices.ts
 * `lowestNewPrices` / `lowestPrices`) — and the page publishes ONE Product: the new rows' when there are any, else the used
 * rows', each with its own itemCondition (see modelProductLd). Two Products on a page about one model is the shape Google's
 * guidance rules out (above).
 */

/** Same origin rule as the breadcrumb beside it: absolute URLs inside JSON-LD, never relative. */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

/** A stored photo as an absolute URL, or null. Real rows are absolute already; fixtures are `/…`. */
function absoluteImage(src: string): string | null {
  if (/^https?:\/\//i.test(src)) return src
  if (src.startsWith('/') && !src.startsWith('//')) return `${ORIGIN}${src}`
  return null
}

/**
 * `rows` = BOTH tables' rows, as the page renders them (new first, then used). Every one is a live, verified, in-stock listing
 * of `cfg.model` that passed the price guard.
 * ⛔ ONE CONDITION PER NODE (commit gate round 6, opus): a mixed AggregateOffer with no condition let a used unit's price be the
 * snippet's "from" on a page about a new model. So the node describes the NEW rows when the page has any (NewCondition), and
 * otherwise the second-hand ones (UsedCondition, as before 2026-11-26) — never both, and always says which.
 */
const CONDITION_URL = { new: 'https://schema.org/NewCondition', used: 'https://schema.org/UsedCondition' } as const

export function modelProductLd(
  cfg: Pick<ModelPageConfig, 'model' | 'slug' | 'intro'>,
  allRows: PriceRow[],
): Record<string, unknown> | null {
  const condition = allRows.some((r) => r.condition === 'new') ? 'new' : 'used'
  const rows = allRows.filter((r) => r.condition === condition)
  /**
   * ⚠️ `priceCurrency` IS ONE CURRENCY FOR ALL ROWS, so a row in another one publishes nothing
   * rather than a wrong minimum. `lowestPrices` already selects đồng rows only; this makes the node
   * depend on that contract visibly instead of silently.
   */
  if (rows.length === 0 || rows.some((r) => r.currency !== '₫')) return null
  // The floor of the node's own rows, the first such row on a tie (the table's order).
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
    itemCondition: CONDITION_URL[condition],
    url: `${ORIGIN}/${cfg.slug}`,
    offers: {
      '@type': 'AggregateOffer',
      itemCondition: CONDITION_URL[condition],
      lowPrice: floor.price,
      /**
       * ⚠️ THE TOP OF THE SAME LISTINGS `offerCount` COUNTS — each row's `ceiling` (the dearest of its tier's guarded listings),
       * not the largest cell the table prints. Before 2026-11-26 this node carried no `highPrice` at all, because a table of
       * tier FLOORS has no ceiling in it; the rows now carry one, so low, high and count describe one set of offers.
       */
      highPrice: Math.max(...rows.map((r) => r.ceiling)),
      priceCurrency: 'VND',
      /**
       * ⚠️ THE SAME SUM THE TABLE PRINTS AS "N listings" (`PriceTable`'s `offers`), not the number
       * of rows — a row is a storage tier, and several listings can stand behind one.
       */
      offerCount: rows.reduce((n, r) => n + r.offers, 0),
      /**
       * ⚠️ IN STOCK, ALWAYS. Both tables read live, verified, active listings only: a second-hand unit exists only once someone
       * owns one, and a new row is the shop's own active listing of a unit it sells (src/lib/new-apple.ts).
       */
      availability: 'https://schema.org/InStock',
    },
  }
}
