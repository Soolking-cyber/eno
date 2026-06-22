import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { serializeListing } from '@/lib/serialize'
import { isStale } from '@/lib/stale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The seller CRM dashboard payload (owner-scoped). Answers the three questions a
// seller opens the dashboard for: new messages? how are my listings doing? what
// needs action? Tiered — `tier` tells the client whether to show the business-only
// analytics + business-profile + bulk sections.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ dashboard: null }, { status: 401 })

  const seller = await db.seller.findUnique({
    where: { ownerId: profile.id },
    include: { listings: { orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } } },
  })

  // Unread messages where this user is the seller side of the conversation.
  const sellerUnreadAgg = await db.conversation.aggregate({
    where: { sellerProfileId: profile.id },
    _sum: { sellerUnread: true },
  })
  const unreadMessages = sellerUnreadAgg._sum.sellerUnread ?? 0

  const listings = seller ? seller.listings.map(serializeListing) : []

  // Stats over the seller's own listings.
  const active = listings.filter((l) => l.status === 'active')
  const stale = active.filter((l) => isStale(l.availabilityConfirmedAt, l.postedAt))
  const stats = {
    totalViews: listings.reduce((n, l) => n + l.views, 0),
    totalLeads: listings.reduce((n, l) => n + l.contactCount, 0),
    activeCount: active.length,
    soldCount: listings.filter((l) => l.status === 'sold').length,
    hiddenCount: listings.filter((l) => l.status === 'hidden').length,
    heldCount: listings.filter((l) => !l.verified && l.status === 'active').length, // failed auto-publish on a live listing
    staleCount: stale.length,
    unreadMessages,
  }

  return NextResponse.json({
    dashboard: {
      tier: profile.accountType === 'business' ? 'business' : 'individual',
      profile: {
        displayName: profile.displayName,
        email: profile.email,
        phone: profile.phone,
        avatarUrl: profile.avatarUrl,
        avatarColor: profile.avatarColor,
        businessName: profile.businessName,
        trustScore: profile.trustScore,
        trustTier: profile.trustTier,
      },
      seller: seller
        ? {
            id: seller.id,
            name: seller.name,
            verifiedSeller: seller.verifiedSeller,
            trustScore: seller.trustScore,
            trustTier: seller.trustTier,
            responseRate: seller.responseRate,
            bio: seller.bio,
            location: seller.location,
            phone: seller.phone,
            avatarUrl: seller.avatarUrl,
          }
        : null,
      stats,
      listings,
    },
  })
}
