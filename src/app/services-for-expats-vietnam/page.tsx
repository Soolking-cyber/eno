import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 604800 // 7d — static SEO copy; weekly regen is plenty (fewer ISR writes)

// ⚠️ THIS PAGE USED TO SELL SERVICES THAT DO NOT EXIST. Until 2026-07-27 the copy promised
// "cleaning, moving, repairs, tutoring, beauty and pet care … across Ho Chi Minh City" and never
// once contained the word "visa". Measured against production the same day: `services` holds 15
// live listings — 14 e-visa products and one trip-planning anchor. Zero cleaners, zero tutors,
// zero pet care, and not one of them is in Ho Chi Minh City.
//
// That is worse than a wasted page. It is the only landing page with real inventory behind it, so
// every visitor it did attract arrived expecting a cleaner and met a visa desk — a bounce Google
// reads as the page failing to answer its own query. The fix is to describe what is actually for
// sale. When somebody finally posts a cleaner this copy stops being COMPLETE rather than becoming
// FALSE, which is the failure direction to prefer.
export const metadata: Metadata = {
  title: 'Services for Expats in Vietnam — e-Visas & Trip Planning | eno.vn',
  description:
    'Services for expats in Vietnam: Vietnam e-visa applications (single and multiple entry, 1 hour to standard) and free trip planning. Every eno.vn provider has a public trust score and bad listings get reported.',
  alternates: { canonical: '/services-for-expats-vietnam' },
  openGraph: {
    title: 'Services for Expats in Vietnam — e-Visas & Trip Planning | eno.vn',
    description:
      'Vietnam e-visas priced up front, and free trip planning — with a public trust score behind every provider.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Services · Vietnam',
  h1: 'Services for Expats in Vietnam',
  intro:
    'Two services are live on eno.vn today: Vietnam e-visa applications, at every processing speed from standard to one-hour express, and free trip planning if you are still working out the route. Every e-visa price is on its own listing, so you can compare before you talk to anyone, and every provider has a public trust score.',
  categorySlug: 'services',
  cta: 'Browse services',
  sections: [
    {
      title: 'Vietnam e-visas, priced up front',
      body: 'Fourteen e-visa products are listed: single entry or multiple entry, 90 days, at seven processing speeds — standard, 3, 2 and 1 working days, and 4-hour, 2-hour and 1-hour express. Each is its own listing with its own price, so the cost of going faster is visible before you commit rather than quoted after you have handed over a passport scan.',
    },
    {
      title: 'Visa, work permits, tax and legal',
      body: 'The Visa category is not visa-only: work-permit, tax and legal services belong in it too, and anyone can post one — it is an ordinary marketplace category, not a desk we run. Right now e-visa products are the only listings in it, so if you need a work permit or a tax filing, ask in chat rather than assuming it is on the shelf.',
    },
    {
      title: 'Trip planning, free',
      body: 'Tell us where you are going and how long you have, and a day-by-day itinerary comes back at no cost. We can help book the pieces of it if you want that; you are never obliged to.',
    },
    {
      title: 'What is not here yet',
      body: 'Cleaning, moving help, repairs, tutoring, beauty and pet care are categories on eno.vn, but nobody has posted one in Vietnam yet. Better to say so than to list services we cannot deliver — and if you provide one, posting takes a few minutes and is free.',
    },
  ],
  related: [
    {
      href: '/vietnam-evisa',
      label: 'Vietnam e-visa: prices and processing times',
      blurb: 'Every entry type and speed we list, what each one costs, and which are worth paying for.',
    },
    {
      href: '/itinerary',
      label: 'Free Vietnam itinerary planner',
      blurb: 'A day-by-day plan for your trip, built with you and free to keep.',
    },
  ],
  faqs: [
    {
      q: 'What services can I actually find on eno.vn right now?',
      a: 'Vietnam e-visa applications at seven processing speeds, and free trip planning. The other service categories — including work permits, tax and legal, which share the Visa category — exist but have no listings in Vietnam yet.',
    },
    {
      q: 'How much does a Vietnam e-visa cost here?',
      a: 'It depends on entry type and how fast you need it — standard single entry is the cheapest listing and 1-hour multiple entry the most expensive. Every price is on its own listing; nothing is quoted privately.',
    },
    {
      q: 'How do I hire a provider?',
      a: 'Tap “Message” on the listing to chat in-app, agree on scope and price, then go ahead. You only share your number once they reply, which keeps spam away.',
    },
    {
      q: 'Can I post a service here?',
      a: 'Yes, and it is free. Cleaning, repairs, tutoring and pet care are all live categories with no competition in them yet.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
