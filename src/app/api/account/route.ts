import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { serializeListing } from '@/lib/serialize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in user's account view: profile + storefront + their own listings.
// The /account page caches this in localStorage and paints from it instantly, so
// a business checking their offerings feels no lag; this just revalidates.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ account: null })

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id } })
  const listings = seller
    ? await db.listing.findMany({
        where: { sellerId: seller.id },
        orderBy: { postedAt: 'desc' },
        include: { category: true },
      })
    : []

  return NextResponse.json({
    account: {
      profile: {
        displayName: profile.displayName,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        avatarColor: profile.avatarColor,
      },
      seller: seller ? { id: seller.id, verifiedSeller: seller.verifiedSeller } : null,
      listings: seller ? listings.map((l) => serializeListing({ ...l, seller })) : [],
    },
  })
}
