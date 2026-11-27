import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { markPayerPaid } from '@/lib/ads/bank'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/ads/orders/[id]/paid — "I've paid": the shop says its transfer for this order is sent (src/lib/ads/bank.ts
 * markPayerPaid). eno's admins are told at once; the ad still starts only on an admin's Mark paid. Another shop's order
 * is 404; one paid, cancelled, lapsed or closed is 409 `order_closed`. A second press answers the same order again.
 */
export const POST = route({ auth: 'userId' }, async ({ userId, params }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  if (!seller) throw new ApiError('not_found', 404)
  const out = await markPayerPaid(params.id ?? '', seller.id)
  if (!out.ok) {
    if (out.code === 'order_closed') throw new ApiError('order_closed', 409)
    if (out.code === 'busy') throw new ApiError('busy', 503)
    throw new ApiError('not_found', 404)
  }
  return NextResponse.json({ order: out.order }, { headers: { 'Cache-Control': 'private, no-store' } })
})
