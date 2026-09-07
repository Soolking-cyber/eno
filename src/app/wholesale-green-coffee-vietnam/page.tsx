import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { storefrontUrl } from '@/lib/storefront-host'

export const revalidate = 604800 // 7d — static SEO copy; weekly regen is plenty (fewer ISR writes)

export const metadata: Metadata = {
  title: `Wholesale Green Coffee Beans Vietnam — Robusta by the Kilo | ${SITE_NAME}`,
  description:
    'Buy green Robusta coffee beans wholesale from Đắk Lắk, Vietnam — S18, S16 and S13 screens, wet-polished, clean 2%/5%/25% black & broken, honey, natural and anaerobic lots. Prices per kg in đồng, straight from the grader.',
  alternates: { canonical: '/wholesale-green-coffee-vietnam' },
  openGraph: {
    title: `Wholesale Green Coffee Beans Vietnam — Robusta by the Kilo | ${SITE_NAME}`,
    description:
      'Green Robusta from Buôn Ma Thuột by the kilogram — screen grades, defect ratios and processing method stated on every lot.',
  },
}

/**
 * WHOLESALE GREEN COFFEE — the first B2B landing page on the marketplace.
 *
 * ⚠️ IT DEPARTS FROM THE "PLAIN ENGLISH" RULE IN `seo-landing.tsx`, ON PURPOSE. The other four
 * landing pages target expats searching in English for a flat or a motorbike, and English-only is
 * right for them. This audience is not that audience: half of it is Vietnamese traders and
 * roasters, and their vocabulary is the trade's own — *cà phê nhân xanh*, *bán sỉ*, *sàng 18*,
 * *đánh bóng ướt*, *đen vỡ*. There is no `/vi` URL space (`language-context.tsx:39` files hreflang
 * under "a later phase"), so a Vietnamese query has nothing to match unless those terms appear in
 * the page itself. They are glossed inline beside the English, which is also how a buyer who knows
 * one vocabulary and not the other reads a spec sheet — this is a glossary, not keyword stuffing.
 *
 * ⚠️ `listingType: 'wholesale'` IS LOAD-BEARING, NOT DECORATION. `food-drink` carries four
 * subcategories across four intents (`taxonomy.ts:976`), so `coffee-tea` alone would rail a home
 * roaster's retail bags next to per-tonne parcels. The field was added to `SeoContent` for this
 * page; see the note there.
 *
 * ⚠️ PRICES ARE QUOTED PER KILOGRAM IN ĐỒNG AND MUST STAY THAT WAY. The supplier's own sheet
 * carries a USD-per-tonne column, and ND 340/2025 makes displaying a price in USD sanctionable for
 * a Vietnamese marketplace. The dual-currency helper shows a reader's approximate USD client-side;
 * nothing server-rendered here states one.
 */
/**
 * ⛔ DERIVED, NOT LITERAL — the first version hardcoded `https://eno.vn` in the breadcrumb and
 * "eno.vn" in the prose, and all four reviewers caught it. This page is marketplace commerce copy,
 * so it ships on BOTH editions (see the sitemap entry, deliberately ungated); on the services
 * build its relative canonical resolves to eno.forum while every hardcoded string would still have
 * said eno.vn — a page whose canonical and structured data name different sites.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

const CONTENT: SeoContent = {
  eyebrow: 'Wholesale · Green coffee · Đắk Lắk',
  h1: 'Wholesale Green Coffee Beans from Vietnam',
  intro:
    'Green (unroasted) Robusta from Đắk Lắk — the province that grows most of Vietnam’s crop — priced by the kilogram in Vietnamese đồng. Sellers here are asked to state screen size, defect ratio and processing method on each lot, so you can compare a wet-polished S18 against a 25% black-and-broken parcel without writing first — and the section below says what to ask for when one does not. Known in the trade as cà phê nhân xanh, sold bán sỉ (wholesale).',
  categorySlug: 'food-drink',
  subcategorySlug: 'coffee-tea',
  listingType: 'wholesale',
  cta: 'Browse wholesale coffee lots',
  sections: [
    {
      title: 'Screen sizes: S18, S16, S13 (sàng 18 / 16 / 13)',
      body:
        'The screen number is the sieve a bean is too big to fall through, in 1/64ths of an inch — S18 is roughly 7.1mm, S16 about 6.3mm, S13 about 5.0mm. Bigger is not automatically better, but it is more uniform, and uniform beans roast evenly, which is why S18 carries a premium over S16 on an otherwise identical lot. S13 is the workhorse screen for blends and instant. Vietnamese sheets write these as sàng 18, sàng 16, sàng 13.',
    },
    {
      title: 'Processing: wet-polished, clean, natural, honey, anaerobic',
      body:
        'Wet-polished (đánh bóng ướt) beans are washed and buffed after hulling, which strips the silverskin and leaves a cleaner, more uniform bean — the standard export presentation. Clean (bắn màu) means colour-sorted by machine to pull out blacks and defects. Natural (chế biến khô) dries the whole cherry, honey dries it with some mucilage left on, and anaerobic ferments it sealed before drying. The last three are specialty lots and priced accordingly: an anaerobic natural runs several times a commercial washed lot.',
    },
    {
      title: 'Defect grades: 2%, 5%, 25% black & broken (đen vỡ)',
      body:
        'The percentage is the share of black and broken beans allowed in the lot. 2% BB is a tight commercial grade; 5% BB is the common export spec; 25% BB is a low grade bought for blends, instant and extraction, and priced far below the clean grades. A defect lot (cà phê lỗi) is the material sorted out of the others. None of these is a lesser coffee by mistake — they are separate products for separate buyers, and the honest thing is to name the grade rather than photograph the best beans in the sack.',
    },
    {
      title: 'Moisture, foreign matter and what a spec sheet should say',
      body:
        'A green coffee spec is four numbers and a method: moisture (12.5% is the usual ceiling — wetter beans mould in transit, drier ones lose weight you paid for), black & broken %, foreign matter (0.1% or better on a clean lot), and screen. Ask for all four before you ask for a price. Any lot listed here that does not state them is one to message about, not to guess at.',
    },
    {
      title: 'Prices, minimum order and delivery',
      body:
        'Green coffee is quoted per kilogram in đồng here, and the figure moves with the market — Robusta has been volatile since 2024, so treat a listed figure as current rather than fixed. Minimum order and delivery terms are by arrangement: most lots quote EXW Đắk Lắk (collected at the warehouse) with FOB from Hồ Chí Minh City available on volume. Message the seller with your tonnage and destination for a firm quote.',
    },
    {
      title: 'Buying from a Vietnamese supplier, safely',
      body:
        `Green coffee is bought on samples and paperwork, not on photographs. Ask for a pre-shipment sample against the spec you were quoted, and agree who arbitrates if the shipment misses it. On ${SITE_NAME} every seller carries a public trust score, buyers can report a listing, and the conversation stays in-app — so there is a record of what was promised. That is not a substitute for a contract on a container-sized order; it is a way to find out who is worth writing one with.`,
    },
  ],
  related: [
    { href: '/c/food-drink', label: 'Food & drink in Vietnam', blurb: 'Everything in the category — groceries, home baking, catering and coffee.' },
    /**
     * ⚠️ THE SHOP'S CANONICAL, VIA THE SAME HELPER THE STOREFRONT USES. `/eno-trading` was the
     * first version — reviewers called it a 404, which measured false (production 307s it to
     * `eno-trading.eno.vn`, because `src/app/[handle]/page.tsx` exists), but the objection landed
     * anyway: a 307 on this page's only commercial outbound link is a wasted hop on every crawl.
     * The premise for keeping the path form — that a direct link would need an `eno.vn` literal on
     * a page that also ships on eno.forum — was simply wrong; `storefrontUrl` derives the host
     * from ORIGIN and is edition-safe.
     */
    { href: storefrontUrl('eno-trading', ORIGIN), label: 'eno Trading', blurb: 'The Đắk Lắk green-coffee storefront: every screen grade and processing method in one place.' },
  ],
  faqs: [
    {
      q: 'What is the minimum order for wholesale green coffee?',
      a: 'It varies by lot and by seller. Commercial grades are commonly quoted from one tonne, and full-container quantities (about 19.2 tonnes) get the best price per kilo; specialty lots — honey, natural, anaerobic — are often available in far smaller parcels because the harvest itself is small. Message the seller with the tonnage you need.',
    },
    {
      q: 'What is the difference between S18 and S16 Robusta?',
      a: 'Screen size. S18 beans are the ones retained on an 18/64-inch screen (about 7.1mm), S16 on a 16/64-inch one (about 6.3mm) — the number is the screen a bean will NOT fall through. The larger screen is more uniform and roasts more evenly, so it usually carries a small premium over an otherwise identical S16 lot. Neither is intrinsically better coffee — they are different sorts of the same harvest.',
    },
    {
      q: 'What does “25% black and broken” mean?',
      a: 'That up to a quarter of the lot by weight is black or broken beans. It is a genuine low grade (đen vỡ), bought deliberately for blends, instant and extraction where the defect does not survive processing, and it is priced well below a clean 2% or 5% lot. It is not a damaged shipment of a better grade.',
    },
    {
      q: 'Why are prices shown in Vietnamese đồng per kilogram?',
      a: 'Because this is Vietnamese coffee sold in Vietnam, and Vietnamese law requires domestic prices to be quoted in đồng. The site converts to your currency for reference as you browse, but the price of record is the đồng figure. Green coffee is traded internationally per tonne, so multiply by 1,000 to compare against a per-tonne quote.',
    },
    {
      q: 'Where in Vietnam does this coffee come from?',
      a: 'Đắk Lắk province in the Central Highlands, around Buôn Ma Thuột and Cư M’gar — the heart of Vietnamese Robusta growing. Vietnam is the world’s largest Robusta producer, and Đắk Lắk accounts for the largest share of it.',
    },
    {
      q: 'Can I get a sample before ordering?',
      a: 'Ask. Pre-shipment samples against a written spec are normal practice in green coffee and any serious supplier will send one. Agree the spec first — moisture, screen, black & broken, foreign matter, processing method — so there is something concrete for the sample to be measured against.',
    },
  ],
  /**
   * `BreadcrumbList` so the page reports a position in the site rather than floating. The
   * `SeoLanding` component emits `FAQPage` on its own; anything else has to come through here.
   */
  jsonLd: [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: ORIGIN },
        { '@type': 'ListItem', position: 2, name: 'Food', item: `${ORIGIN}/c/food-drink` },
        { '@type': 'ListItem', position: 3, name: 'Wholesale green coffee', item: `${ORIGIN}/wholesale-green-coffee-vietnam` },
      ],
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
