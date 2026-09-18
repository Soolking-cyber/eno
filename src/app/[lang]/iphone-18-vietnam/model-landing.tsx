import { SITE_NAME } from '@/lib/edition'
import { formatMoneyFull } from '@/lib/vnd'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { lowestPrices, type PriceRow } from './lowest-prices'
import { AffiliateNote, PriceTable } from './price-table'

/**
 * ONE MODEL, ONE PAGE — the machinery the per-variant landing pages share.
 *
 * ⛔ IT EXISTS SO THE INVARIANTS ARE NOT TRIPLICATED. `/iphone-18-vietnam` is the family hub and
 * keeps its own bespoke copy; the three variant pages beside it (`/iphone-18-pro-vietnam`,
 * `/iphone-18-pro-max-vietnam`, `/iphone-duo-vietnam`) differ only in WORDS. Everything that has
 * already been got wrong once on the hub page — a pre-order published as InStock, an accessory
 * priced as a phone, a relative URL inside JSON-LD, a floor price quoted without naming its storage
 * tier, `Intl` instead of `formatMoneyFull` — is fixed HERE, once, where a fix reaches all three.
 *
 * ⚠️ WHAT IS DELIBERATELY *NOT* SHARED IS THE PROSE. Three pages built from one paragraph template
 * with the model name swapped are near-duplicates, which is the thing Google's own guidance names
 * and exactly the aggregator shape this domain is already paying for elsewhere. Every config below
 * brings its own intro, its own sections and its own FAQs, answering questions that are true of
 * THAT variant — the Pro Max's battery and the Duo's crease are not the same page with a different
 * noun. If a new variant cannot be given its own honest answers, it does not get its own page.
 */
export type ModelPageConfig = {
  /** Exact `Listing.model` value — free text, so this is a literal, never a prefix. See lowest-prices.ts. */
  model: string
  /** Route segment, without the leading slash. ⚠️ Must ALSO be added to RESERVED in handle-format.ts and to sitemap.xml. */
  slug: string
  eyebrow: string
  h1: string
  /** Appended after the live-price clause, which this module writes. */
  intro: string
  /** Apple Vietnam's own RRP for the entry tier — printed only when no live listing was read. */
  rrp: number
  /** When the model actually reaches buyers. Before it, every offer is a PRE-ORDER. */
  shipDate: number
  cta: string
  browseQuery: string
  sections: { title: string; body: string }[]
  faqs: { q: string; a: string }[]
  /** The sibling variants, for the internal links that make a cluster a cluster. */
  related: { href: string; label: string; blurb: string }[]
}

/**
 * ⚠️ `formatMoneyFull`, NEVER A LOCAL `Intl` CALL — design-lint fails the build on a hand-rolled
 * one, because Vietnamese groups thousands with a dot and every hand-roll has eventually disagreed
 * with the `<Price>` component rendering the same number beside it.
 */
const money = (n: number) => formatMoneyFull(n, '₫')

/**
 * ⚠️ ABSOLUTE URLS IN JSON-LD, RELATIVE ONES IN THE MARKUP. `metadataBase` resolves the canonical
 * tag for Next, but nothing resolves a relative `item`/`url` inside a structured-data blob.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

/**
 * The cheapest live row — as a ROW, so the copy can name the tier it is actually quoting.
 *
 * ⚠️ NOT A BARE NUMBER. "the 256GB model" is true only while the smallest tier is also the
 * cheapest; the day a 512GB is discounted below it, the page states a price for a variant nobody
 * is selling at it.
 */
const floorOf = (rows: PriceRow[]) => [...rows].sort((a, b) => a.price - b.price)[0] ?? null

export function modelContent(cfg: ModelPageConfig, rows: PriceRow[]): SeoContent {
  const floor = floorOf(rows)
  /**
   * ⚠️ THE CLAUSE MOVES, NOT THE PARAGRAPH. Interpolating a `null` floor as "from 0 ₫" on the page
   * that exists to answer "how much" is the failure worth guarding, and the intro has to read
   * correctly with the clause absent.
   */
  const priceClause = floor
    ? ` The cheapest one listed here right now is ${money(floor.price)} for the ${floor.storage} model.`
    : ` No Vietnamese retailer has listed one here yet; Apple Vietnam's own price starts at ${money(cfg.rrp)}.`

  return {
    eyebrow: cfg.eyebrow,
    h1: cfg.h1,
    intro: cfg.intro + priceClause +
      /**
       * ⚠️ NO FREQUENCY CLAIM IN THE COPY. An earlier draft said prices were "re-read hourly", and
       * all three review seats called it: `revalidate = 3600` is how often this PAGE may regenerate,
       * not how often a retailer's price is re-read — that is the nightly affiliate/partner cron —
       * and an ISR page only regenerates when someone asks for it, so a quiet variant page can be
       * older than any interval it advertises. The table prints the date it was actually checked,
       * which is the honest version of the same reassurance.
       */
      (rows.length > 0
        ? ' Every price in the table below comes from a live listing by a Vietnamese retailer, not a press release — each one links to the listing it was read from.'
        : ''),
    categorySlug: 'electronics',
    subcategorySlug: 'phones-tablets',
    brandSlug: 'apple',
    // ⚠️ ONE model, so the page's own rail cannot show a sibling variant the copy never mentions.
    models: [cfg.model],
    browseQuery: cfg.browseQuery,
    cta: cfg.cta,
    sections: cfg.sections,
    related: cfg.related,
    faqs: cfg.faqs,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Electronics', item: `${ORIGIN}/c/electronics` },
          { '@type': 'ListItem', position: 2, name: 'iPhone 18 price in Vietnam', item: `${ORIGIN}/iphone-18-vietnam` },
          { '@type': 'ListItem', position: 3, name: cfg.h1, item: `${ORIGIN}/${cfg.slug}` },
        ],
      },
      ...(rows.length > 0 ? [itemList(cfg, rows)] : []),
    ],
  }
}

/**
 * ⚠️ BUILT FROM THE SAME ROWS THE TABLE RENDERS. An ItemList assembled from a second query can
 * disagree with what a human sees — different sort, different moment, different answer — and the
 * disagreement is invisible until a rich result quotes a price the page does not show.
 */
function itemList(cfg: ModelPageConfig, rows: PriceRow[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${cfg.model} prices in Vietnam`,
    numberOfItems: rows.length,
    itemListElement: rows.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: `${r.model} ${r.storage}`,
        brand: { '@type': 'Brand', name: 'Apple' },
        offers: {
          '@type': 'Offer',
          price: r.price,
          priceCurrency: 'VND',
          /**
           * ⚠️ A PRE-ORDER IS NOT IN STOCK, and each page's own copy says so. Google treats an
           * InStock offer for something that cannot ship as a mismatch and can drop the item. The
           * flag flips by itself on the ship date rather than waiting for somebody to remember.
           */
          availability: Date.now() < cfg.shipDate
            ? 'https://schema.org/PreOrder'
            : 'https://schema.org/InStock',
          url: `${ORIGIN}/listings/${r.listingId}`,
          seller: { '@type': 'Organization', name: r.seller },
        },
      },
    })),
  }
}

/** The shared title/description pair, so a route file cannot drift from the page it describes. */
export const modelMeta = (cfg: ModelPageConfig, description: string) => ({
  title: `${cfg.h1} — live prices | ${SITE_NAME}`,
  description,
  alternates: { canonical: `/${cfg.slug}` },
  openGraph: { title: cfg.h1, description },
})

export async function ModelLanding({ cfg }: { cfg: ModelPageConfig }) {
  const { rows, known } = await lowestPrices([cfg.model])
  /**
   * ⚠️ A DATE, NOT A TIME, AND IT COMES FROM THE RENDER. An "updated 14:05" stamp on an ISR page is
   * the hydration bug this repo has already paid for once; a date is stable for the whole
   * regeneration window and is what the sentence actually needs.
   */
  const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <SeoLanding
      content={modelContent(cfg, rows)}
      lede={
        <>
          <PriceTable rows={rows} known={known} updated={updated} />
          {rows.length > 0 && <AffiliateNote />}
        </>
      }
    />
  )
}
