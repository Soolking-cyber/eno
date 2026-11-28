import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { payCheckout } from '@/lib/ucp/checkout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/ads/ucp/[id]/order — the signed-in shop pays a UCP checkout: ONE bank order per checkout (claimed first, then
 * made by src/lib/ads/bank.ts createBankOrder: the listing must be this shop's own and live). Answers the order with its
 * VietQR, or `{ error }`: not_found 404; canceled / taken / busy / changed (the line moved since the page read it) /
 * order_unavailable 409; and createBankOrder's own refusals. The body is the line the page showed: { listingId, period }.
 */
export const POST = route({ auth: 'userId', body: z.object({ listingId: z.string().max(64), period: z.enum(['week', 'month', 'quarter']) }) }, async ({ userId, params, body }) => {
  // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  const out = await payCheckout(params.id ?? '', { sellerId: seller?.id ?? null, profileId: userId }, body)
  const headers = { 'Cache-Control': 'private, no-store' }
  if (out.ok) return NextResponse.json({ order: out.order }, { status: 201, headers })
  return NextResponse.json({ error: out.code, ...(out.reason ? { reason: out.reason } : {}) }, { status: out.status, headers })
})
