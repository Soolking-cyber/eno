import { scopedListingWhere } from '@/lib/edition-scope'
import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { updateListingCore, deleteListingCore } from '@/lib/core/listings'
import { serializeListing } from '@/lib/serialize'
import { getPriceBand } from '@/lib/price-stat'
import { topSellerReviews, sameSellerListings } from '@/lib/seller-metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — public detail payload for the native iOS app (the web PDP is SSR and
// never calls this). Visibility contract matches the page exactly: only
// verified + active listings exist here — sold/hidden/held/missing all 404.
// serializeListing keeps seller.phone null; contact reveal stays auth-gated.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // findFirst, not findUnique — see the PDP. The existing null/verified/status check below already
  // turns an excluded row into the same 404 a missing one gets, so nothing downstream changes.
  const listing = await db.listing.findFirst({
    where: await scopedListingWhere({ id }),
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })
  if (!listing || !listing.verified || listing.status !== 'active') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // Parallelize the three PDP-parity reads (all cache()-wrapped / cheap):
  //  - the market-price gauge (fail-safe null below the sample floor),
  //  - the top seller reviews (#31: avg + verified-first snippets), and
  //  - the same-seller shelf (#92: other active listings, newest first).
  // Native decoders ignore unknown keys, so these are additive/back-compatible.
  const [priceBand, reviews, moreFromSeller] = await Promise.all([
    getPriceBand({
      brandSlug: listing.brandSlug,
      model: listing.model,
      condition: listing.condition,
      year: listing.year,
    }),
    topSellerReviews(listing.sellerId, 2, { total: listing.seller.reviewCount, avg: listing.seller.rating }),
    sameSellerListings(listing.sellerId, listing.id, 10),
  ])
  const res = NextResponse.json({ listing: serializeListing(listing), priceBand, reviews, sameSellerListings: moreFromSeller })
  res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  return res
}

// PATCH — a seller edits their OWN listing (title/description/price/district/
// condition/images…). Category isn't editable here. auth → core → respond; the edit
// logic (validation, searchText rebuild, republish gate, reindex) lives in the shared
// core so the future /api/v1 PATCH reuses it verbatim.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  // Contact-phone parity with CREATE (audit P2): the edit wizard's "Đổi số" sends
  // contactPhone on PATCH, but nothing applied it — the seller saw success while
  // buyers kept reaching the OLD number. Same rules as the create route: normalize,
  // refuse a number another account owns, then update the storefront.
  if (body.contactPhone !== undefined) {
    const contactPhone = normalizePhone(String(body.contactPhone || ''))
    if (contactPhone.replace(/\D/g, '').length >= 9) {
      const current = await db.seller.findUnique({ where: { id: auth.sellerId }, select: { phone: true } })
      if (current && contactPhone !== current.phone) {
        if (await phoneTakenByOther(contactPhone, auth.profileId)) {
          return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
        }
        await db.seller.update({ where: { id: auth.sellerId }, data: { phone: contactPhone } })
      }
    }
  }

  const r = await updateListingCore(id, body)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
  return NextResponse.json({ ok: true })
}

// DELETE — a seller removes their OWN listing (cascades reports/conversations).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })
  await deleteListingCore(id)
  return NextResponse.json({ ok: true })
}
