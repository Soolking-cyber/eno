import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { formatMoneyFull } from '@/lib/vnd'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

// 1h, not 7d. The copy IS static, but the page also renders a LIVE 8-listing rail and an
// "inventory is empty" branch — so at weekly regeneration a category that filled on Monday kept
// telling visitors "this part of the marketplace is just getting started" until the following
// Monday. One page per hour is a rounding error against the feed's own traffic; a week of wrong
// copy on the pages built to convert search traffic is not (astra).
export const revalidate = 3600

/**
 * ⛔ THE COPY MUST DESCRIBE THE RAIL IT SITS ON, AND UNTIL 2026-09-27 IT DESCRIBED A DIFFERENT ONE.
 * Measured that day on /api/listings (used furniture-appliances, 100-card sample of 3,201): all 100
 * came from THREE shops (Bàn Ghế Thanh Lý, Điện Máy Sài Gòn, CellphoneS), all 100 carried a partner
 * link, and each listing page reads "Buy on <shop> — eno.vn never takes payment for these items". The
 * page promised the opposite at every turn: "message the seller in-app to arrange a viewing", "many
 * will bundle several items", "the items and prices are real", "priced well below retail" — the first
 * two are false of a shop listing (its button opens the shop's website; there is no in-app chat), the
 * third is a guarantee nobody here gives, and the fourth is a saving we never measured (we hold no
 * new-price data at all). It also sold the stock as moving sales, which the house rule forbids: the
 * used goods are DEALER-SUPPLIED (secondhand-furniture-ho-chi-minh-city/page.tsx says the same).
 *
 * ⚠️ WHAT STAYED, AND WHY. The title, H1 and slug keep "Moving Sales" — they are the ranking asset
 * (456 impressions at avg position 15.5 on moving-sale and where-to-sell-furniture queries; renaming
 * would forfeit that and need a redirect). The body now answers that query honestly — "mostly not,
 * here is what IS listed, and here is how to sell up yourself" — which serves both intents a searcher
 * arrives with. The trust strip is off for the jobs-landing reason: its "every seller has a public
 * trust score … fakes get caught fast" is not a claim about a partner shop's website.
 */
export const metadata: Metadata = {
  title: `Moving Sales & Secondhand Furniture in Vietnam | ${SITE_NAME}`,
  description:
    'Used sofas, wardrobes, air conditioners and washing machines in Ho Chi Minh City, mostly from secondhand shops — measured asking prices, what to check before you pay, and how to sell up when you move out.',
  alternates: { canonical: '/moving-sales-vietnam' },
  openGraph: {
    title: `Moving Sales & Secondhand Furniture in Vietnam | ${SITE_NAME}`,
    description: 'Used furniture and appliances in Ho Chi Minh City, mostly from secondhand shops, with measured asking prices.',
  },
}

/**
 * ⚠️ MEASURED, DATED AND SAMPLED — the same 2026-09-23 sample the secondhand-furniture guide quotes
 * (n=300 used furniture-appliance listings), so the site states one fact one way. Asking prices, not
 * sold prices, and the sentence says so. Formatted through src/lib/vnd.ts in the guides' money
 * convention — đồng with DOT grouping (2.480.000 đ), exactly as rental-deposit-vietnam and the
 * secondhand-furniture guide print the same three figures; an 'en' format here printed 2,480,000 đ,
 * one fact two ways (opus review, 2026-09-27).
 */
const MEDIAN = formatMoneyFull(2_480_000, '₫', 'vi')
const P25 = formatMoneyFull(1_050_000, '₫', 'vi')
const P75 = formatMoneyFull(4_100_000, '₫', 'vi')

/** From the registry — see the same note on /housing-vietnam-expats. English guides only. */
const RELATED_GUIDES = ['/selling-up-before-you-leave-vietnam', '/secondhand-furniture-ho-chi-minh-city', '/furnishing-a-home-in-vietnam']

const CONTENT: SeoContent = {
  eyebrow: 'Secondhand · Ho Chi Minh City',
  h1: 'Moving Sales & Secondhand Furniture in Vietnam',
  intro: `Furnish your place secondhand. Used furniture, appliances and home goods in Ho Chi Minh City — sofas, wardrobes, dining sets, air conditioners, washing machines, air purifiers and robot vacuums. Most of this stock is listed by secondhand shops rather than by people moving out, and a shop’s listing links to the item on the shop’s own website, where you check stock, delivery and payment.`,
  /**
   * ⛔ `furniture-appliances` NARROWED TO USED, NOT `moving-sale`. This page pointed at the
   * `moving-sale` category, which has **zero** live listings, while 3,201 used furniture and
   * appliance rows sat one category away. Measured in Search Console: 456 impressions and 15
   * clicks over 93 days — the SECOND most-seen page on the site — every one of them funnelled
   * into an empty rail and the component's own "inventory is empty" branch.
   *
   * ⚠️ THE CONDITION NARROWING IS NOT OPTIONAL HERE. `furniture-appliances` is 6,308 listings of
   * which only 3,201 are used; without it a page titled "Secondhand" would rail brand-new goods.
   */
  categorySlug: 'furniture-appliances',
  condition: 'used',
  /**
   * ⚠️ THE COPY ASSERTS HO CHI MINH CITY AND THE RAIL HAS NO DISTRICT NARROWING — that pairing is
   * only safe because it was MEASURED, not assumed. 2026-09-23, /api/listings sampled 100 used
   * furniture-appliance rows: 100 of 100 are Hồ Chí Minh. Re-measured 2026-09-27: the province facet
   * puts all 3,201 used rows in Hồ Chí Minh. SeoContent has no district field, so there is nothing
   * enforcing it.
   *
   * ⛔ SO THIS IS A CLAIM WITH AN EXPIRY. The first Hanoi or Da Nang sofa posted to this category
   * rails under an FAQ literally titled "What secondhand furniture can I buy in Ho Chi Minh City?"
   * (opus). Re-measure when non-HCMC supply appears; the fix is then either a district narrowing
   * on the rail or hedging this copy back to "mostly".
   */
  railTitle: 'Used furniture and appliances',
  trustStrip: false,
  cta: 'Browse secondhand furniture',
  sections: [
    {
      title: 'What you will find',
      body: `Sofas, dining sets, wardrobes, shoe cabinets and office desks; air conditioners, washing machines, air purifiers, robot vacuums and small kitchen appliances. In a 300-listing sample taken on 23 September 2026 the median asking price was ${MEDIAN}, and the middle half sat between ${P25} and ${P75} — asking prices, not what things sold for. The secondhand furniture guide breaks that down item by item.`,
    },
    {
      title: 'Mostly shops, not moving sales',
      body: `In a 100-listing sample taken on 27 September 2026, all 100 used furniture and appliance listings came from three shops in Ho Chi Minh City, not from households clearing a flat. A shop’s listing links to the same item on the shop’s own website: you check stock, delivery and payment there, and ${SITE_NAME} takes no payment for it. A shop has no moving-out deadline, so the room to bargain is usually in buying several items together and in the delivery fee.`,
    },
    {
      title: 'Moving out yourself?',
      body: `If you are the one clearing a flat, posting on ${SITE_NAME} is free, and a listing you post yourself can be messaged in-app, so buyers can ask for measurements and agree a pickup date in the chat. Price against what is already listed, start early, and plan the handover so it does not cost you your deposit — the selling-up guide below walks through it.`,
    },
    {
      title: 'Before you pay',
      body: 'See it running where it stands, measure the doorway, the stairs and the lift before you commit, and agree delivery and installation up front. For an air conditioner, removal at the old address, installation at yours and any new pipe are usually billed separately from the unit.',
    },
  ],
  related: RELATED_GUIDES.flatMap((href) => marketplaceGuidesExcept().filter((g) => g.href === href)),
  faqs: [
    {
      q: 'What secondhand furniture can I buy in Ho Chi Minh City?',
      a: 'Sofas, beds, wardrobes, dining and office tables, shelving and shoe cabinets, plus used appliances — air conditioners, washing machines, air purifiers and robot vacuums. Each listing shows the condition the seller set. Most are listed by secondhand shops, and a shop’s listing links to the item on the shop’s own website.',
    },
    {
      q: 'Are these moving sales from expats leaving Vietnam?',
      a: 'Mostly not. In a 100-listing sample taken on 27 September 2026, all 100 used furniture and appliance listings came from three shops, not from people moving out. If you are moving out yourself, you can post your own items for free.',
    },
    {
      q: 'Can I arrange delivery or pickup?',
      a: `For a shop’s listing, arrange it with the shop on its website; delivery is usually quoted separately from the item. For a listing someone posted directly on ${SITE_NAME}, message the seller in-app to agree a price and a pickup date. Either way, agree who carries it up and what that costs before you agree the price.`,
    },
    {
      q: `Does ${SITE_NAME} check these listings?`,
      a: `A shop’s listing is the shop’s own offer, and its button opens the item on the shop’s website; ${SITE_NAME} takes no payment for it and cannot refund or return an item. Anyone can report a listing that looks wrong, and a seller who posts directly here carries a public trust score (an official partner shows its partner badge instead). See the item running before you pay.`,
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
