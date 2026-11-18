import { schemaFeedBody } from '@/lib/schema-feed'

/**
 * /schema-feed.jsonl — the NLWeb Schema Feed of the public listings (src/lib/schema-feed.ts has what is in it and why),
 * named by /schemamap.xml, which robots.txt names. Outside /api on purpose: robots.txt disallows /api, and the spec's
 * consumers honour robots.txt.
 *
 * ⛔ NEVER PRERENDERED AT BUILD: a static route with `revalidate` is built inside `next build`, and reading 5,000 listings
 * there timed the box build out three times (2026-11-19, the adfef7592 deploy was refused). The route is dynamic and the body
 * is held IN THIS PROCESS for 10 minutes — not the data cache, which skips entries over 2 MB and this body is larger.
 * One database read per window per container; concurrent requests share one read; a stale body (≤ 30 min in this process; the edge may add its 10) is served while the next
 * builds; a failed read waits 60 s before the next, and past 30 min the feed answers 503 rather than an old body. Each edition's container holds its own (no shared key), and a deploy starts empty.
 */
export const dynamic = 'force-dynamic'

const TTL_MS = 600_000
/** A taken-down listing must leave the feed: past this age a body is never served, stale or not. */
const MAX_STALE_MS = 1_800_000
/** After a failed read, wait before the next one — a struggling database is not asked again on every request. */
const RETRY_MS = 60_000
let held: { body: string; at: number } | null = null
let building: Promise<string> | null = null
let failedAt = 0

function feedBody(): Promise<string | null> {
  const now = Date.now()
  if (held && now - held.at < TTL_MS) return Promise.resolve(held.body)
  if (!building && now - failedAt >= RETRY_MS) {
    // A stalled connection must not hold `building` for ever: 30 s, then it counts as a failed read.
    building = Promise.race([schemaFeedBody(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('schema feed read timed out')), 30_000))])
      .then((body) => { held = { body, at: Date.now() }; return body })
      .catch((error) => { failedAt = Date.now(); console.error('schema-feed.jsonl rebuild failed:', error); throw error })
      .finally(() => { building = null })
  }
  const usable = held && now - held.at < MAX_STALE_MS ? held.body : null
  if (usable !== null) { building?.catch(() => {}); return Promise.resolve(usable) }
  return building ? building.catch(() => null) : Promise.resolve(null)
}

export async function GET() {
  const body = await feedBody()
  if (body === null) {
    return new Response('The feed is being rebuilt. Try again shortly.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' },
    })
  }
  return new Response(body, {
    headers: {
      // The spec's MIME type for a `.jsonl` feed (Schema Feeds v0.1, Appendix B).
      'Content-Type': 'application/x-jsonlines; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
      // Data for agents, not a page: the listing pages are what search should rank.
      'X-Robots-Tag': 'noindex',
    },
  })
}
