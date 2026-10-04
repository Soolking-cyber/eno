import type { Metadata } from 'next'
import { LocalizedLink } from '@/components/marketplace/localized-link'
import { Tr } from '@/context/language-context'
import { pageShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { formatMoneyFull } from '@/lib/vnd'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { IPHONE_17_MODELS, IPHONE_18_MODELS, IPHONE_DUO_MODEL, lowestPrices, type PriceRow } from './lowest-prices'
import { AffiliateNote, PriceTable, showAffiliateNote } from './price-table'
import { DuoCard } from './duo-card'
import { APPLE_VN_FROM_PRICE } from './price-guard'

/**
 * ⚠️ ONE HOUR, AND HERE IT IS THE PRICES RATHER THAN THE EMPTY-INVENTORY COPY. The sibling landing
 * pages dropped to 3600 because a weekly regeneration kept telling visitors a filling category was
 * empty; this page additionally PRINTS PRICES, and a stale figure on a page that ranks for "iPhone
 * 18 price" is worse than no page. Second-hand listings come and go daily, so an hour is the shortest
 * window that costs nothing.
 *
 * ⛔ SECOND-HAND FOCUS (owner, 2026-10-03): the tables read USED listings only (lowest-prices.ts) — the new
 * retail stock they used to quote (CellphoneS, Thế Giới Di Động, Bạch Long) was taken off the site. Apple
 * Vietnam's prices are quoted as Apple's. The iPhone 17 table is the second-hand market that exists today.
 */
export const revalidate = 3600

const TITLE = `iPhone 18 Price in Vietnam — Pro, Pro Max & iPhone Duo | ${SITE_NAME}`
const DESCRIPTION =
  'What an iPhone 18 costs in Vietnam: Apple Vietnam’s official Pro, Pro Max and Duo prices, what second-hand iPhone 18 and iPhone 17 units are listed for here, launch dates, and what “chính hãng VN/A” means when you buy as a foreigner.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/iphone-18-vietnam' },
  ...pageShare({
    title: 'iPhone 18 Price in Vietnam — Pro, Pro Max & iPhone Duo',
    description:
      'Apple Vietnam’s iPhone 18 and iPhone Duo prices, what second-hand iPhone 18 and iPhone 17 units are listed for here, and the launch dates.',
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

/**
 * A second-hand iPhone 17 FAQ — only when there are rows to quote, so the answer (and the FAQPage markup
 * built from it) never states a price nobody is asking.
 */
function secondHand17Faq(rows17: PriceRow[]): { q: string; a: string }[] {
  const floors = IPHONE_17_MODELS.map((m) => floorFor(rows17, m)).filter((f): f is PriceRow => f !== null)
  if (!floors.length) return []
  return [{
    q: 'How much is a second-hand iPhone 17 in Vietnam?',
    a: `The cheapest second-hand shop listings on ${SITE_NAME} right now: ${floors.map((f) => `${f.model} ${money(f.price)} (${f.storage})`).join(', ')}. Check the model number ends in VN/A for the Apple Vietnam warranty, and look at the battery health before you pay.`,
  }]
}

/** Apple Vietnam's price for the 256GB iPhone 18 Pro — read from the one table the price pages share. */
const PRO_FROM = APPLE_VN_FROM_PRICE['iPhone 18 Pro']

/**
 * `known` is false when a price read failed (a build with the database unreachable): then nothing here says
 * "no second-hand one is listed" — that would be a claim about stock the page never looked at (review).
 */
function content(rows: PriceRow[], rows17: PriceRow[], known: boolean): SeoContent {
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
    ? ` Right now ${floors.map((f) => `the cheapest second-hand ${f.model} from a shop here is ${money(f.price)} for the ${f.storage} model`).join(', and ')}.`
    : ''

  return {
    eyebrow: 'Apple · Vietnam',
    h1: 'iPhone 18 price in Vietnam',
    intro:
      'Apple’s iPhone 18 Pro and iPhone 18 Pro Max reached Vietnamese buyers on 18 September 2026, and the folding iPhone Duo goes on sale on 23 October. ' +
      `Apple Vietnam’s own price for the 256GB iPhone 18 Pro is ${money(PRO_FROM)}.` +
      priceClause +
      /**
       * ⚠️ THE PROMISE IS CONDITIONAL ON THERE BEING A TABLE TO POINT AT (opus) — and since 2026-10-03 on
       * what the tables are: live SECOND-HAND listings, never a retailer's shelf price.
       */
      (rows.length + rows17.length > 0
        ? ' The tables below read the second-hand phone shops’ live listings on this marketplace — the iPhone 18 as units resell, and the iPhone 17 line, where the second-hand market is today.'
        : known ? ' Second-hand units usually appear a few weeks after launch.' : ''),
    categorySlug: 'electronics',
    subcategorySlug: 'phones-tablets',
    brandSlug: 'apple',
    /**
     * ⛔ THE RAIL SHOWS WHAT THE TABLES QUOTE: used iPhone 18 AND 17 (review, 2026-10-03). Narrowed to the
     * iPhone 18 alone it found nothing, so the page printed "just getting started … not much to browse"
     * directly above a table of used iPhone 17s — and that empty-state branch also drops `browseLinks`, the
     * hub's only CTA links to its model pages (they are in `related` too now, for every state).
     */
    condition: 'used',
    models: [...IPHONE_18_MODELS, ...IPHONE_17_MODELS],
    browseQuery: 'iPhone',
    railTitle: 'Second-hand iPhones listed now',
    order: 'recent',
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
          'The tables read live second-hand listings from the used-phone shops on this marketplace, and show the lowest price per storage tier; a price far out of line with the other listings of the same model, or with Apple’s own price, is left out as a likely typo. Apple Vietnam’s own prices are quoted as Apple’s, never as a listing. Second-hand prices follow new ones down: the usual pattern after an iPhone launch is a 1–3 million đồng slide over the first two months as the pre-order rush clears, and a used unit lists below that.',
      },
    ],
    related: [
      // ⚠️ The model pages, here AS WELL AS in browseLinks: the empty-inventory branch of SeoLanding drops
      // browseLinks, and a hub must reach its children in every state (review, 2026-10-03).
      { href: '/iphone-18-pro-vietnam', label: 'iPhone 18 Pro price', blurb: 'The 6.3-inch model — Apple Vietnam’s price per storage tier, and any second-hand unit listed here.' },
      { href: '/iphone-18-pro-max-vietnam', label: 'iPhone 18 Pro Max price', blurb: 'The 6.9-inch model — Apple Vietnam’s price per storage tier, and any second-hand unit listed here.' },
      { href: '/iphone-duo-vietnam', label: 'iPhone Duo price', blurb: 'Apple’s first foldable, on sale in Vietnam from 23 October 2026.' },
      { href: '/buying-a-used-iphone-vietnam', label: 'Buying a used iPhone in Vietnam', blurb: 'What to check before you pay for a second-hand iPhone here — the model number, the IMEI, the battery and the parts history.' },
      { href: '/c/electronics', label: 'Phones & electronics in Vietnam', blurb: 'Second-hand phones, laptops and cameras from used-goods shops and private sellers.' },
      { href: '/brands', label: 'Browse by brand', blurb: 'Apple, Samsung, Xiaomi and the rest — jump straight to a brand’s live listings.' },
    ],
    faqs: [
      {
        q: 'How much is an iPhone 18 Pro in Vietnam?',
        a: proFloor
          ? `Apple Vietnam’s recommended price for the 256GB iPhone 18 Pro is ${money(PRO_FROM)}. The cheapest second-hand one a shop lists on ${SITE_NAME} right now is ${money(proFloor.price)} for the ${proFloor.storage} model — check the listing for a VN/A model number and the battery health; the other storage tiers are in the table above.`
          : known
            ? `Apple Vietnam’s recommended price for the 256GB iPhone 18 Pro is ${money(PRO_FROM)}. No second-hand shop lists one on ${SITE_NAME} yet; used units usually appear a few weeks after launch.`
            : `Apple Vietnam’s recommended price for the 256GB iPhone 18 Pro is ${money(PRO_FROM)}.`,
      },
      ...secondHand17Faq(rows17),
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
        a: 'Yes. A passport is enough for an outright purchase at any shop. Instalment plans usually require a Vietnamese ID or residence card, and tourists leaving within 60 days can claim most of the 10% VAT back at the airport on invoices over 2,000,000 ₫ from a registered shop.',
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
        a: 'Usually, yes — new-iPhone prices in Vietnam typically settle 1–3 million đồng below launch within the first two months as pre-orders clear, and second-hand prices follow them down. The tables above show what second-hand units were listed for when the page was last checked, not a forecast.',
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
  const [phones, phones17, duo] = await Promise.all([lowestPrices(), lowestPrices(IPHONE_17_MODELS), lowestPrices([IPHONE_DUO_MODEL])])
  const rows = phones.rows
  const rows17 = phones17.rows
  const duoRows = duo.rows
  /**
   * ⚠️ A DATE, NOT A TIME, AND IT COMES FROM THE RENDER. An "updated 14:05" stamp on an ISR page is
   * the hydration bug this repo has already paid for once; a date is stable for the whole
   * regeneration window and is what the sentence actually needs.
   */
  const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <SeoLanding
      content={content(rows, rows17, phones.known && phones17.known)}
      lede={
        <>
          {/* ⛔ NO EMPTY TABLE AND NO SILENCE EITHER: with no second-hand iPhone 18 yet, one line says so —
              and only when the catalogue was actually read (PriceTable owns the could-not-read state). */}
          {phones.known && rows.length === 0 ? (
            <p className="mt-8 max-w-prose text-sm leading-relaxed text-body">
              <Tr text="No second-hand shop lists an iPhone 18 here yet — used units usually appear a few weeks after launch." />{' '}
              <LocalizedLink href="/?category=electronics&subcategory=phones-tablets&brand=apple&condition=used" rel="nofollow" prefetch={false} className="font-semibold text-accent-foreground hover:underline">
                <Tr text="Browse second-hand iPhones" />
              </LocalizedLink>
            </p>
          ) : (
            <PriceTable rows={rows} known={phones.known} updated={updated} seeAll={false} id="used-iphone-18-prices" heading={<Tr text="Second-hand iPhone 18 prices today" />} />
          )}
          <PriceTable rows={rows17} known={phones17.known} updated={updated} seeAll={false} id="used-iphone-17-prices" heading={<Tr text="Second-hand iPhone 17 prices today" />} />
          <DuoCard rows={duoRows} known={duo.known} checked={updated} />
          {showAffiliateNote(rows, rows17, duoRows) && <AffiliateNote />}
        </>
      }
    />
  )
}
