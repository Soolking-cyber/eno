import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { seoLandingRobots } from '@/components/marketplace/seo-landing-robots'
import { LANDING_TARGET } from './landing-target'

// 1h, not 7d. The copy IS static, but the page also renders a LIVE 8-listing rail and an
// "inventory is empty" branch — so at weekly regeneration a category that filled on Monday kept
// telling visitors "this part of the marketplace is just getting started" until the following
// Monday. One page per hour is a rounding error against the feed's own traffic; a week of wrong
// copy on the pages built to convert search traffic is not (astra).
export const revalidate = 3600

const BASE_METADATA: Metadata = {
  title: `Motorbikes for Sale & Rent in Vietnam | ${SITE_NAME}`,
  description:
    'Buy or rent motorbikes in Vietnam — Honda, Yamaha, automatic and manual, monthly rentals and used bikes for sale in Ho Chi Minh City. Every eno.vn seller has a public trust score and bad listings get reported.',
  alternates: { canonical: '/motorbikes-for-sale-vietnam' },
  openGraph: {
    title: `Motorbikes for Sale & Rent in Vietnam | ${SITE_NAME}`,
    description:
      'Motorbikes to buy or rent in Vietnam — Honda, Yamaha, automatic & manual. Fewer bait prices, fewer fake photos.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Motorbikes · Vietnam',
  h1: 'Motorbikes for Sale & Rent in Vietnam',
  intro:
    'Get on the road fast. Buy or rent motorbikes in Vietnam — automatic scooters and manual bikes from Honda, Yamaha and more, with monthly rentals and used bikes for sale across Ho Chi Minh City. Every eno.vn seller has a public trust score and bad listings get reported, so the price and condition are real.',
  // ⚠️ `vehicles`, not `motorbike-rentals` — that slug does not exist, so both CTAs landed on the
  // not-found boundary and the listing strip was permanently empty. It was also the wrong INTENT
  // even had it resolved: this page is "motorbikes FOR SALE", and the taxonomy puts all rent
  // intent under `rentals` while vehicles is buy-sell only. See seo-landing.test.ts.
  categorySlug: 'vehicles',
  /**
   * ⛔ NARROWED TO THE `motorbike` SUBCATEGORY, WHICH IS BOTH THE HONEST RAIL AND THE noindex TRIGGER.
   *
   * On `vehicles` alone this page railed the category's 100 listings — of which ZERO are motorbikes;
   * the first row the API returns is a car-seat organiser. It also defeated the robots computation
   * below: `count(vehicles) === 100`, so `live === 0` was false and the page stayed indexable while
   * showing the wrong thing. Both problems have one cause and one fix.
   *
   * ⚠️ AND IT SELF-HEALS. `motorbike` is a real subcategory in taxonomy.ts; the day someone lists a
   * bike the count is non-zero, the rail fills with motorbikes, and the page goes indexable again on
   * the next revalidate — no list to maintain and nothing to remember to undo.
   */
  subcategorySlug: 'motorbike',
  cta: 'Browse motorbikes',
  sections: [
    {
      title: 'Rent monthly or buy used',
      body: 'New arrivals usually rent by the month (great for flexibility and included maintenance), while longer-term residents often buy a used bike. You’ll find both here — filter by transmission (automatic / manual) and engine size to match how you ride.',
    },
    {
      title: 'Popular models',
      body: 'Honda Air Blade, Vision and Wave; Yamaha Janus and Exciter. Automatics like the Air Blade are easiest for city traffic; manuals and larger bikes suit longer trips.',
    },
    {
      title: 'Know what you’re getting',
      body: 'Bike scams and misleading photos are common. On eno.vn every seller has a public trust score and buyers can report bad listings, so problem sellers get caught fast, and you can message the owner or shop in-app to arrange a test ride before paying.',
    },
  ],
  faqs: [
    {
      q: 'Can I rent a motorbike monthly?',
      a: 'Yes — monthly rentals are common and ideal for newcomers. Many include basic maintenance; confirm the details with the owner in chat.',
    },
    {
      q: 'Automatic or manual?',
      a: 'Automatic scooters (e.g. Honda Air Blade, Vision) are easiest for city traffic. Manual or semi-auto bikes suit experienced riders and longer trips.',
    },
    {
      q: 'How does eno.vn keep bikes and prices trustworthy?',
      a: 'Every seller has a public trust score and buyers can report bad listings, so bait prices and recycled photos get caught and penalized. Always arrange a test ride through in-app chat before you pay.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}

/**
 * ⛔ `noindex, follow` WHILE THERE IS NOTHING TO SHOW — COMPUTED, SO IT LIFTS ITSELF.
 *
 * `vehicles` holds 100 listings and not one motorbike — the first row the API returns is a car-seat organiser. Search Console shows this page earning ZERO impressions over 93 days,
 * so suppressing it costs nothing measurable and stops the bounce a visitor would get.
 * The moment real supply lands the count is non-zero and the page goes indexable again on the
 * next revalidate — no list to maintain, which is why it is computed rather than hard-coded.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { ...BASE_METADATA, ...(await seoLandingRobots(LANDING_TARGET)) }
}
