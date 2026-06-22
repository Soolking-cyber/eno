import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Daily availability review (batch). Owner-scoped: bump the listings the seller
// confirms are still available (→ back to the top of the feed) and mark the rest
// sold — all in two updateMany calls, scoped to the caller's own storefront.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  let body: { confirm?: string[]; sold?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const confirm = Array.isArray(body.confirm) ? body.confirm.filter((x) => typeof x === 'string').slice(0, 500) : []
  const sold = Array.isArray(body.sold) ? body.sold.filter((x) => typeof x === 'string').slice(0, 500) : []

  const now = new Date()
  let confirmed = 0
  let markedSold = 0
  if (sold.length) {
    const r = await db.listing.updateMany({ where: { id: { in: sold }, sellerId: seller.id }, data: { status: 'sold' } })
    markedSold = r.count
  }
  if (confirm.length) {
    // Bump = reuse postedAt (the feed sort key) + record the confirmation.
    const r = await db.listing.updateMany({
      where: { id: { in: confirm }, sellerId: seller.id, status: 'active' },
      data: { postedAt: now, availabilityConfirmedAt: now },
    })
    confirmed = r.count
  }
  return NextResponse.json({ ok: true, confirmed, markedSold })
}
