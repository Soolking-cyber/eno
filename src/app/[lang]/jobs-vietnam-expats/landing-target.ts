import type { SeoLandingTarget } from '@/components/marketplace/seo-landing-where'

/**
 * THE NARROWING THIS PAGE SELECTS BY — declared once, read by THREE places.
 *
 * ⛔ IT IS ITS OWN MODULE BECAUSE THE SITEMAP READS IT. `page.tsx` imports `SeoLanding`, a React
 * server component; importing the target from there would drag the component (and its Prisma and
 * React imports) into src/app/sitemap.xml/route.ts. A plain object in a plain file does not.
 *
 * ⛔ AND BECAUSE HAND-COPYING IT DRIFTS SILENTLY. The sitemap decides whether to submit this URL by
 * counting listings that match this narrowing, and the page decides its own `robots` tag the same
 * way. Written out in both places, a typo — `'motorbikes'` for `'motorbike'` — counts zero, drops
 * the URL from the sitemap permanently, and fails no test. That is the exact drift
 * seo-landing-where.ts exists to prevent, reintroduced one level up; caught in review.
 *
 * ⛔ JOBS › TEACHING, AND JOB POSTS ONLY (teacher visibility plan B2, 2026-10-18). The page is the English teaching jobs
 * board, so its `robots`, its sitemap entry (submitted and dated by these rows) and the board itself (teaching-board.tsx)
 * all read this one narrowing. Category + subcategory are /c/teachers' "Jobs › Teaching" link (category-data.ts
 * TEACHING_JOBS); `listingType: 'job'` leaves out a Wanted ad filed there — someone LOOKING for a teaching job, whose
 * price is a budget — the job set the teacher matcher already uses (teachers/match-io.ts TEACHING_JOB_WHERE). Literal
 * strings, not those constants: either module would bring its own imports (the database client, the teacher profile
 * code) into the sitemap with it, the cost the note above keeps out; seo-landing-target.test.ts pins the page to these.
 *
 * ⚠️ TIED TO THE OTHER TWO READERS OF JOBS › TEACHING BY A TEST, NOT ALIGNED WITH BOTH (review, 2026-10-18). The matcher's
 * set is exactly this one. /c/teachers' "Jobs › Teaching (N)" (category-data.ts TEACHING_JOBS, loadTeachingJobsCount)
 * keeps every listing type, because its count must be what its link opens — the explorer's whole aisle, which has no
 * `type` in it. So the two differ by Wanted ads filed under Teaching, and by nothing else: none was live on 2026-10-18
 * (38 of 38 were job posts). Giving /c/teachers `type=job` would change that page's link and count, which is a
 * /c/teachers decision, not this page's. teaching-board.test.tsx pins this narrowing to TEACHING_JOB_WHERE exactly and
 * to the count's aisle less `listingType`, so drift on any of the three sides fails a test.
 */
export const LANDING_TARGET: SeoLandingTarget = { categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job' }
