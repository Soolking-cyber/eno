import { SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { formatMoneyFull } from '@/lib/vnd'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { lowestPrices, type PriceRow } from './lowest-prices'
import { AffiliateNote, PriceTable, showAffiliateNote } from './price-table'
import { modelProductLd } from './model-product-ld'
import { onSaleYet } from './price-guard'
import { pageShare } from '@/lib/site-identity'

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

/**
 * `known` false = the price read failed: Apple's price only, no claim that nothing is listed (review).
 * `now` decides whether the model is on sale in Vietnam yet (price-guard.ts `onSaleYet`).
 */
export function modelContent(cfg: ModelPageConfig, rows: PriceRow[], known = true, now: Date = new Date()): SeoContent {
  const floor = floorOf(rows)
  const product = modelProductLd(cfg, rows)
  /**
   * ⚠️ THE CLAUSE MOVES, NOT THE PARAGRAPH. Interpolating a `null` floor as "from 0 ₫" on the page
   * that exists to answer "how much" is the failure worth guarding, and the intro has to read
   * correctly with the clause absent.
   */
  /**
   * ⛔ SECOND-HAND ONLY (2026-10-03): the rows are used listings (lowest-prices.ts). With none, the page
   * says so and quotes Apple's own price as Apple's — never "no retailer has listed one", which named a
   * source the page no longer reads.
   */
  const priceClause = floor
    ? ` The cheapest second-hand one from a shop here right now is ${money(floor.price)} for the ${floor.storage} model.`
    : known
      ? ` No second-hand shop lists the ${cfg.model} here yet; Apple Vietnam's own price starts at ${money(cfg.rrp)}.`
      : ` Apple Vietnam's own price starts at ${money(cfg.rrp)}.`

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
        ? ' Every price in the table below is a live listing from a second-hand phone shop on this marketplace — each one links to the listing it was read from.'
        : ''),
    categorySlug: 'electronics',
    subcategorySlug: 'phones-tablets',
    brandSlug: 'apple',
    // ⛔ USED, LIKE THE TABLE (review, 2026-10-03): with an any-condition rail a sealed unit from a person's
    // shop would sit under "No second-hand iPhone 18 Pro is listed here yet", and the CTA would browse it.
    condition: 'used',
    // ⚠️ ONE model, so the page's own rail cannot show a sibling variant the copy never mentions.
    models: [cfg.model],
    /**
     * ⛔ NO RAIL BEFORE THE MODEL IS ON SALE IN VIETNAM — THE SAME GATE AS THE TABLE AND THE Product.
     * lowest-prices.ts drops every row of a model `onSaleYet` says is not on sale, so the table is empty,
     * the JSON-LD carries no Product, and the intro says no second-hand shop lists one. The rail is a
     * second, ungated query (any used row of `cfg.model`), so before 23 October a mislabelled pre-order
     * "used iPhone Duo" would sit under "Trusted listings" directly beneath that sentence (verify,
     * 2026-10-04). ISR (`revalidate = 3600`) brings the rail back within the hour after the date.
     *
     * ⛔ AND THE CTA WITH IT. The button's browse link runs the same ungated query, so "Browse second-hand
     * iPhone Duo listings" opened a feed holding that mislabelled row (post-deploy verify, 2026-10-04).
     * Before the date the one CTA is the hub, a real indexable page that says what the model will cost.
     */
    ...(onSaleYet(cfg.model, now)
      ? { cta: cfg.cta }
      : { rail: false as const, browseLinks: [{ href: '/iphone-18-vietnam', label: 'Compare the iPhone 18 line' }] }),
    // Newest first, not cheapest first — see `order` on SeoContent.
    order: 'recent',
    browseQuery: cfg.browseQuery,
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
      /**
       * ⚠️ BUILT FROM THE SAME ROWS THE TABLE RENDERS. Markup assembled from a second query can
       * disagree with what a human sees — different sort, different moment, different answer — and
       * the disagreement is invisible until a rich result quotes a price the page does not show.
       */
      ...(product ? [product] : []),
    ],
  }
}

/** The shared title/description pair, so a route file cannot drift from the page it describes. */
// ⚠️ NO "— live prices" IN THE TITLE (2026-10-03): it promised a table that is empty until second-hand units appear.
export const modelMeta = (cfg: ModelPageConfig, description: string) => ({
  title: `${cfg.h1} | ${SITE_NAME}`,
  description,
  alternates: { canonical: `/${cfg.slug}` },
  ...pageShare({ title: cfg.h1, description }),
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
      content={modelContent(cfg, rows, known)}
      lede={
        <>
          <PriceTable rows={rows} known={known} updated={updated} id="used-prices" heading={<Tr text="Second-hand prices on this marketplace today" />} />
          {showAffiliateNote(rows) && <AffiliateNote />}
        </>
      }
    />
  )
}
