import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { adEligibleListings, bankConfig } from '@/lib/ads/bank'
import { creativeAdsAllowed } from '@/lib/ads/creative-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ads/options — what /dashboard/ads' "Create an ad" form may offer the signed-in person (src/lib/ads/bank.ts):
 *   bank       whether bank transfer is on sale here (the account is configured — never the account itself);
 *   creative   whether "My own ad" is offered: while creative ads are in their private test, an admin's only
 *              (creative-gate.ts — the same gate the API and the order route apply);
 *   listings   the shop's listings an ad may run on (bank.ts adEligibleListings: book.ts's own eligibility).
 * Never cached.
 */
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  const bank = bankConfig() !== null
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!seller) return NextResponse.json({ bank, shop: false, creative: false, listings: [] }, { headers })
  const [creative, listings] = await Promise.all([creativeAdsAllowed(userId), bank ? adEligibleListings(seller.id) : Promise.resolve([])])
  return NextResponse.json({ bank, shop: true, creative, listings }, { headers })
})
