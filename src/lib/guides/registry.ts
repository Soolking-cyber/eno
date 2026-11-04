import { isReleased, releaseDate } from '@/lib/teach-guides/registry'
import { GUIDE_CONTENT } from './content.generated'

/**
 * THE GENERAL GUIDE LIBRARY: guides for renters, shops, landlords and employers, as data, through the same schema, renderer and review gate as the Teach in Vietnam library
 * (src/lib/teach-guides). English lives at /guides/<slug> and Vietnamese at /huong-dan/<slug>: an article is written in one language, so its address says which, and the proxy can pin the
 * language from the path alone without carrying this list into every request (src/lib/lang-pinned.ts).
 *
 * ⛔ NO VISA, ITINERARY OR PAYPAL VOCABULARY, AND NO PERMISSION-TO-STAY VOCABULARY (src/test/edition-words.ts, enforced by guides.test.ts): these are on the licensed marketplace.
 *
 * ⛔ NO REVIEW, NO RELEASE. `reviewed` is the day a person on the eno.vn team approved this guide, and `reviewedDigest` is what they approved (content.ts fails the build if the text has
 * changed since). Drafts are written with AI by eno Reach; a person approves them there, and Google's guidance on AI content asks for exactly that before publishing.
 *
 * Released by date: `published` can be in the future, so one deploy can carry several guides and release them a few at a time. A new domain publishing in bulk reads as scaled production.
 *
 * scripts/carry-guides.mjs brings approved guides over from Reach and owns the generated block below: run it right before a deploy that should take them. It dates each one the day it is carried,
 * never ahead, because a date ahead would let a guide go live long after a person took it back.
 */
export type GuideEntry = {
  slug: string
  lang: 'en' | 'vi'
  /** YYYY-MM-DD: the day it may go live. */
  published: string
  updated?: string
  released?: string
  reviewed?: string
  reviewedDigest?: string
  /** The same article's slug in the other language, when there is one. */
  pair?: string
}

export const GUIDES: readonly GuideEntry[] = [
  // <generated-guides>
  // </generated-guides>
]

export const GUIDE_BASE = { en: '/guides', vi: '/huong-dan' } as const
export const guidePath = (e: Pick<GuideEntry, 'slug' | 'lang'>) => `${GUIDE_BASE[e.lang]}/${e.slug}`
export const guideEntry = (slug: string, entries: readonly GuideEntry[] = GUIDES) => entries.find((e) => e.slug === slug) ?? null

/** Its link text and one line: the guide's own heading and description, so no word on a hub or in llms.txt is outside what a person reviewed. */
const docOf = (slug: string) => (Object.prototype.hasOwnProperty.call(GUIDE_CONTENT, slug) ? (GUIDE_CONTENT[slug] as { h1?: string; description?: string }) : undefined)
export const guideLabel = (e: Pick<GuideEntry, 'slug'>) => docOf(e.slug)?.h1 ?? e.slug
export const guideBlurb = (e: Pick<GuideEntry, 'slug'>) => docOf(e.slug)?.description ?? ''

/** Reviewed, its day reached, and its text in the build. */
export function isGuideLive(e: GuideEntry, now: Date = new Date(), content: Readonly<Record<string, unknown>> = GUIDE_CONTENT): boolean {
  return isReleased(e, now) && Object.prototype.hasOwnProperty.call(content, e.slug)
}
export const liveGuides = (now: Date = new Date()) => GUIDES.filter((e) => isGuideLive(e, now))

/** The article's dates: the day it really went live, and a reader-visible edit if there was one. */
export function guideDates(e: GuideEntry): { published: string; updated?: string } {
  const published = releaseDate(e)
  // An edit made before it went live is not an update: a page must never say it was modified before it was published.
  return { published, ...(e.updated && e.updated > published ? { updated: e.updated } : {}) }
}
