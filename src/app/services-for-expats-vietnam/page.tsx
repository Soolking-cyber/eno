import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Services for Expats in Vietnam | eno.vn',
  description:
    'Find trusted services for expats in Vietnam — cleaning, moving, repairs, tutoring, beauty and more in Ho Chi Minh City. Every eno.vn provider has a public trust score and bad listings get reported.',
  alternates: { canonical: '/services-for-expats-vietnam' },
  openGraph: {
    title: 'Services for Expats in Vietnam | eno.vn',
    description:
      'Trusted services for expats — cleaning, moving, repairs, tutoring, beauty and more, with fewer no-shows and inflated prices.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Services · Vietnam',
  h1: 'Services for Expats in Vietnam',
  intro:
    'Get things done with providers used to working with internationals. Find cleaning, moving help, home repairs, tutoring, beauty and wellness, pet care and more — mostly across Ho Chi Minh City. Every eno.vn provider has a public trust score and bad listings get reported, so you can book with confidence.',
  categorySlug: 'services',
  cta: 'Browse services',
  sections: [
    {
      title: 'Everyday help, English-friendly',
      body: 'House cleaning and laundry, moving and delivery, AC and appliance repair, plumbing and handyman work, language tutoring, hair and beauty, and pet care. Many providers are comfortable communicating in English.',
    },
    {
      title: 'Book directly',
      body: 'Message the provider in-app to describe what you need, agree a price and schedule. You only share your number once they reply, keeping spam away.',
    },
    {
      title: 'Trust scores keep providers honest',
      body: 'Every provider has a public trust score and buyers can report bad listings, so no-shows and inflated newcomer pricing get caught and penalized.',
    },
  ],
  faqs: [
    {
      q: 'What services can I find?',
      a: 'Cleaning, moving and delivery, home and appliance repair, tutoring, beauty and wellness, pet care and more — primarily in Ho Chi Minh City.',
    },
    {
      q: 'Do providers speak English?',
      a: 'Many are used to working with internationals and communicate in English. Confirm in chat before booking.',
    },
    {
      q: 'How do I book a service?',
      a: 'Tap “Message” on a listing to chat in-app, agree on scope and price, then schedule. Share your number only after they reply.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
