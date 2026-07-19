import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best-effort, deduped listing-view counter. Fired once per device per ~6h from
// <TrackView> (a client localStorage guard is the primary dedup); the server adds a
// per-(IP, listing) sliding-window dedup as a backstop for cleared storage, plus a
// coarse per-IP cap so one client can't inflate many listings. Seller self-views are
// excluded. Never blocks the page — always returns ok, `counted` says whether it bumped.
//
// NOTE: dedup rides on the rate limiter (Postgres-backed). On a limiter backend error
// it fails OPEN, so the client localStorage guard is what keeps refreshes from
// over-counting there.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ip = clientIp(req)

  // Shared limiter NAMES with the id in the KEY — one limiter per listing id would leak
  // a limiter instance per listing into the in-memory map.
  const [byPair, byIp] = await Promise.all([
    rateLimit('listing-view', `${ip}:${id}`, 1, '6 h'), // 1 count / (ip,listing) / 6h
    rateLimit('listing-view-ip', ip, 200, '1 h'),        // coarse anti-inflation per IP
  ])
  if (!byPair.success || !byIp.success) return NextResponse.json({ ok: true, counted: false })

  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, verified: true, status: true, seller: { select: { ownerId: true } } },
  })
  // Only count views on live (public) listings — never pending/hidden/sold.
  if (!listing || !listing.verified || listing.status !== 'active') {
    return NextResponse.json({ ok: true, counted: false })
  }

  // Don't let a seller inflate their own listing's view count.
  const profileId = await getCurrentProfileId()
  if (profileId && listing.seller.ownerId === profileId) {
    return NextResponse.json({ ok: true, counted: false })
  }

  await db.listing.update({ where: { id }, data: { views: { increment: 1 } } })
  return NextResponse.json({ ok: true, counted: true })
}
