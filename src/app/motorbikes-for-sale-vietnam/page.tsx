import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 604800 // 7d — static SEO copy; weekly regen is plenty (fewer ISR writes)

export const metadata: Metadata = {
  title: 'Motorbikes for Sale & Rent in Vietnam | eno.vn',
  description:
    'Buy or rent motorbikes in Vietnam — Honda, Yamaha, automatic and manual, monthly rentals and used bikes for sale in Ho Chi Minh City. Every eno.vn seller has a public trust score and bad listings get reported.',
  alternates: { canonical: '/motorbikes-for-sale-vietnam' },
  openGraph: {
    title: 'Motorbikes for Sale & Rent in Vietnam | eno.vn',
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
