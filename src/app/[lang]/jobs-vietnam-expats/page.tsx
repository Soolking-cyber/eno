import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { pageShare } from '@/lib/site-identity'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { seoLandingRobots } from '@/components/marketplace/seo-landing-robots'
import { teachLinks } from '@/lib/teach-guides/site-links'
import { localizedHref } from '@/lib/lang-pinned'
import { TeacherProfileLink } from '../c/[category]/teaching-links'
import { LANDING_TARGET } from './landing-target'
import { loadTeachingBoard, TeachingJobsBoard } from './teaching-board'

// 1h, not 7d. The copy IS static, but the page renders the LIVE board of teaching jobs (and its summary) and an
// "inventory is empty" branch — so at weekly regeneration a category that filled on Monday kept
// telling visitors "this part of the marketplace is just getting started" until the following
// Monday. One page per hour is a rounding error against the feed's own traffic; a week of wrong
// copy on the pages built to convert search traffic is not (astra).
export const revalidate = 3600

/**
 * ⛔ THE ENGLISH TEACHING JOBS BOARD, AT THE OLD URL (teacher visibility plan B2, approved in the plan, 2026-10-18). Job
 * searches are the biggest teacher demand ("english teaching jobs in vietnam", 720 a month in the US) and every job
 * this page lists is a teaching job, so it is retitled for that search rather than given a new URL. It gives up the
 * "jobs for expats" wording, which drew 3 impressions in 28 days.
 * ⛔ NO COUNT IN THE <title> (the HTML is cached, and search results quote a title long after) and NO JobPosting
 * markup — this is a list, and most of its jobs are other sites' postings. The numbers live in the board's summary.
 *
 * ⛔ EVERY CLAIM HERE MUST BE TRUE OF A LINKED JOB TOO. Most jobs on this page are reference listings
 * (scripts/import-jobs.ts): the posting lives on a job board or a school's careers site, the Apply
 * button opens it there, there is no in-app chat, and the "seller" is the board, not the employer —
 * eno.vn has vetted nobody. The earlier copy promised in-app messaging and "every employer has a public
 * trust score"; with linked jobs live that becomes a false consumer claim in FAQPage markup
 * (Consumer Protection Law 19/2023). Direct posts by employers do still get chat, so the copy covers both.
 * How each claim below was checked, 2026-10-18:
 *  · the apply-by date — the posting's own deadline, else 14 days after it was posted, whichever comes first: the
 *    pipeline's exportJobs and job-listing.ts mapStagedJob both cap it;
 *  · when a job comes off — "the next time the page is updated" after that date, never "leaves this page once it has
 *    passed": the board drops a closed job at render (board.ts), but this page is ISR HTML served
 *    stale-while-revalidate (live: `s-maxage=3600, stale-while-revalidate=31532400`), so the first visitor after a
 *    quiet spell gets the previous render, closed jobs and all, while it regenerates. The listing page closes its own
 *    Apply button in the browser once the date has passed (JobApplyGuard), which is what keeps a stale row from taking
 *    an application;
 *  · "its Apply button opens the original posting": a row links to its listing page (teaching-board.tsx), and that
 *    page's Apply button opens the posting — the FAQ's "Open the job and tap its Apply button" says the same;
 *  · "can leave earlier if the original posting is taken down": the stage's `gone` list (import-jobs.ts hides those rows);
 *  · the work-permit answer restates the published work-permit guide's own opening (src/content/teach-in-vietnam);
 *  · the kinds of job named (English at language centres, kindergartens and schools; other subjects taught in English):
 *    the 38 live teaching jobs that day, by title — computer science, chemistry, economics and psychology among them.
 *    No sentence says how MANY are of a kind or come from where: the narrowing cannot hold a proportion true, so those
 *    numbers are the board's, counted per render;
 *  · a direct post's chat: the listing page gives a row without an outside link the chat composer, not Apply;
 *  · "has not verified/vetted the employers" covers BOTH kinds of job (review, 2026-10-19): naming only the linked ones
 *    implied in FAQPage markup that direct posters were checked, and nobody checks them either.
 */
const TITLE = `English Teaching Jobs in Vietnam | ${SITE_NAME}`
const DESCRIPTION =
  'English teaching jobs in Vietnam by city: Ho Chi Minh City, Hanoi, Da Nang and more, with pay and apply-by dates where given. Never pay to get a job.'

const BASE_METADATA: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/jobs-vietnam-expats' },
  ...pageShare({
    title: TITLE,
    description: 'English teaching jobs in Vietnam by city, with pay and apply-by dates where given.',
  }),
}

const CONTENT: SeoContent = {
  eyebrow: 'Teaching jobs · Vietnam',
  h1: 'English teaching jobs in Vietnam',
  intro:
    'Jobs teaching English in Vietnam — and other subjects taught in English — sorted by city, with the pay where the posting states it. A job linked from a job board or a school’s careers page carries an apply-by date, and its Apply button opens the original posting, where you read the full ad and apply.',
  // The narrowing, exactly landing-target.ts (seo-landing-target.test.ts compares the two).
  categorySlug: 'jobs',
  subcategorySlug: 'teaching',
  listingType: 'job',
  trustStrip: false,
  cta: 'Browse teaching jobs',
  sections: [
    {
      title: 'Where these jobs come from',
      body: `The jobs here are linked from job boards and schools’ own careers pages, or posted directly on ${SITE_NAME}. For a linked job, ${SITE_NAME} shows what the posting says — the role, the employer, the city and the pay, where it gives them — adds an apply-by date, and links to the original posting. The apply-by date is the posting’s own deadline or 14 days after it was posted, whichever comes first; after that date, the job comes off this page the next time the page is updated.`,
    },
    {
      title: 'Apply on the original posting',
      body: `A linked job’s Apply button opens the job board’s or school’s own posting, and your application goes to them — ${SITE_NAME} does not handle applications or see your CV. A job posted directly on ${SITE_NAME} has no outside posting: you message the poster in-app instead.`,
    },
    {
      title: 'Never pay to get a job',
      body: `${SITE_NAME} has not verified the employers behind these jobs, linked or posted directly. A real employer never asks for a fee, a deposit or payment for training before you start. Check the employer independently, and report a listing that looks wrong.`,
    },
  ],
  faqs: [
    {
      q: 'What kinds of teaching jobs are listed here?',
      a: 'Teaching jobs in Vietnam: English at language centres, kindergartens and schools, and other subjects at schools that teach in English. The list on this page sorts them by city — Ho Chi Minh City, Hanoi, Da Nang and elsewhere.',
    },
    {
      q: 'Do I need a work permit to teach English in Vietnam?',
      a: 'Yes, apart from a few narrow exemptions: you need a work permit before your first paid class, and your employer applies for it, not you. Ask the employer to confirm that it will before you accept an offer.',
    },
    {
      q: 'How do I apply?',
      a: `Open the job and tap its Apply button: it takes you to the original posting, where you apply to the employer. ${SITE_NAME} does not take applications and never charges a fee. A job posted directly on ${SITE_NAME} has a chat button instead.`,
    },
    {
      q: `Has ${SITE_NAME} checked these employers?`,
      a: `No. ${SITE_NAME} has not vetted the employers behind these jobs — neither the job boards’ and schools’ postings it links nor the jobs posted directly on ${SITE_NAME}. A real employer never asks you for a fee or a deposit; report a listing that looks wrong.`,
    },
    {
      q: 'Why did a job disappear from this page?',
      a: 'A linked job stays on this page until its apply-by date — the posting’s own deadline or 14 days after it was posted, whichever comes first — and comes off the next time the page is updated after that. It can leave earlier if the original posting is taken down.',
    },
  ],
}

/**
 * ⛔ THE TEACHING GUIDES, FROM THE PAGE BUILT FOR PEOPLE LOOKING FOR TEACHING WORK (teacher visibility plan, 2026-10-18).
 * Every job here is a teaching job (measured that day: 38 of 38), yet the page linked no guide — the library's
 * measurement is in src/lib/teach-guides/site-links.ts. Built per render from the teach registry, so an unreleased or
 * withdrawn guide drops out instead of linking a 404. Marketplace only: eno.forum 308s the library to eno.vn.
 */
const TEACH_RELATED = [
  'finding-a-teaching-job-in-vietnam',
  'requirements-to-teach-english-in-vietnam',
  'vietnam-work-permit-for-english-teachers',
  'english-teacher-salary-in-vietnam',
  'teaching-job-scams-in-vietnam',
]

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const [{ lang }, board] = await Promise.all([params, loadTeachingBoard()])
  return (
    <SeoLanding
      // Added to whatever `related` the content carries (none today), never replacing it.
      content={IS_SERVICES ? CONTENT : { ...CONTENT, related: [...(CONTENT.related ?? []), ...teachLinks(TEACH_RELATED)] }}
      // The profile prompt /c/jobs carries (teaching-links.tsx), with the href built the way /c/jobs builds it: this was
      // the one jobs page without it, and a teacher reading jobs may rather be found. Both editions, like /c/jobs' — the
      // profile form exists on both.
      lede={<TeacherProfileLink href={localizedHref('/teachers/join', lang)} className="mt-4" />}
      // ⚠️ THE BOARD REPLACES THE 8-CARD RAIL: it lists every live teaching job, so the rail would only repeat its eight
      // newest. Its own read decides SeoLanding's empty state too ("just getting started"), so a day with no teaching job
      // still shows that. A read that fails while `next build` prerenders shows the plain CTA, as a failed rail did; one
      // that fails at runtime throws, so ISR keeps serving the last good page (teaching-board.tsx loadTeachingBoard).
      inventory={{ known: board.known, count: board.jobs.length, node: <TeachingJobsBoard board={board} /> }}
    />
  )
}

/**
 * ⛔ `noindex, follow` WHILE THERE IS NOTHING TO SHOW — COMPUTED, SO IT LIFTS ITSELF.
 *
 * Counted over the page's own narrowing (landing-target.ts — live teaching jobs since B2). Search Console showed the
 * old all-jobs page earning ZERO impressions over 93 days while `jobs` was empty, so suppressing an empty page costs
 * nothing measurable and stops the bounce a visitor would get.
 * The moment real supply lands the count is non-zero and the page goes indexable again on the
 * next revalidate — no list to maintain, which is why it is computed rather than hard-coded.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { ...BASE_METADATA, ...(await seoLandingRobots(LANDING_TARGET)) }
}
