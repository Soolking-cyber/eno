import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

// 1h, not 7d. The copy IS static, but the page also renders a LIVE 8-listing rail and an
// "inventory is empty" branch — so at weekly regeneration a category that filled on Monday kept
// telling visitors "this part of the marketplace is just getting started" until the following
// Monday. One page per hour is a rounding error against the feed's own traffic; a week of wrong
// copy on the pages built to convert search traffic is not (astra).
export const revalidate = 3600

export const metadata: Metadata = {
  title: `Moving Sales & Secondhand Furniture in Vietnam | ${SITE_NAME}`,
  description:
    'Buy secondhand furniture and appliances in Ho Chi Minh City — sofas, wardrobes, air conditioners, washing machines and more, used and priced below retail. Every eno.vn seller has a public trust score.',
  alternates: { canonical: '/moving-sales-vietnam' },
  openGraph: {
    title: `Moving Sales & Secondhand Furniture in Vietnam | ${SITE_NAME}`,
    description:
      'Secondhand furniture and appliances in Ho Chi Minh City at a fraction of retail, with fewer fake photos and bait prices.',
  },
}

const CONTENT: SeoContent = {
  /**
   * ⚠️ THE TITLE, H1 AND SLUG KEEP "MOVING SALES" DELIBERATELY — they are the ranking asset. This
   * page earns 456 impressions at avg position 15.5 on moving-sale and where-to-sell-furniture
   * queries; renaming the slug would forfeit that and need a redirect. The eyebrow and body now
   * lead with what the rail ACTUALLY holds (used furniture and appliances), so the page reads
   * honestly to someone who arrives on either intent — buying secondhand, or clearing a flat.
   */
  eyebrow: 'Secondhand · Ho Chi Minh City',
  h1: 'Moving Sales & Secondhand Furniture in Vietnam',
  intro:
    'Furnish your place for less. Secondhand furniture, appliances and home goods in Ho Chi Minh City — sofas, wardrobes, dining sets, air conditioners, washing machines, air purifiers and robot vacuums, listed used and priced well below retail. Every eno.vn seller has a public trust score and bad listings get reported, so the items and prices are real.',
  /**
   * ⛔ `furniture-appliances` NARROWED TO USED, NOT `moving-sale`. This page pointed at the
   * `moving-sale` category, which has **zero** live listings, while 3,201 used furniture and
   * appliance rows sat one category away. Measured in Search Console: 456 impressions and 15
   * clicks over 93 days — the SECOND most-seen page on the site — every one of them funnelled
   * into an empty rail and the component's own "inventory is empty" branch.
   *
   * ⚠️ THE CONDITION NARROWING IS NOT OPTIONAL HERE. `furniture-appliances` is 6,391 listings of
   * which only 3,201 are used; without it a page titled "Secondhand" would rail brand-new goods.
   */
  categorySlug: 'furniture-appliances',
  condition: 'used',
  /**
   * ⚠️ THE COPY ASSERTS HO CHI MINH CITY AND THE RAIL HAS NO DISTRICT NARROWING — that pairing is
   * only safe because it was MEASURED, not assumed. 2026-09-23, /api/listings sampled 100 used
   * furniture-appliance rows: 100 of 100 are Hồ Chí Minh. SeoContent has no district field, so
   * there is nothing enforcing it.
   *
   * ⛔ SO THIS IS A CLAIM WITH AN EXPIRY. The first Hanoi or Da Nang sofa posted to this category
   * rails under an FAQ literally titled "What secondhand furniture can I buy in Ho Chi Minh City?"
   * (opus). Re-measure when non-HCMC supply appears; the fix is then either a district narrowing
   * on the rail or hedging this copy back to "mostly".
   */
  cta: 'Browse secondhand furniture',
  sections: [
    {
      title: 'What you will find',
      body: 'Sofas, dining sets, wardrobes, shoe cabinets and office desks; air conditioners, washing machines, air purifiers, robot vacuums and small kitchen appliances. Most sit between roughly half a million and five million đồng, with larger appliances above that — a fraction of what the same item costs new.',
    },
    {
      title: 'Move-in and move-out friendly',
      body: 'Furnishing a new place or clearing one out, the practical questions are the same: can you see it, can you collect it, and will it fit. Message the seller in-app to arrange a viewing, agree a pickup date, and ask for measurements before you cross town.',
    },
    {
      title: 'Buy without the guesswork',
      body: 'Every seller has a public trust score and buyers can report bad listings, so misleading photos and prices get caught and penalized — and you don’t waste a trip across town on an item that’s already gone or not as described.',
    },
  ],
  faqs: [
    {
      q: 'What secondhand furniture can I buy in Ho Chi Minh City?',
      a: 'Sofas, beds, wardrobes, dining and office tables, shelving and shoe cabinets, plus used appliances — air conditioners, washing machines, air purifiers and robot vacuums. Listings show the condition the seller set, and you can message them before you travel to see it.',
    },
    {
      q: 'Can I arrange pickup?',
      a: 'Yes. Message the seller in-app to confirm the item, agree a price and arrange a pickup date — many will bundle several items together.',
    },
    {
      q: 'How does eno.vn keep listings genuine?',
      a: 'Every seller has a public trust score built from evidence rather than self-description, and buyers can report bad listings, so misleading photos and bait prices get caught and penalized.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
