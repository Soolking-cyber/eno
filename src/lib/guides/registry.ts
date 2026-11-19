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
  { slug: 'international-driving-permit-vietnam', lang: 'en', published: '2026-11-05', updated: '2026-11-05', released: '2026-11-05', reviewed: '2026-11-05', reviewedDigest: 'd8dac8a4a78173f7', pair: 'bang-lai-xe-quoc-te-lai-xe-o-viet-nam' },
  { slug: 'thue-xe-dien-vinfast-tphcm', lang: 'vi', published: '2026-11-05', updated: '2026-11-13', released: '2026-11-05', reviewed: '2026-11-13', reviewedDigest: '5d7845cc1c427b2a', pair: 'vinfast-electric-scooter-and-car-rental-ho-chi-minh-city' },
  { slug: 'thue-xe-may-sai-gon-kinh-nghiem', lang: 'vi', published: '2026-11-06', updated: '2026-11-13', released: '2026-11-06', reviewed: '2026-11-13', reviewedDigest: 'a90ec902d209ac97', pair: 'renting-a-motorbike-in-ho-chi-minh-city' },
  { slug: 'renting-a-motorbike-in-vietnam', lang: 'en', published: '2026-11-09', reviewed: '2026-11-09', reviewedDigest: 'c2da1dd61042260d', pair: 'kinh-nghiem-thue-xe-may-viet-nam' },
  { slug: 'hire-a-foreign-english-teacher-in-vietnam', lang: 'en', published: '2026-11-11', reviewed: '2026-11-10', reviewedDigest: '5d30667cfa1c568d', pair: 'tuyen-giao-vien-nuoc-ngoai-day-tieng-anh' },
  { slug: 'renting-to-foreigners-ho-chi-minh-city', lang: 'en', published: '2026-11-11', reviewed: '2026-11-11', reviewedDigest: 'dbd431d0b65a0218', pair: 'cho-nguoi-nuoc-ngoai-thue-nha-tphcm' },
  { slug: 'tuyen-giao-vien-nuoc-ngoai-day-tieng-anh', lang: 'vi', published: '2026-11-11', reviewed: '2026-11-11', reviewedDigest: 'c3d368790e7d83e6', pair: 'hire-a-foreign-english-teacher-in-vietnam' },
  { slug: 'cho-nguoi-nuoc-ngoai-thue-nha-tphcm', lang: 'vi', published: '2026-11-12', reviewed: '2026-11-12', reviewedDigest: '952d761221728279', pair: 'renting-to-foreigners-ho-chi-minh-city' },
  { slug: 'kinh-nghiem-thue-xe-may-viet-nam', lang: 'vi', published: '2026-11-12', reviewed: '2026-11-12', reviewedDigest: '0c042467d3e69bdf', pair: 'renting-a-motorbike-in-vietnam' },
  { slug: 'vinfast-electric-scooter-and-car-rental-ho-chi-minh-city', lang: 'en', published: '2026-11-12', reviewed: '2026-11-12', reviewedDigest: 'dce10898cc7119b1', pair: 'thue-xe-dien-vinfast-tphcm' },
  { slug: 'bang-lai-xe-quoc-te-lai-xe-o-viet-nam', lang: 'vi', published: '2026-11-13', reviewed: '2026-11-13', reviewedDigest: 'f26d76244d1693c5', pair: 'international-driving-permit-vietnam' },
  { slug: 'thue-xe-o-to-tu-lai-hay-co-tai-xe-tphcm', lang: 'vi', published: '2026-11-17', updated: '2026-11-18', released: '2026-11-17', reviewed: '2026-11-18', reviewedDigest: '68e1a40dcb3ad2f1', pair: 'car-rental-with-driver-ho-chi-minh-city' },
  { slug: 'car-rental-with-driver-ho-chi-minh-city', lang: 'en', published: '2026-11-17', updated: '2026-11-18', released: '2026-11-17', reviewed: '2026-11-18', reviewedDigest: '998944e862acb9aa', pair: 'thue-xe-o-to-tu-lai-hay-co-tai-xe-tphcm' },
  { slug: 'renting-a-motorbike-in-ho-chi-minh-city', lang: 'en', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: 'a9517d44394c1951', pair: 'thue-xe-may-sai-gon-kinh-nghiem' },
  { slug: 'hieu-truong-phai-biet-tieng-anh-thong-tu-94', lang: 'vi', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: '7af513a9f6b99a10', pair: 'vietnam-school-leaders-english-requirements' },
  { slug: 'saigonmoving', lang: 'en', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: '7f8a13e55afda67e' },
  { slug: 'tuyen-giao-vien-nuoc-ngoai', lang: 'vi', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: 'aea55f964498b609' },
  { slug: 'vietnam-school-leaders-english-requirements', lang: 'en', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: '6e97925fe752ec81', pair: 'hieu-truong-phai-biet-tieng-anh-thong-tu-94' },
  { slug: 'mua-iphone-o-viet-nam-co-re-hon-khong', lang: 'vi', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: '114e27d673d69420', pair: 'is-it-cheaper-to-buy-iphone-in-vietnam' },
  { slug: 'is-it-cheaper-to-buy-iphone-in-vietnam', lang: 'en', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: 'e0c124aa9c5dbdbc', pair: 'mua-iphone-o-viet-nam-co-re-hon-khong' },
  // </generated-guides>
  // ⚠️ NOT FROM REACH, SO OUTSIDE THE GENERATED BLOCK: the owner approved this text in chat on 2026-11-19 ("blog post in eno.vn deploy so when someone searches
  // for muaban.net alternative on google we pop up"), after reading it. scripts/carry-guides.mjs owns only the block above and never reads or rewrites these lines.
  // Fact-check before release (same day): unsourced competitor claims removed (Batdongsan row, a superlative, Marketplace seller history). The digest still guards them: edit the JSON and the build stops until a person approves the new text and the digest here is updated.
  { slug: 'muaban-net-alternative', lang: 'en', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: 'e631d1d28fe72b4f', pair: 'thay-the-muaban-net-dang-tin-mien-phi' },
  { slug: 'thay-the-muaban-net-dang-tin-mien-phi', lang: 'vi', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: '6052a59772ad393a', pair: 'muaban-net-alternative' },
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
