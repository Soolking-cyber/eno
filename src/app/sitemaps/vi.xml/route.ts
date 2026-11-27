import { xmlResponse } from '@/lib/sitemap'
import { buildViSitemap } from './build'

/**
 * /sitemaps/vi.xml — THE VIETNAMESE PAGES OF /sitemaps/pages.xml (2026-11-27, for Cốc Cốc; ./build.ts says what and why).
 * ⚠️ ITS OWN STATIC ROUTE, like ../pages.xml: a static segment wins over ../[file], which serves only listings-<k>.xml.
 */

// The same day's ISR as pages.xml, whose entries it filters.
export const revalidate = 86400

// ⛔ A FAILURE IS RETHROWN, NEVER RETURNED AS A 500 — pages.xml/route.ts says why: under ISR a returned 500 is cached for the
// route's whole day, while a throw keeps the last good copy served (and fails `next build` loudly instead of prerendering a 500).
export async function GET() {
  try {
    return xmlResponse(await buildViSitemap())
  } catch (error) {
    console.error('Failed to generate sitemaps/vi.xml (the last good copy stays served):', error)
    throw error
  }
}
