import 'server-only'
import { db } from '@/lib/db'

// Reporter identity surfaced in the admin queue: who filed it, how trustworthy they
// are (so an admin can weigh a report from a 135-trust user vs a serial false-reporter),
// and a link to their storefront if they have one.
export type Reporter = {
  id: string
  name: string
  email: string | null
  trustScore: number
  strikes: number
  sellerId: string | null
}

export type RawReport = {
  id: string
  reporterProfileId: string | null
  listingId: string | null
  conversationId: string | null
  targetSellerId: string | null
  targetProfileId: string | null
}

/**
 * For a batch of open reports, resolve (1) the reporter's identity/trust and (2) the
 * conversation to link in admin. Chat reports carry conversationId directly; for a
 * listing/seller report we DERIVE the reporter↔seller thread (if one exists) so the
 * admin can read the exchange that prompted it. Batched — a few queries for the whole page.
 */
export async function reportContext(
  reports: RawReport[],
): Promise<{ reporterById: Map<string, Reporter>; convoByReportId: Map<string, string> }> {
  const reporterIds = [...new Set(reports.map((r) => r.reporterProfileId).filter((x): x is string => !!x))]

  type ProfileRow = { id: string; displayName: string | null; email: string | null; trustScore: number; falseReportStrikes: number }
  type SellerRow = { id: string; ownerId: string | null }
  const [profiles, ownedSellers] = await Promise.all([
    reporterIds.length
      ? db.profile.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, displayName: true, email: true, trustScore: true, falseReportStrikes: true },
        })
      : Promise.resolve([] as ProfileRow[]),
    reporterIds.length
      ? db.seller.findMany({ where: { ownerId: { in: reporterIds } }, select: { id: true, ownerId: true } })
      : Promise.resolve([] as SellerRow[]),
  ])

  const sellerByOwner = new Map<string, string>(
    ownedSellers.filter((s) => s.ownerId).map((s) => [s.ownerId as string, s.id] as [string, string]),
  )
  const reporterById = new Map<string, Reporter>()
  for (const p of profiles) {
    reporterById.set(p.id, {
      id: p.id,
      name: p.displayName || p.email || 'Unknown',
      email: p.email,
      trustScore: p.trustScore,
      strikes: p.falseReportStrikes,
      sellerId: sellerByOwner.get(p.id) ?? null,
    })
  }

  // Conversation to link per report.
  const convoByReportId = new Map<string, string>()
  const needDerive: RawReport[] = []
  for (const r of reports) {
    if (r.conversationId) convoByReportId.set(r.id, r.conversationId) // chat report — linked directly
    else if (r.reporterProfileId && (r.listingId || r.targetSellerId)) needDerive.push(r)
  }

  if (needDerive.length) {
    const buyerIds = [...new Set(needDerive.map((r) => r.reporterProfileId as string))]
    const listingIds = [...new Set(needDerive.map((r) => r.listingId).filter((x): x is string => !!x))]
    const sellerIds = [...new Set(needDerive.map((r) => r.targetSellerId).filter((x): x is string => !!x))]
    const orClauses = [
      listingIds.length ? { listingId: { in: listingIds } } : null,
      sellerIds.length ? { sellerId: { in: sellerIds } } : null,
    ].filter((x): x is NonNullable<typeof x> => x !== null)

    if (orClauses.length) {
      const convos = await db.conversation.findMany({
        where: { buyerProfileId: { in: buyerIds }, OR: orClauses },
        select: { id: true, buyerProfileId: true, listingId: true, sellerId: true },
      })
      const byListing = new Map<string, string>() // `${buyer}|${listing}` → convoId (most specific)
      const bySeller = new Map<string, string>() // `${buyer}|${seller}` → convoId
      for (const c of convos) {
        byListing.set(`${c.buyerProfileId}|${c.listingId}`, c.id)
        bySeller.set(`${c.buyerProfileId}|${c.sellerId}`, c.id)
      }
      for (const r of needDerive) {
        const viaListing = r.listingId ? byListing.get(`${r.reporterProfileId}|${r.listingId}`) : undefined
        const viaSeller = r.targetSellerId ? bySeller.get(`${r.reporterProfileId}|${r.targetSellerId}`) : undefined
        const cid = viaListing || viaSeller
        if (cid) convoByReportId.set(r.id, cid)
      }
    }
  }

  return { reporterById, convoByReportId }
}

// The reported PARTY, surfaced so an admin sees who they're about to penalize (trust/tier)
// and the listing for a listing report.
export type TargetInfo = {
  kind: 'listing' | 'account' | 'chat'
  name: string
  trustScore: number | null
  trustTier: string | null
  sellerId: string | null
  profileId: string | null // messaging target (null = guest, unreachable)
  isGuest: boolean
  listing: { id: string; title: string; price: number; currency: string; image: string | null; category: string; location: string } | null
}

const firstImg = (images: string): string | null => {
  try { const a = JSON.parse(images || '[]'); return Array.isArray(a) && a[0] ? a[0] : null } catch { return null }
}

/**
 * Resolve the reported TARGET (trust/tier + listing) for each report, plus the COMMUNITY
 * count — how many open reports share the same target identity (pile-on signal). Batched.
 */
export async function targetContext(
  reports: RawReport[],
): Promise<{ targetByReportId: Map<string, TargetInfo>; communityByReportId: Map<string, number> }> {
  const listingIds = [...new Set(reports.map((r) => r.listingId).filter((x): x is string => !!x))]
  const sellerIds = [...new Set(reports.map((r) => r.targetSellerId).filter((x): x is string => !!x))]
  const profileIds = [...new Set(reports.map((r) => r.targetProfileId).filter((x): x is string => !!x))]

  type LST = { id: string; title: string; price: number; currency: string; images: string; location: string; category: { name: string }; seller: { id: string; name: string; ownerId: string | null; trustScore: number; trustTier: string } }
  type SEL = { id: string; name: string; ownerId: string | null; trustScore: number; trustTier: string }
  type PRO = { id: string; displayName: string | null; email: string | null; trustScore: number; trustTier: string }
  const [listings, sellers, profiles] = await Promise.all([
    listingIds.length
      ? db.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, price: true, currency: true, images: true, location: true, category: { select: { name: true } }, seller: { select: { id: true, name: true, ownerId: true, trustScore: true, trustTier: true } } } })
      : Promise.resolve([] as LST[]),
    sellerIds.length ? db.seller.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true, ownerId: true, trustScore: true, trustTier: true } }) : Promise.resolve([] as SEL[]),
    profileIds.length ? db.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, displayName: true, email: true, trustScore: true, trustTier: true } }) : Promise.resolve([] as PRO[]),
  ])
  const listingById = new Map((listings as LST[]).map((l) => [l.id, l]))
  const sellerById = new Map((sellers as SEL[]).map((s) => [s.id, s]))
  const profileById = new Map((profiles as PRO[]).map((p) => [p.id, p]))

  const keyOf = (r: RawReport) => r.targetProfileId || r.targetSellerId || r.listingId || r.id
  const counts = new Map<string, number>()
  for (const r of reports) { const k = keyOf(r); counts.set(k, (counts.get(k) || 0) + 1) }

  const targetByReportId = new Map<string, TargetInfo>()
  const communityByReportId = new Map<string, number>()
  for (const r of reports) {
    communityByReportId.set(r.id, counts.get(keyOf(r)) || 1)
    if (r.listingId) {
      const l = listingById.get(r.listingId)
      const s = l?.seller
      targetByReportId.set(r.id, {
        kind: 'listing', name: s?.name || 'Unknown seller', trustScore: s?.trustScore ?? null, trustTier: s?.trustTier ?? null,
        sellerId: s?.id ?? null, profileId: s?.ownerId ?? null, isGuest: !s?.ownerId,
        listing: l ? { id: l.id, title: l.title, price: l.price, currency: l.currency, image: firstImg(l.images), category: l.category.name, location: l.location } : null,
      })
    } else if (r.targetSellerId) {
      const s = sellerById.get(r.targetSellerId)
      targetByReportId.set(r.id, { kind: r.conversationId ? 'chat' : 'account', name: s?.name || 'Unknown storefront', trustScore: s?.trustScore ?? null, trustTier: s?.trustTier ?? null, sellerId: s?.id ?? r.targetSellerId, profileId: s?.ownerId ?? null, isGuest: !s?.ownerId, listing: null })
    } else if (r.targetProfileId) {
      const p = profileById.get(r.targetProfileId)
      targetByReportId.set(r.id, { kind: r.conversationId ? 'chat' : 'account', name: p?.displayName || p?.email || 'Unknown user', trustScore: p?.trustScore ?? null, trustTier: p?.trustTier ?? null, sellerId: null, profileId: r.targetProfileId, isGuest: false, listing: null })
    } else {
      targetByReportId.set(r.id, { kind: 'account', name: 'Unknown', trustScore: null, trustTier: null, sellerId: null, profileId: null, isGuest: true, listing: null })
    }
  }
  return { targetByReportId, communityByReportId }
}
