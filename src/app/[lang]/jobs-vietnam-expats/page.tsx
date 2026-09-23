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
  title: `Jobs for Expats & Internationals in Vietnam | ${SITE_NAME}`,
  description:
    'Find jobs for expats and internationals in Vietnam — teaching, hospitality, marketing, tech and English-required roles in Ho Chi Minh City. Every eno.vn employer has a public trust score and bad listings get reported.',
  alternates: { canonical: '/jobs-vietnam-expats' },
  openGraph: {
    title: `Jobs for Expats & Internationals in Vietnam | ${SITE_NAME}`,
    description:
      'Teaching, hospitality, marketing, tech and English-required roles for internationals in Vietnam — fewer fake and recycled postings.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Jobs · Vietnam',
  h1: 'Jobs for Expats & Internationals in Vietnam',
  intro:
    'Looking for work in Vietnam? Find jobs suited to expats and internationals — English teaching, hospitality, marketing, design, tech and roles where English is required — mostly across Ho Chi Minh City. Every eno.vn employer has a public trust score and bad listings get reported, so you skip the recycled and fake postings.',
  categorySlug: 'jobs',
  cta: 'Browse jobs',
  sections: [
    {
      title: 'Roles internationals look for',
      body: 'English teaching (centres and international schools), hospitality and F&B, digital marketing, software and design, plus customer-facing roles where a foreign language is an asset. Filter the listings to find roles that explicitly require English.',
    },
    {
      title: 'Apply directly, no middlemen',
      body: 'Message the employer or recruiter in-app and follow up on your own terms. You decide when to share your contact details — only after they reply.',
    },
    {
      title: 'Fewer scams, real opportunities',
      body: 'Job scams targeting newcomers are common. On eno.vn every employer has a public trust score and buyers can report bad listings, so problem posters get caught fast and you spend your time on genuine opportunities.',
    },
  ],
  faqs: [
    {
      q: 'What kinds of jobs are listed for expats?',
      a: 'English teaching, hospitality, marketing, tech, design and other roles where English or another foreign language is useful — primarily in Ho Chi Minh City.',
    },
    {
      q: 'Do I need a work permit?',
      a: 'Most full-time roles for foreigners require a work permit and visa. Ask the employer directly through in-app chat about sponsorship before you commit.',
    },
    {
      q: 'How do I apply?',
      a: 'Tap “Message” on a job listing to contact the employer in-app; share your CV or details once they reply.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}

/**
 * ⛔ `noindex, follow` WHILE THERE IS NOTHING TO SHOW — COMPUTED, SO IT LIFTS ITSELF.
 *
 * `jobs` holds zero live listings. Search Console shows this page earning ZERO impressions over 93 days,
 * so suppressing it costs nothing measurable and stops the bounce a visitor would get.
 * The moment real supply lands the count is non-zero and the page goes indexable again on the
 * next revalidate — no list to maintain, which is why it is computed rather than hard-coded.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { ...BASE_METADATA, ...(await seoLandingRobots(LANDING_TARGET)) }
}
