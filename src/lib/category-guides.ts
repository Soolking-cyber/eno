import { MARKETPLACE_GUIDES, expatGuidePath } from './expat-guides'
import { PHONE_GUIDES, phoneGuideCategories } from './phone-guides'
import { teachGuideLinks } from './teach-guides/site-links'

/**
 * THE "GUIDES" BLOCK ON A CATEGORY PAGE — which long-form guides `/c/<category>` links to.
 *
 * ⛔ THE ~45 GUIDES HAD NO LINK FROM ANY HUB. Measured 2026-09-27: nothing on `/`, `/about`, any
 * `/c/*` page or any landing pointed at one; each was reachable only from the sitemap and its own
 * siblings' "Keep reading". The category page is where a reader of that inventory is, so the link
 * goes there — driven by the registries' `categories` field, never a list typed into the page.
 *
 * ⚠️ BOTH REGISTRIES ARE MARKETPLACE ROUTES (`page.tsx`) — `EXPAT_GUIDES` is not read here, because
 * those are forum-only and would be 404s on eno.vn. The test pins that every guide this returns has
 * a `page.tsx`.
 *
 * ⚠️ SAME LANGUAGE, OR ENGLISH — NEVER A MIX. The page's language picks the guides; a language with
 * none for this category falls back to the English ones (the rentals guides are English-only today).
 * A list is never half one language and half the other, and the link text is always the guide's own
 * `label` in the guide's own language — the caller marks it with `lang` so a reader and a screen
 * reader both know.
 */

export type CategoryGuide = { href: string; label: string; blurb: string; lang: 'en' | 'vi' }

/** At most this many — a block of links, not a second index page. */
export const CATEGORY_GUIDE_LIMIT = 4

type Entry = { href: string; lang: 'en' | 'vi'; label: string; blurb: string; categories: readonly string[] }

const ENTRIES: readonly Entry[] = [
  ...MARKETPLACE_GUIDES.map((g) => ({ href: expatGuidePath(g.slug), lang: g.lang ?? ('en' as const), label: g.label, blurb: g.blurb, categories: g.categories ?? [] })),
  ...PHONE_GUIDES.map((g) => ({ href: expatGuidePath(g.slug), lang: g.lang, label: g.label, blurb: g.blurb, categories: phoneGuideCategories(g) })),
]

/**
 * ⛔ THE TEACH-IN-VIETNAM LIBRARY ON THE TWO TEACHING CATEGORIES (teacher visibility plan, 2026-10-18). /c/jobs is where a
 * teacher looking for work lands and /c/teachers where one who wants to be found does, and neither linked the library —
 * the same orphaning this file's header describes, measured again for the teach guides (src/lib/teach-guides/site-links.ts).
 * GUIDES ONLY, NOT THE HUB: both pages already link the hub in the line under their lede (teaching-links.tsx
 * `TeachGuideLink`), so a hub row here would be the same link twice (diff review, 2026-10-18). The guides answer that page's
 * own question; private tutoring is one of the two guides Google had still not indexed. The links come from the teach
 * registry, so an unreleased guide drops out instead of linking a 404. English only, like the library: a Vietnamese page
 * shows them through the English fallback below, marked `lang="en"` by CategoryGuides.
 */
const TEACH_ON_CATEGORY: Readonly<Record<string, readonly string[]>> = {
  jobs: ['finding-a-teaching-job-in-vietnam', 'requirements-to-teach-english-in-vietnam', 'english-teacher-salary-in-vietnam', 'vietnam-work-permit-for-english-teachers'],
  teachers: ['cover-lessons-and-substitute-teaching-in-ho-chi-minh-city', 'english-teacher-cv-and-demo-lesson-in-vietnam', 'international-school-jobs-in-vietnam', 'private-tutoring-and-online-teaching-in-vietnam'],
}

/** The teach entries for `now` — read at call time, because a guide's release is a date (registry.ts `isLive`). */
function teachEntries(now: Date): Entry[] {
  return Object.entries(TEACH_ON_CATEGORY).flatMap(([category, slugs]) =>
    teachGuideLinks(slugs, now).map((l) => ({ ...l, lang: 'en' as const, categories: [category] })),
  )
}

/**
 * Up to `limit` guides for `category` in `lang`, falling back to English.
 *
 * ⚠️ RANKED BY WHERE THE CATEGORY SITS IN EACH GUIDE'S `categories`, then registry order: a guide
 * written FOR rentals (renting, deposit) comes before one that merely also fits it (furnishing).
 */
export function guidesForCategory(category: string, lang: 'en' | 'vi', limit = CATEGORY_GUIDE_LIMIT, now: Date = new Date()): CategoryGuide[] {
  const on = [...ENTRIES, ...teachEntries(now)].map((g, i) => ({ g, i, rank: g.categories.indexOf(category) })).filter((x) => x.rank >= 0)
  const inLang = (l: 'en' | 'vi') =>
    on.filter((x) => x.g.lang === l).sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, Math.max(0, limit))
  const own = inLang(lang)
  return (own.length ? own : inLang('en')).map(({ g }) => ({ href: g.href, label: g.label, blurb: g.blurb, lang: g.lang }))
}
