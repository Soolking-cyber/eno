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

/**
 * ⛔ EVERY CLAIM HERE MUST BE TRUE OF A LINKED JOB TOO. Most jobs on this page are reference listings
 * (scripts/import-jobs.ts): the posting lives on a job board or a school's careers site, the Apply
 * button opens it there, there is no in-app chat, and the "seller" is the board, not the employer —
 * eno.vn has vetted nobody. The earlier copy promised in-app messaging and "every employer has a public
 * trust score"; with linked jobs live that becomes a false consumer claim in FAQPage markup
 * (Consumer Protection Law 19/2023). Direct posts by employers do still get chat, so the copy covers both.
 */
const BASE_METADATA: Metadata = {
  title: `Jobs for Expats & Internationals in Vietnam | ${SITE_NAME}`,
  description:
    'English-teaching jobs and roles for English speakers in Vietnam — Ho Chi Minh City, Hanoi, Da Nang and beyond. Each job links to the original posting, where you apply. Never pay to get a job.',
  alternates: { canonical: '/jobs-vietnam-expats' },
  openGraph: {
    title: `Jobs for Expats & Internationals in Vietnam | ${SITE_NAME}`,
    description:
      'English-teaching jobs and roles for English speakers in Vietnam, each linked to the original posting.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Jobs · Vietnam',
  h1: 'Jobs for Expats & Internationals in Vietnam',
  intro:
    'Looking for work in Vietnam? Browse English-teaching jobs and roles for English speakers across Ho Chi Minh City, Hanoi, Da Nang and other cities, gathered in one place. Most jobs link to the original posting on a job board or a school’s careers page — you read the full ad and apply there.',
  categorySlug: 'jobs',
  railTitle: 'Latest jobs',
  trustStrip: false,
  cta: 'Browse jobs',
  sections: [
    {
      title: 'Roles internationals look for',
      body: 'English teaching at language centres, public schools and international schools, plus roles at international schools and companies where English is the working language. Each listing shows the employer, city and pay the posting states.',
    },
    {
      title: 'Apply on the original posting',
      body: 'Linked jobs open the employer’s or job board’s own posting, and your application goes to them — eno.vn does not handle applications or see your CV. Some employers post directly on eno.vn; those you can message in-app.',
    },
    {
      title: 'Never pay to get a job',
      body: 'eno.vn has not vetted the employers behind linked postings. A real employer never asks for a fee, a deposit or payment for training before you start. Check the employer independently, and report a listing that looks wrong.',
    },
  ],
  faqs: [
    {
      q: 'What kinds of jobs are listed for expats?',
      a: 'Mostly English teaching — language centres, public schools and international schools — plus roles for English speakers, in Ho Chi Minh City, Hanoi, Da Nang and other cities.',
    },
    {
      q: 'Do I need a work permit?',
      a: 'Most full-time roles for foreigners require a work permit. Ask the employer whether they arrange it before you accept an offer.',
    },
    {
      q: 'How do I apply?',
      a: 'Open the job and tap its Apply button: it takes you to the original posting, where you apply to the employer. eno.vn does not take applications and never charges a fee.',
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
