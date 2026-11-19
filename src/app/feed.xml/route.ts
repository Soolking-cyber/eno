import { atomFeedBody } from '@/lib/atom-feed'

/**
 * /feed.xml — the Atom feed of the newest public listings (src/lib/atom-feed.ts has what is in it and why), declared in the home
 * page's head and `Link:` header. A dotted root handler like /robots.txt and /schema-feed.jsonl, so the [lang] proxy never sees it.
 *
 * ⛔ NEVER PRERENDERED AT BUILD — the /schema-feed.jsonl lesson (a static route with `revalidate` is built inside `next build`;
 * reading listings there timed the box build out three times on 2026-11-19). Dynamic, with the body held IN THIS PROCESS for
 * 10 minutes: one read per window per container, concurrent requests share it, a stale body (≤ 30 min) is served while the next
 * builds, a failed read waits 60 s before the next, and past 30 min the feed answers 503 rather than an old body (a taken-down
 * listing must leave it). The same shape as src/app/schema-feed.jsonl/route.ts.
 */
export const dynamic = 'force-dynamic'

const TTL_MS = 600_000
const MAX_STALE_MS = 1_800_000
const RETRY_MS = 60_000
let held: { body: string; at: number } | null = null
let building: Promise<string> | null = null
let failedAt = 0

function feedBody(): Promise<string | null> {
  const now = Date.now()
  if (held && now - held.at < TTL_MS) return Promise.resolve(held.body)
  if (!building && now - failedAt >= RETRY_MS) {
    building = Promise.race([atomFeedBody(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('atom feed read timed out')), 30_000))])
      .then((body) => { held = { body, at: Date.now() }; return body })
      .catch((error) => { failedAt = Date.now(); console.error('feed.xml rebuild failed:', error); throw error })
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
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
      // A list for feed readers and agents, not a page: the listing pages are what search should rank.
      'X-Robots-Tag': 'noindex',
    },
  })
}
