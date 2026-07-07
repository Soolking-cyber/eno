import 'server-only'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { isStale } from '@/lib/stale'
import type { Profile } from '@/generated/prisma/client'

// Dashboard payload core (Phase 0). Owner-scoped CRM stats for an ALREADY-RESOLVED
// profile, decoupled from auth — reused by the session GET /api/dashboard and the future
// /api/v1/analytics/summary (which surfaces the `stats` subset). The caller authorizes.
export async function dashboardStatsCore(profile: Profile) {
  const seller = await db.seller.findUnique({
    where: { ownerId: profile.id },
    include: {
      listings: { orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } },
      handle: { select: { handle: true } }, // clean eno.vn/<name> storefront link
    },
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

  return {
    tier: profile.accountType === 'business' ? ('business' as const) : ('individual' as const),
    profile: {
      displayName: profile.displayName,
      email: profile.email,
      phone: profile.phone,
      avatarUrl: profile.avatarUrl,
      avatarColor: profile.avatarColor,
      businessName: profile.businessName,
      trustScore: profile.trustScore,
      trustTier: profile.trustTier,
      availabilitySkips: profile.availabilitySkips,
    },
    seller: seller
      ? {
          id: seller.id,
          name: seller.name,
          handle: seller.handle?.handle ?? null,
          verifiedSeller: seller.verifiedSeller,
          trustScore: seller.trustScore,
          trustTier: seller.trustTier,
          responseRate: seller.responseRate,
          bio: seller.bio,
          location: seller.location,
          phone: seller.phone,
          avatarUrl: seller.avatarUrl,
          // Legal identity (owner-scoped payload only — never in public serializers)
          legalName: seller.legalName,
          legalAddress: seller.legalAddress,
          idNumber: seller.idNumber,
          taxCode: seller.taxCode,
        }
      : null,
    stats,
    listings,
  }
}
