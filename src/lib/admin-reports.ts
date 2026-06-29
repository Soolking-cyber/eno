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
