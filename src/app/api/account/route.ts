import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { serializeListing } from '@/lib/serialize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in user's account view: profile + storefront + their own listings.
// The /account page caches this in localStorage and paints from it instantly, so
// a business checking their offerings feels no lag; this just revalidates.
//
// ⚠️ WS6 — NOT MIGRATED: A GUEST GETS 200 `{"account":null}`, NOT A 401. `auth: 'profile'` answers
// every unauthenticated caller with 401 `{"error":"auth_required"}`, which is a different status AND
// a different body on the single branch most likely to be hit (the page fetches this before it knows
// whether anyone is signed in, and paints the signed-out state from `account === null`). Hand-rolling
// the guest branch under `auth: 'public'` would leave all four wrapper options empty — no rate limit,
// no body — so the wrapper would buy nothing and cost a layer of indirection.
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
