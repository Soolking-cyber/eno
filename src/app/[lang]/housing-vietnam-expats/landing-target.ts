import type { SeoLandingTarget } from '@/components/marketplace/seo-landing-where'

/**
 * THE NARROWING THIS PAGE'S RAIL SELECTS BY, for the sitemap to date the page by (SEO wave B, I3c).
 *
 * ⛔ ITS OWN MODULE BECAUSE THE SITEMAP READS IT, as jobs-vietnam-expats/landing-target.ts does:
 * `page.tsx` imports `SeoLanding`, a React server component, and a plain object in a plain file does
 * not drag it into src/app/sitemaps/pages.xml/route.ts. The page's `CONTENT` still spells the same
 * fields out; components/marketplace/seo-landing-target.test.ts fails the moment the two
 * disagree.
 */
export const LANDING_TARGET: SeoLandingTarget = { categorySlug: 'rentals' }
