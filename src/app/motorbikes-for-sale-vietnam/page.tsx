import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Motorbikes for Sale & Rent in Vietnam | ENO Forum',
  description:
    'Buy or rent verified motorbikes in Vietnam — Honda, Yamaha, automatic and manual, monthly rentals and used bikes for sale in Ho Chi Minh City. Checked before they go live on ENO Forum.',
  alternates: { canonical: '/motorbikes-for-sale-vietnam' },
  openGraph: {
    title: 'Motorbikes for Sale & Rent in Vietnam | ENO Forum',
    description:
      'Verified motorbikes to buy or rent in Vietnam — Honda, Yamaha, automatic & manual. No bait prices, no fake photos.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Motorbikes · Vietnam',
  h1: 'Motorbikes for Sale & Rent in Vietnam',
  intro:
    'Get on the road fast. Buy or rent verified motorbikes in Vietnam — automatic scooters and manual bikes from Honda, Yamaha and more, with monthly rentals and used bikes for sale across Ho Chi Minh City. Every ENO Forum listing is checked before it goes live, so the price and condition are real.',
  categorySlug: 'motorbike-rentals',
  cta: 'Browse verified motorbikes',
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
      body: 'Bike scams and misleading photos are common. ENO Forum verifies each listing first, and you can message the owner or shop in-app to arrange a test ride before paying.',
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
      q: 'Are the bikes and prices verified?',
      a: 'Yes — every listing is checked before it goes live, so you avoid bait prices and recycled photos. Arrange a test ride through in-app chat.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
