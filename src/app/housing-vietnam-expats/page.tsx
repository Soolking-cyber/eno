import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Housing & Apartment Rentals for Expats in Vietnam | eno.vn',
  description:
    'Find verified apartments, houses and serviced rentals for expats in Vietnam — Thao Dien, District 2, Phu My Hung, District 7 and more. Every eno.vn listing is checked before it goes live.',
  alternates: { canonical: '/housing-vietnam-expats' },
  openGraph: {
    title: 'Housing & Apartment Rentals for Expats in Vietnam | eno.vn',
    description:
      'Verified apartments, houses and serviced rentals for expats across Ho Chi Minh City. No fake photos, no bait prices.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Housing · Vietnam',
  h1: 'Housing & Apartment Rentals for Expats in Vietnam',
  intro:
    'Find verified apartments, houses and serviced rentals for expats and internationals across Ho Chi Minh City and beyond. From studios to family villas — furnished, monthly or yearly — every eno.vn rental is checked before it goes live, so there are no fake photos, no bait prices and no wasted viewings.',
  categorySlug: 'house-rentals',
  cta: 'Browse verified housing',
  sections: [
    {
      title: 'Popular expat areas',
      body: 'Thao Dien (District 2) and An Phu are the long-time favourites for international families, with greenery, international schools and Western cafés. Phu My Hung (District 7) offers modern, well-managed apartment compounds, while District 1 and Binh Thanh suit those who want to be close to the centre. Browse by area to see verified rentals near you.',
    },
    {
      title: 'What you’ll find',
      body: 'Serviced apartments, unfurnished and fully-furnished units, shophouses and villas — from short monthly stays to long yearly leases. Each listing shows the real price, location and photos, and you can message the landlord or agent directly through eno.vn.',
    },
    {
      title: 'Rent with confidence',
      body: 'Scams and recycled photos are common on open listing sites. eno.vn verifies each rental before it appears, so what you see is what you get. You only reveal your number after the other side replies in chat.',
    },
  ],
  faqs: [
    {
      q: 'Are the rentals on eno.vn verified?',
      a: 'Yes. Every listing is checked before it goes live — by in-person visit, video, or against documents — so you avoid fake photos and bait prices.',
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
