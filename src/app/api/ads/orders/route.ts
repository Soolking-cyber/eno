import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { createBankOrder } from '@/lib/ads/bank'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/ads/orders — a bank-transfer ad order from /dashboard/ads (src/lib/ads/bank.ts createBankOrder): the kind
 * ("listing" with a listingId, or "creative" with an approved creativeId), the period (week | month | quarter). It checks
 * the account is configured, the shop, the target (its own, eligible — or approved by a review that counts here, behind
 * the creative ads' private test), and the shop's hourly budget, then answers the order with its VietQR and the details
 * to pay it. Nothing is charged: the ad starts when an admin confirms the transfer.
 * Refusals: `{ error }` with the house codes — bank_unavailable 503, no_shop 403, creative_ads_not_open 403,
 * target_refused (+ `reason`, book.ts's own code) 4xx, rate_limited 429, bad_request 400. The form words each one.
 */
export const POST = route(
  {
    auth: 'userId',
    body: z.object({
      kind: z.enum(['listing', 'creative']),
      listingId: z.string().max(64).optional(),
      creativeId: z.string().max(64).optional(),
      period: z.enum(['week', 'month', 'quarter']),
    }),
  },
  async ({ userId, body }) => {
    // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
    const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
    const out = await createBankOrder({ sellerId: seller?.id ?? null, profileId: userId, kind: body.kind, listingId: body.listingId, creativeId: body.creativeId, period: body.period })
    const headers = { 'Cache-Control': 'private, no-store' }
    if (out.ok) return NextResponse.json({ order: out.order }, { status: 201, headers })
    switch (out.code) {
      case 'bank_unavailable': return NextResponse.json({ error: 'bank_unavailable' }, { status: 503, headers })
      case 'no_shop': return NextResponse.json({ error: 'no_shop' }, { status: 403, headers })
      case 'creative_ads_not_open': return NextResponse.json({ error: 'creative_ads_not_open' }, { status: 403, headers })
      case 'target_refused': return NextResponse.json({ error: 'target_refused', reason: out.reason }, { status: out.status, headers })
      case 'rate_limited': return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers })
      default: return NextResponse.json({ error: 'bad_request' }, { status: 400, headers })
    }
  },
)
