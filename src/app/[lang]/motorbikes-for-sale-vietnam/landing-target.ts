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
 */
export const LANDING_TARGET: SeoLandingTarget = { categorySlug: 'vehicles', subcategorySlug: 'motorbike' }
