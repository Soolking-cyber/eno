import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { paySummary } from '@/lib/ucp/checkout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ads/ucp/[id] — what /dashboard/ads/pay/[id] shows the signed-in shop for a UCP checkout an AI agent started
 * (src/lib/ucp/checkout.ts paySummary): the ad, its period and price, and the order once this shop made it. Unknown → 404.
 */
export const GET = route({ auth: 'userId' }, async ({ userId, params }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  const summary = await paySummary(params.id ?? '', seller?.id ?? null)
  if (!summary) throw new ApiError('not_found', 404)
  return NextResponse.json({ checkout: summary }, { headers: { 'Cache-Control': 'private, no-store' } })
})
