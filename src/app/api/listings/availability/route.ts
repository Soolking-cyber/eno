import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { BUMP_COOLDOWN_DAYS } from '@/lib/stale'
import { removeFromIndex } from '@/lib/listing-index'
import { recomputeRankScoreForListings } from '@/lib/ranking'
import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'

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

  // Modest per-profile cap: this is a once-a-day review flow, and each request can drive
  // up to 500 ISR revalidations — don't let a script hammer it.
  const { success } = await rateLimit('availability-review', profile.id, 30, '1 h')
  if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { confirm?: string[]; sold?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const confirm = Array.isArray(body.confirm) ? body.confirm.filter((x) => typeof x === 'string').slice(0, 500) : []
  const soldRequested = Array.isArray(body.sold) ? body.sold.filter((x) => typeof x === 'string').slice(0, 500) : []

  // Ownership-scope the sold set up front: the revalidatePath/removeFromIndex loops below
  // must never run over raw client ids the caller doesn't own (cache-purge amplification).
  const sold = soldRequested.length
    ? (await db.listing.findMany({ where: { id: { in: soldRequested }, sellerId: seller.id }, select: { id: true } })).map((l) => l.id)
    : []

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
    // The bump reset postedAt — recompute the blended rankScore (the feed's ORDER BY key)
    // so confirmed listings actually rise NOW, not at the next daily cron. Scoped to this
    // seller's own active listings; bumped rows are at recency≈1, the rest re-decay to now.
    if (confirmed) await recomputeRankScoreForListings(confirm, seller.id)
  }
  // Only SOLD listings must purge their cached page (it 404s non-active). A plain
  // availability confirm just bumps feed recency — surfaced live via the client
  // /api/listings fetch — so revalidating its detail page every day per listing is
  // pure ISR-write waste (the dominant write driver). Let it ride its time window.
  for (const id of sold) revalidatePath(`/listings/${id}`)
  after(() => { for (const id of sold) removeFromIndex(id) }) // pull sold items from AI search
  // The seller engaged with the review → reset the consecutive-skip counter.
  if (profile.availabilitySkips > 0) after(() => db.profile.update({ where: { id: profile.id }, data: { availabilitySkips: 0 } }).catch((e) => logError(e, { op: 'availability.resetSkips' })))
  return NextResponse.json({ ok: true, confirmed, markedSold })
}
