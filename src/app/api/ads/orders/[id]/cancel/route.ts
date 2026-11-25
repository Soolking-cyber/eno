import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { cancelBankOrder } from '@/lib/ads/bank'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/ads/orders/[id]/cancel — the shop cancels its own bank-transfer order, only while it awaits the transfer
 * (src/lib/ads/bank.ts cancelBankOrder). Another shop's order is 404; one already paid, cancelled or closed is 409
 * `order_closed`.
 */
export const POST = route({ auth: 'userId' }, async ({ userId, params }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  if (!seller) throw new ApiError('not_found', 404)
  const out = await cancelBankOrder(params.id ?? '', seller.id)
  if (!out.ok) {
    if (out.code === 'order_closed') throw new ApiError('order_closed', 409)
    throw new ApiError('not_found', 404)
  }
  return NextResponse.json({ order: out.order }, { headers: { 'Cache-Control': 'private, no-store' } })
})
