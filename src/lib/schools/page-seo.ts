import type { SchoolKind } from './constants'

/**
 * WHAT SEARCH ENGINES ARE TOLD ABOUT A SCHOOL PAGE (/schools/<slug>, plan P1 item 17, 2026-10-20). Pure and
 * client-safe: the page (src/app/[lang]/schools/[slug]/page.tsx) and pages.xml (queries.ts schoolsForSitemap) both
 * import it, so the two can no longer state two rules.
 */

/**
 * What a school page has of its own: its PUBLIC reviews and the live jobs it lists. Pay is not a third field because
 * it cannot exist without a review: queries.ts payReports reads only published reviews by an author who counts — the
 * rule visibleReviews applies — and of those only the ones approved before this week. So "0 reviews" is also "no pay".
 */
export type SchoolPageContent = { reviews: number; jobs: number }

/**
 * ⛔ THE INDEX RULE, ONE FUNCTION FOR BOTH ANSWERS: the page's robots (noindex unless this is true) and pages.xml
 * (submitted only when this is true). Until 2026-10-20 they were two rules — the page indexed a review OR a job, the
 * sitemap submitted a review only — so the 7 job-only pages measured that day were indexable and never submitted.
 * A directory entry with neither is a thin page (plan review 2026-10-04: hundreds of them would read as a doorway
 * farm), so it stays noindex and unsubmitted; /schools links every one of them.
 */
export function schoolPageIndexable(c: SchoolPageContent): boolean {
  return c.reviews > 0 || c.jobs > 0
}

/** A page whose only content is open jobs: no review and therefore no pay (see SchoolPageContent). */
export function schoolPageJobsOnly(c: SchoolPageContent): boolean {
  return c.reviews === 0 && c.jobs > 0
}

/**
 * The <title> before " | <site>". A jobs-only page is titled for what it has — it used to promise "teacher reviews,
 * pay and jobs" over "Reviews from teachers (0)" and "Not enough pay reports yet". It follows the `[lang]` variant the
 * proxy served, as /contact and /rentals/check do; every other page keeps the title it had (English on both variants).
 */
export function schoolPageTitle(name: string, c: SchoolPageContent, lang: string): string {
  if (schoolPageJobsOnly(c)) return lang === 'vi' ? `${name}: việc làm giáo viên đang tuyển` : `${name}: open teaching jobs`
  return `${name}: teacher reviews, pay and jobs`
}

/**
 * The school's own website AS THE PAGE SHOWS IT: an http(s) address, linked by its host name in the About card — or
 * null, and then neither the card nor the structured data names a website. One helper for both, so the markup can
 * never carry an address the page refused to link.
 */
export function shownWebsite(url: string | null | undefined): { href: string; host: string } | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? { href: url, host: u.hostname.replace(/^www\./, '') } : null
  } catch {
    return null
  }
}

/**
 * The school as structured data, BUILT ONLY FROM WHAT THE PAGE SHOWS: its name (the H1) and, when the About card
 * links it, its own website as `url`. The node's `@id` and `mainEntityOfPage` are this page, which is about the school —
 * never its `url`, which would tell a search engine eno's page is the school's site.
 * ⛔ NO RATING OF ANY KIND: the page shows up/down votes, not a rating on a scale, so an `aggregateRating` would be
 * invented. ⛔ NO ADDRESS: the page lists the districts a school's branches are in, never a street address or a city.
 * A teacher agency is an `Organization`: it recruits teachers, it does not teach (KIND_LABEL "Teacher agency").
 */
export function schoolOrgLd(s: { pageUrl: string; name: string; kind: SchoolKind; website: { href: string } | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': s.kind === 'agency' ? 'Organization' : 'EducationalOrganization',
    '@id': `${s.pageUrl}#school`,
    name: s.name,
    mainEntityOfPage: s.pageUrl,
    ...(s.website ? { url: s.website.href } : {}),
  }
}
