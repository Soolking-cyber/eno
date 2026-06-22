import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { severityForReason } from '@/lib/trust'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REASONS = ['scam', 'counterfeit', 'sold', 'wrong-info', 'duplicate', 'offensive', 'other'] as const
type Reason = (typeof REASONS)[number]

// A report can target a listing and/or a storefront. Reports surface only in the
// /admin queue; an admin-confirmed report moves the target's trust score.
const MAX_OPEN_PER_LISTING = 50

export async function POST(req: NextRequest) {
  // Reporting requires an account so reports are ATTRIBUTABLE — that's what makes
  // the anti-abuse rules possible (trust-weighting, false-report penalty, cooldown).
  const reporter = await getCurrentProfile()
  if (!reporter) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  // Anti-abuse: a reporter with confirmed-false reports is temporarily blocked.
  if (reporter.reportCooldownUntil && reporter.reportCooldownUntil > new Date()) {
    return NextResponse.json({ error: 'report_cooldown' }, { status: 429 })
  }
  const rl = await rateLimit('report', reporter.id, 10, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { listingId?: string; sellerId?: string; reason?: string; detail?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const reason = String(body.reason || '').trim() as Reason
  const detail = body.detail ? String(body.detail).trim().slice(0, 1000) : null
  if (!REASONS.includes(reason)) return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })

  const listingId = body.listingId ? String(body.listingId).trim() : null
  let sellerId = body.sellerId ? String(body.sellerId).trim() : null
  let targetProfileId: string | null = null

  if (listingId) {
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, seller: { select: { ownerId: true } } },
    })
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    // Always derive the storefront from the listing — never trust a client-supplied
    // sellerId here, or a report about listing X could be attributed to seller Y.
    sellerId = listing.sellerId
    targetProfileId = listing.seller?.ownerId ?? null
    const openCount = await db.report.count({ where: { listingId, status: 'open' } })
    // Already heavily flagged — silently accept (don't reveal the cap).
    if (openCount >= MAX_OPEN_PER_LISTING) return NextResponse.json({ ok: true })
  } else if (sellerId) {
    const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { id: true, ownerId: true } })
    if (!seller) return NextResponse.json({ error: 'Seller not found' }, { status: 404 })
    targetProfileId = seller.ownerId ?? null
  } else {
    return NextResponse.json({ error: 'Missing target' }, { status: 400 })
  }

  // Can't report yourself.
  if (targetProfileId && targetProfileId === reporter.id) {
    return NextResponse.json({ error: 'cannot_report_self' }, { status: 400 })
  }

  // One open report per reporter per TARGET IDENTITY — keyed on the resolved
  // account/storefront, not the surface, so a reporter can't stack a listing
  // report + a storefront report against the same seller. Falls back to the
  // listing when the seller can't be resolved.
  const dupeTarget = targetProfileId
    ? { targetProfileId }
    : sellerId
      ? { targetSellerId: sellerId }
      : { listingId }
  const dupe = await db.report.findFirst({
    where: { reporterProfileId: reporter.id, status: 'open', ...dupeTarget },
    select: { id: true },
  })
  if (dupe) return NextResponse.json({ ok: true })

  await db.report.create({
    data: {
      listingId,
      reporterProfileId: reporter.id,
      targetProfileId,
      targetSellerId: sellerId,
      reason,
      detail,
      severity: severityForReason(reason),
      status: 'open',
    },
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
