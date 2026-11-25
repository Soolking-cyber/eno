import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { getBankOrder } from '@/lib/ads/bank'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ads/orders/[id] — one of the signed-in shop's bank-transfer orders (src/lib/ads/bank.ts): its status and, while
 * it awaits the transfer, its VietQR and the details to pay it (re-opened from the page's list). Another shop's order, or
 * no bank order, is 404. Never cached.
 */
export const GET = route({ auth: 'userId' }, async ({ userId, params }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  const order = seller ? await getBankOrder(params.id ?? '', seller.id) : null
  if (!order) throw new ApiError('not_found', 404)
  return NextResponse.json({ order }, { headers: { 'Cache-Control': 'private, no-store' } })
})
