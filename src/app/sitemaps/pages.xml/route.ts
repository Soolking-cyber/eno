import { xmlResponse } from '@/lib/sitemap'
import { NextResponse } from 'next/server'
import { buildPagesSitemap } from './build'

/**
 * /sitemaps/pages.xml — EVERY SUBMITTED URL THAT IS NOT A LISTING. It was the body of /sitemap.xml
 * until 2026-09-24, when that became a sitemap INDEX (src/lib/sitemap.ts says why). The listing URLs
 * moved to /sitemaps/listings-<k>.xml; everything else is here, with one real change: the category
 * lastmods, the category × district combos and the storefront URLs are derived from whole-table
 * GROUP BYs instead of the newest 45,000 rows, so a bulk import can no longer push older stock's
 * districts and sellers out of the sitemap.
 */

// Cache the generated sitemap instead of rebuilding it (DB query over all listings
// + a serverless cold start) on every request — that ~6s response was timing out
// Google's fetcher ("Couldn't fetch"). ISR revalidates every 24h in the background
// (plus a 1h CDN s-maxage below), so Google always gets a fast, already-built XML.
export const revalidate = 86400

// ⚠️ THE BODY LIVES IN ./build.ts SINCE SEO WAVE B (I4), so the IndexNow cron can build the same
// document in-process; that file carries every rule and its reasoning. This route only serves it.
export async function GET() {
  try {
    return xmlResponse((await buildPagesSitemap({ rentIndex: 'require' })).xml)
  } catch (error) {
    console.error('Failed to generate sitemaps/pages.xml:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
