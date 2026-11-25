import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { dashboardAds } from '@/lib/ads/dashboard'
import { shopBankOrders, type ShopOrder } from '@/lib/ads/bank'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ads/mine — the signed-in person's shop's ads with their live figures, for /dashboard/ads (polled every 10 s), and
 * its bank-transfer orders still awaiting their transfer (src/lib/ads/bank.ts — orders, not ads: no figures).
 * No shop, or before the ads tables exist: no ads. Never cached.
 */
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  let ads: Awaited<ReturnType<typeof dashboardAds>> = []
  let orders: ShopOrder[] = []
  if (seller) {
    try {
      ;[ads, orders] = await Promise.all([dashboardAds(seller.id), shopBankOrders(seller.id)])
    } catch (e) {
      if (!(e instanceof Error && /42P01|42703|"(ListingAd|AdCreative|AdStat)" does not exist|column "creativeId" does not exist/.test(e.message))) throw e
      logError(e, { op: 'ads.mine.before-ddl' })
    }
  }
  return NextResponse.json({ ads, orders, updated_at: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } })
})
