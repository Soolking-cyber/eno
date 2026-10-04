import 'server-only'
import { db } from '@/lib/db'
import { taxVerdict } from '@/lib/tax-lookup'
import { serializeListing } from '@/lib/serialize'
import { isStale } from '@/lib/stale'
import type { Profile } from '@/generated/prisma/client'
import { NOT_REMOVED } from '@/lib/listing-removed'
import { conversationUnread } from '@/lib/unread'

// Dashboard payload core (Phase 0). Owner-scoped CRM stats for an ALREADY-RESOLVED
// profile, decoupled from auth — reused by the session GET /api/dashboard and the future
// /api/v1/analytics/summary (which surfaces the `stats` subset). The caller authorizes.
// `includeSupportDesk` is the caller's admin verdict (see the unread tile below) — passed in, never read
// from the session here, so this stays usable by a caller that authenticated some other way.
export async function dashboardStatsCore(profile: Profile, { includeSupportDesk = false }: { includeSupportDesk?: boolean } = {}) {
  const seller = await db.seller.findUnique({
    where: { ownerId: profile.id },
    include: {
      // ⛔ NOT tombstones (src/lib/listing-removed.ts): a removed listing is gone from the seller's view.
      listings: { where: NOT_REMOVED, orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } },
      handle: { select: { handle: true } }, // clean eno.vn/<name> storefront link
    },
  })

  /**
   * ⛔ THE SAME NUMBER AS THE MESSAGES BADGE, FROM THE SAME FUNCTION (inbox-11). This tile used its own
   * aggregate — seller side only, every conversation row, no edition scope, no deleted-thread filter — so
   * the "Unread messages" tile and the header badge disagreed: a buyer-side unread was missing from the
   * tile, and a thread the inbox hides (deleted, or a desk thread the edition must not show) was in it.
   * `conversationUnread` is the one definition (src/lib/unread.ts says why there must be only one), called
   * with exactly the options /api/notifications passes, so tile, badge and inbox count the same rows.
   * ⚠️ `includeSupportDesk` comes from the caller: the session route passes the same cheap claims read
   * that poll makes (isCurrentUserAdminByClaims).
   */
  const unreadMessages = await conversationUnread(profile.id, { includeSupportDesk })

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
    // Buyer saves ACROSS the owner's listings — the seller-side metric (device-local
    // favorites are a buyer count and can't cross origins/devices).
    saves: listings.reduce((n, l) => n + (l.savedCount ?? 0), 0),
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
          // Drives the Settings → Security section: password sign-in is a PARTNER-ONLY
          // feature (owner, 2026-08-10), so a non-partner must not be offered a password
          // they could set and then never use — api/auth/password refuses them.
          officialPartner: seller.officialPartner,
          trustScore: seller.trustScore,
          trustTier: seller.trustTier,
          responseRate: seller.responseRate,
          bio: seller.bio,
          location: seller.location,
          phone: seller.phone,
          avatarUrl: seller.avatarUrl,
          // The storefront cover the shop sets for itself. Owner-scoped like the rest of this
          // payload; the PUBLIC copy is selected separately in storefront.ts.
          bannerUrl: seller.bannerUrl,
          // Legal identity (owner-scoped payload only — never in public serializers)
          legalName: seller.legalName,
          legalAddress: seller.legalAddress,
          idNumber: seller.idNumber,
          taxCode: seller.taxCode,
          // VietQR/GDT soft-check outcome — DERIVED at read time (tax-lookup.ts), so a
          // later legalName edit re-verdicts instantly. Facts, never a gate; the editor
          // renders it beside the tax-code field.
          taxVerdict: taxVerdict(seller),
          taxRegisteredName: seller.taxRegisteredName,
        }
      : null,
    stats,
    listings,
  }
}
