import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 14
const MAX_LISTINGS = 60
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// Per-listing 14-day daily series for the SELLER'S OWN dashboard sparklines —
// the same ListingDailyStat the partner API reads (src/lib/listing-analytics.ts),
// owner-scoped instead of API-key-scoped. The cron snapshots CUMULATIVE
// views/leads once a day, so consecutive snapshots are diffed into per-day
// deltas here (a first snapshot with no prior baseline reports 0 — the daily
// delta is unknown there). Sparse by design: the client fills missing days
// with zeros across a fixed window.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ series: null }, { status: 401 })

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  const headers = { 'Cache-Control': 'private, max-age=300' }
  if (!seller) return NextResponse.json({ series: {} }, { headers })

  // Own live + sold listings only (hidden ones show no stats row anyway), capped
  // so a bulk-upload storefront can't turn this into an unbounded IN () query.
  const listings = await db.listing.findMany({
    where: { sellerId: seller.id, status: { in: ['active', 'sold'] } },
    orderBy: { postedAt: 'desc' },
    take: MAX_LISTINGS,
    select: { id: true },
  })
  if (listings.length === 0) return NextResponse.json({ series: {} }, { headers })
  const ids = listings.map((l) => l.id)

  // One extra day before the window seeds the first in-window delta.
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const baseline = new Date(today.getTime() - WINDOW_DAYS * DAY_MS)
  const stats = await db.listingDailyStat.findMany({
    where: { listingId: { in: ids }, day: { gte: baseline } },
    orderBy: [{ listingId: 'asc' }, { day: 'asc' }],
    select: { listingId: true, day: true, views: true, leads: true },
  })

  const windowStart = baseline.getTime() + DAY_MS
  const series: Record<string, { day: string; views: number; leads: number }[]> = {}
  let prev: { listingId: string; views: number; leads: number } | null = null
  for (const s of stats) {
    const p = prev && prev.listingId === s.listingId ? prev : null
    prev = s
    if (s.day.getTime() < windowStart) continue // baseline row only
    ;(series[s.listingId] ??= []).push({
      day: isoDay(s.day),
      views: p ? Math.max(0, s.views - p.views) : 0,
      leads: p ? Math.max(0, s.leads - p.leads) : 0,
    })
  }

  return NextResponse.json({ series }, { headers })
}
