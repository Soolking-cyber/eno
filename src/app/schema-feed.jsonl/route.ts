import { schemaFeedBody } from '@/lib/schema-feed'

/**
 * /schema-feed.jsonl — the NLWeb Schema Feed of the public listings (src/lib/schema-feed.ts has what is in it and why),
 * named by /schemamap.xml, which robots.txt names. Outside /api on purpose: robots.txt disallows /api, and the spec's
 * consumers honour robots.txt.
 */

// Rebuilt at most every 10 minutes in the background (ISR), never per request — the bound on database reads.
export const revalidate = 600

export async function GET() {
  try {
    return new Response(await schemaFeedBody(), {
      headers: {
        // The spec's MIME type for a `.jsonl` feed (Schema Feeds v0.1, Appendix B).
        'Content-Type': 'application/x-jsonlines; charset=utf-8',
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
        // Data for agents, not a page: the listing pages are what search should rank.
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    // ⛔ RETHROWN, NEVER RETURNED AS A 500 — as the sitemaps: a returned 500 is cached by ISR in place of the good copy.
    console.error('Failed to generate schema-feed.jsonl (the last good copy stays served):', error)
    throw error
  }
}
