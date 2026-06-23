import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Housing & Apartment Rentals for Expats in Vietnam | eno.vn',
  description:
    'Find apartments, houses and serviced rentals for expats in Vietnam — Thao Dien, District 2, Phu My Hung, District 7 and more. Every eno.vn seller has a public trust score and bad listings get reported.',
  alternates: { canonical: '/housing-vietnam-expats' },
  openGraph: {
    title: 'Housing & Apartment Rentals for Expats in Vietnam | eno.vn',
    description:
      'Apartments, houses and serviced rentals for expats across Ho Chi Minh City — fewer fake photos, fewer bait prices.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Housing · Vietnam',
  h1: 'Housing & Apartment Rentals for Expats in Vietnam',
  intro:
    'Find apartments, houses and serviced rentals for expats and internationals across Ho Chi Minh City and beyond. From studios to family villas — furnished, monthly or yearly — every eno.vn seller has a public trust score and bad listings get reported, so you steer clear of fake photos, bait prices and wasted viewings.',
  categorySlug: 'house-rentals',
  cta: 'Browse housing',
  sections: [
    {
      title: 'Popular expat areas',
      body: 'Thao Dien (District 2) and An Phu are the long-time favourites for international families, with greenery, international schools and Western cafés. Phu My Hung (District 7) offers modern, well-managed apartment compounds, while District 1 and Binh Thanh suit those who want to be close to the centre. Browse by area to see rentals near you.',
    },
    {
      title: 'What you’ll find',
      body: 'Serviced apartments, unfurnished and fully-furnished units, shophouses and villas — from short monthly stays to long yearly leases. Each listing shows the real price, location and photos, and you can message the landlord or agent directly through eno.vn.',
    },
    {
      title: 'Rent with confidence',
      body: 'Scams and recycled photos are common on open listing sites. On eno.vn every seller has a public trust score and buyers can report bad listings, so problem sellers get caught fast. You only reveal your number after the other side replies in chat.',
    },
  ],
  faqs: [
    {
      q: 'How does eno.vn keep rentals trustworthy?',
      a: 'Every seller has a public trust score that reflects their track record, and buyers can report bad listings — so fake photos and bait prices get caught and penalized. Always still view a place before you pay.',
    },
    {
      q: 'How do I contact a landlord or agent?',
      a: 'Tap “Message” on any listing to chat in-app. You can request a phone number or Zalo once the other side replies.',
    },
    {
      q: 'Which areas are best for expats in Ho Chi Minh City?',
      a: 'Thao Dien and An Phu (District 2) and Phu My Hung (District 7) are the most popular with international residents; District 1 and Binh Thanh are great if you want to be central.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
