import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const REASONS = ['scam', 'sold', 'wrong-info', 'duplicate', 'offensive', 'other'] as const
type Reason = (typeof REASONS)[number]

// Anonymous report — anyone can flag a listing. Reports are hidden from the
// public and surface only in the /admin moderation queue. We cap volume per
// listing so a single actor can't flood the queue.
const MAX_OPEN_PER_LISTING = 50

export async function POST(req: NextRequest) {
  let body: { listingId?: string; reason?: string; detail?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const listingId = String(body.listingId || '').trim()
  const reason = String(body.reason || '').trim() as Reason
  const detail = body.detail ? String(body.detail).trim().slice(0, 1000) : null

  if (!listingId) return NextResponse.json({ error: 'Missing listingId' }, { status: 400 })
  if (!REASONS.includes(reason)) return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })

  const listing = await db.listing.findUnique({ where: { id: listingId }, select: { id: true } })
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  const openCount = await db.report.count({ where: { listingId, status: 'open' } })
  if (openCount >= MAX_OPEN_PER_LISTING) {
    // Silently accept — don't reveal the cap, and the listing is already flagged.
    return NextResponse.json({ ok: true })
  }

  await db.report.create({ data: { listingId, reason, detail } })
  return NextResponse.json({ ok: true }, { status: 201 })
}
