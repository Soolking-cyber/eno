import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getTrending, logSearch } from '@/lib/trending'

export const runtime = 'nodejs'

// Public "Xu hướng tìm kiếm" (trending searches) feed for the empty-focus search
// dropdown. Reads the Upstash-backed daily counters via getTrending() — fails
// OPEN to an empty list when Redis is unconfigured or errors, so the search UI
// simply omits the trending row rather than breaking. CDN-cached ~5min since the
// data is coarse-grained and identical for everyone.
export async function GET() {
  const trending = await getTrending(6)
  return NextResponse.json(
    { trending },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  )
}

// Record a committed search against the trending counters. Fire-and-forget from the
// client (keepalive fetch on submit) — logSearch normalizes, no-ops when Redis is
// unconfigured, and swallows every error, so this can never break search. Always
// 204, even on a malformed body.
export async function POST(req: Request) {
  try {
    const { q } = (await req.json()) as { q?: unknown }
    if (typeof q === 'string') {
      // Per-searcher dedup key = a hash of the client IP (never store the raw IP; the
      // set entry is ephemeral, ~3d TTL). One vote per IP per term per day.
      const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
      const actor = createHash('sha1').update(ip).digest('hex').slice(0, 16)
      await logSearch(q, actor)
    }
  } catch {
    /* fail-open */
  }
  return new NextResponse(null, { status: 204 })
}
