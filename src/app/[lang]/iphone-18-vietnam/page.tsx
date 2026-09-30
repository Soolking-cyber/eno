import type { Metadata } from 'next'
import { pageShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { formatMoneyFull } from '@/lib/vnd'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { IPHONE_18_MODELS, IPHONE_DUO_MODEL, lowestPrices, type PriceRow } from './lowest-prices'
import { AffiliateNote, PriceTable } from './price-table'
import { DuoCard } from './duo-card'

/**
 * ⚠️ ONE HOUR, AND HERE IT IS THE PRICES RATHER THAN THE EMPTY-INVENTORY COPY. The sibling landing
 * pages dropped to 3600 because a weekly regeneration kept telling visitors a filling category was
 * empty; this page additionally PRINTS PRICES, and a stale figure on a page that ranks for "iPhone
 * 18 price" is worse than no page. The affiliate refresh cron re-reads retailer prices nightly, so
 * an hour is the shortest window that costs nothing.
 */
export const revalidate = 3600

const TITLE = `iPhone 18 Price in Vietnam — Pro, Pro Max & iPhone Duo | ${SITE_NAME}`
const DESCRIPTION =
  'What an iPhone 18 costs in Vietnam right now: live Pro and Pro Max prices by storage size from Vietnamese retailers, Apple’s official iPhone Duo prices, launch dates, and what “chính hãng VN/A” means when you buy as a foreigner.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/iphone-18-vietnam' },
  ...pageShare({
    title: 'iPhone 18 Price in Vietnam — Pro, Pro Max & iPhone Duo',
    description:
      'Live iPhone 18 Pro and Pro Max prices from Vietnamese retailers, the official iPhone Duo prices, and the launch dates.',
  }),
}

/**
 * ⚠️ `formatMoneyFull`, NEVER A LOCAL `Intl` CALL — design-lint fails the build on a hand-rolled
 * one, because Vietnamese groups thousands with a dot and every hand-roll has eventually disagreed
 * with the price component rendering the same number beside it. This prose is English (the landing
 * family is), so it takes the 'en' money locale while <Price> follows the reader's language.
 */
const money = (n: number) => formatMoneyFull(n, '₫')

/**
 * The cheapest live listing for a model — as a ROW, so the copy can name the storage tier it is
 * actually quoting.
 *
 * ⚠️ IT USED TO RETURN A BARE NUMBER AND THE FAQ CALLED IT "the 256GB model". That is true only
 * while the smallest tier is also the cheapest; the day a 512GB is discounted below it, or the 256GB
 * sells out, the page states a price for a variant nobody is selling at it (agy).
 */
const floorFor = (rows: PriceRow[], model: string) =>
  rows.filter((r) => r.model === model).sort((a, b) => a.price - b.price)[0] ?? null

/**
 * ⚠️ ABSOLUTE URLS IN JSON-LD, RELATIVE ONES IN THE MARKUP. `metadataBase` resolves the canonical
 * tag for Next, but nothing resolves a relative `item`/`url` inside a structured-data blob — Google
 * reads it as-is. The dynamic pages (`/c/[category]`) build the same prefix inline for the same
 * reason; this is that convention, not a second one.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

function content(rows: PriceRow[]): SeoContent {
  const proFloor = floorFor(rows, 'iPhone 18 Pro')
  const maxFloor = floorFor(rows, 'iPhone 18 Pro Max')
  /**
   * ⚠️ THE INTRO NAMES A PRICE ONLY WHEN ONE WAS READ. Interpolating a `null` floor as "from 0 ₫"
   * on the page that exists to answer "how much" is the failure mode worth guarding; the sentence
   * reads correctly with the clause absent, which is why the clause is what moves rather than the
   * paragraph.
   */
  // ⚠️ EITHER MODEL ON ITS OWN, not both-or-nothing — the day the Pro Max sells out the Pro's price
  // should still lead the page (agy).
  const floors = [proFloor, maxFloor].filter((f): f is PriceRow => f !== null)
  const priceClause = floors.length
    ? ` Right now ${floors.map((f) => `the cheapest ${f.model} listed here is ${money(f.price)} for the ${f.storage} model`).join(', and ')}.`
    : ''

  return {
    eyebrow: 'Apple · Vietnam',
    h1: 'iPhone 18 price in Vietnam',
    intro:
      'Apple’s iPhone 18 Pro and iPhone 18 Pro Max reach Vietnamese buyers on 18 September 2026, and the folding iPhone Duo goes on sale on 23 October.' +
      priceClause +
      /**
       * ⚠️ THE PROMISE IS CONDITIONAL ON THERE BEING A TABLE TO POINT AT. "Every price below comes
       * from a live listing … not a press release" sat above Apple's announced RRP whenever the
       * catalogue had no rows — the sentence contradicting the block beneath it (opus).
       */
      (rows.length > 0
        ? ' Every price in the table below comes from a live listing by a Vietnamese retailer, updated hourly — not a press release.'
        : ' Prices below are Apple Vietnam’s own, until retailers list theirs here.'),
    categorySlug: 'electronics',
    subcategorySlug: 'phones-tablets',
    brandSlug: 'apple',
    models: IPHONE_18_MODELS,
    browseQuery: 'iPhone 18',
    /**
     * ⛔ THE HUB'S CTAs GO TO ITS CHILDREN, NOT TO THE EXPLORER. "Browse every iPhone 18" linked
     * `/?category=electronics&…&q=iPhone+18`, which canonicalises to `/` — three followed links (the
     * hero, the price table and the rail) into a URL Google folds into the home page, while the hub
     * linked neither model page, each of which carries every storage tier and a rail of its own
     * (crawl review, 2026-09-28). Both targets are self-canonical, indexable 200s. The empty state
     * still points at the explorer: the alert its sentence promises lives only there.
     */
    browseLinks: [
      { href: '/iphone-18-pro-vietnam', label: 'iPhone 18 Pro price' },
      { href: '/iphone-18-pro-max-vietnam', label: 'iPhone 18 Pro Max price' },
    ],
    sections: [
      {
        title: 'What Apple actually released in 2026',
        body:
          'Apple split the year in two. The iPhone 18 Pro and Pro Max were announced on 9 September 2026, took pre-orders in Vietnam from 7pm on 12 September and reach buyers on 18 September. The foldable — sold as iPhone Duo, not “iPhone 18 Fold” — was announced at the same event but goes on sale a month later, on 23 October. A plain iPhone 18, an iPhone 18e and a second iPhone Air are expected in spring 2027 rather than this autumn, so for now “iPhone 18” in a Vietnamese shop means one of the two Pro models.',
      },
      {
        title: 'Storage is the only real decision',
        body:
          'Both Pro models start at 256GB and run to 2TB, and in Vietnam the jump between tiers costs more than it does in the US: the step from 256GB to 2TB roughly doubles the price. If you shoot a lot of ProRes video, buy the storage — there is no card slot. If you mostly use iCloud and stream, the 256GB model is the one that holds its resale value best on the second-hand market here.',
      },
      {
        title: 'Chính hãng VN/A, and why some prices look too good',
        body:
          'A phone sold “chính hãng VN/A” is an Apple Vietnam unit: the model number ends in VN/A, it carries the 12-month Apple Vietnam warranty, and any authorised service centre will take it. Cheaper grey-market units (LL/A from the US, ZA/A from Singapore) are imported and warranted by the shop, not by Apple Vietnam — which is fine until the screen fails. Check the model number in Settings › General › About before you pay, and check the IMEI on Apple’s coverage page.',
      },
      {
        title: 'Buying as a foreigner',
        body:
          'You can buy any of these on a passport; no residence card or Vietnamese ID is needed for an outright purchase, though 0% instalment plans generally are. All four Vietnamese networks support eSIM, so an imported eSIM-only handset works here. If you are visiting and flying out within 60 days, keep the VAT invoice: the airport refund scheme returns most of the 10% VAT on invoices over 2,000,000 ₫ from a registered shop, claimed at the departure terminal before check-in.',
      },
      {
        title: 'Where these prices come from',
        body:
          'The table above reads the marketplace’s own listings from Vietnamese retailers — CellphoneS, Thế Giới Di Động and Bạch Long among them — and shows the lowest live price per variant. Retail prices in Vietnam move: the usual pattern after an iPhone launch is a 1–3 million đồng slide over the first two months as the pre-order rush clears, so a page checked in November will not read like one checked in September.',
      },
    ],
    related: [
      { href: '/c/electronics', label: 'Phones & electronics in Vietnam', blurb: 'Every phone, laptop and camera listed on the marketplace, from retailers and private sellers.' },
      { href: '/brands', label: 'Browse by brand', blurb: 'Apple, Samsung, Xiaomi and the rest — jump straight to a brand’s live listings.' },
    ],
    faqs: [
      {
        q: 'How much is an iPhone 18 Pro in Vietnam?',
        a: proFloor
          ? `The cheapest iPhone 18 Pro listed on ${SITE_NAME} right now is ${money(proFloor.price)} for the ${proFloor.storage} model, from a Vietnamese retailer. Check the listing for whether it is a VN/A unit with the Apple Vietnam warranty — prices for the other storage tiers are in the table above.`
          : `Apple Vietnam’s recommended price for the 256GB iPhone 18 Pro is ${money(38_999_000)}. Retailers discount it: the live listings on ${SITE_NAME} are the figures to compare.`,
      },
      {
        q: 'When does the iPhone Duo go on sale in Vietnam?',
        a: `Pre-orders open at 7pm on 16 October 2026 and deliveries begin on 23 October 2026. Apple Vietnam prices run from ${money(64_999_000)} for 256GB to ${money(103_999_000)} for 2TB — the first iPhone sold officially in Vietnam above 100 million đồng.`,
      },
      {
        q: 'Is there a normal iPhone 18, without the Pro?',
        a: 'Not yet. Apple moved the non-Pro models to a spring release, so the plain iPhone 18, the cheaper 18e and a second iPhone Air are expected in the first half of 2027. Anything sold today as an “iPhone 18” in Vietnam is a Pro or a Pro Max.',
      },
      {
        q: 'What does “chính hãng VN/A” mean?',
        a: 'It is an Apple Vietnam unit with a model number ending VN/A and a 12-month Apple Vietnam warranty honoured by every authorised service centre. Imported LL/A or ZA/A handsets are usually cheaper and are warranted by the shop that sold them instead.',
      },
      {
        q: 'Can a foreigner buy an iPhone in Vietnam on a passport?',
        a: 'Yes. A passport is enough for an outright purchase at any retailer. Instalment plans usually require a Vietnamese ID or residence card, and tourists leaving within 60 days can claim most of the 10% VAT back at the airport on invoices over 2,000,000 ₫.',
      },
      {
        q: 'Is it cheaper to buy an iPhone 18 in Vietnam or abroad?',
        a: 'Vietnamese prices include 10% VAT and sit above Singapore and US retail once you convert, so the saving on an imported handset is real — but so is the warranty difference: only VN/A units are covered by Apple Vietnam. Buyers who stay a while usually take the VN/A price; visitors sometimes do not.',
      },
      {
        q: 'Do the iPhone 18 Pro models work with Vietnamese eSIM?',
        a: 'Yes. Viettel, VinaPhone, MobiFone and Vietnamobile all issue eSIM profiles, so both the dual-SIM VN/A handsets and eSIM-only imported models work on local networks.',
      },
      {
        q: 'Will the price drop?',
        a: 'Usually, yes — Vietnamese retail prices for a new iPhone typically settle 1–3 million đồng below launch within the first two months as pre-orders clear. This page re-reads live listings every hour, so it shows the fall as it happens.',
      },
    ],
    /**
     * ⛔ NO Product AND NO Offer ON THE HUB — BREADCRUMB ONLY (`SeoLanding` adds the FAQPage). This
     * page prices three different phones, and Google's product rich results "only support pages
     * that focus on a single product (or multiple variants of the same product)". The ItemList of
     * twelve Products it used to publish failed Search Console's merchant listings on every one
     * (missing image, 2026-09-28). Each model page publishes its own single Product instead — see
     * model-product-ld.ts.
     */
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Electronics', item: `${ORIGIN}/c/electronics` },
          { '@type': 'ListItem', position: 2, name: 'iPhone 18 price in Vietnam', item: `${ORIGIN}/iphone-18-vietnam` },
        ],
      },
    ],
  }
}

export default async function IPhone18VietnamPage() {
  const [phones, duo] = await Promise.all([lowestPrices(), lowestPrices([IPHONE_DUO_MODEL])])
  const rows = phones.rows
  const duoRows = duo.rows
  /**
   * ⚠️ A DATE, NOT A TIME, AND IT COMES FROM THE RENDER. An "updated 14:05" stamp on an ISR page is
   * the hydration bug this repo has already paid for once; a date is stable for the whole
   * regeneration window and is what the sentence actually needs.
   */
  const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <SeoLanding
      content={content(rows)}
      lede={
        <>
          <PriceTable rows={rows} known={phones.known} updated={updated} seeAll={false} />
          <DuoCard rows={duoRows} known={duo.known} checked={updated} />
          {rows.length + duoRows.length > 0 && <AffiliateNote />}
        </>
      }
    />
  )
}
