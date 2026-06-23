import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { BUMP_COOLDOWN_DAYS } from '@/lib/stale'

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
    const cutoff = new Date(now.getTime() - BUMP_COOLDOWN_DAYS * 86_400_000)
    // Bump feed recency only for listings NOT bumped within the cooldown (anti-gaming);
    // the rest just record availability so the reminder stops, without re-topping.
    const [bumped, refreshed] = await Promise.all([
      db.listing.updateMany({
        where: { id: { in: confirm }, sellerId: seller.id, status: 'active', postedAt: { lt: cutoff } },
        data: { postedAt: now, availabilityConfirmedAt: now },
      }),
      db.listing.updateMany({
        where: { id: { in: confirm }, sellerId: seller.id, status: 'active', postedAt: { gte: cutoff } },
        data: { availabilityConfirmedAt: now },
      }),
    ])
    confirmed = bumped.count + refreshed.count
  }
  // Purge cached detail pages for everything touched (sold → 404, confirmed → fresh).
  for (const id of [...sold, ...confirm]) revalidatePath(`/listings/${id}`)
  return NextResponse.json({ ok: true, confirmed, markedSold })
}
