import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { reviewCreative } from '@/lib/ads/creative-review'
import { creativeAdsAllowed } from '@/lib/ads/creative-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/ads/review — /dashboard/ads' free "Review" of the shop's own ad, BEFORE any order (owner 2026-11-25: reviewed
 * by Jev before payment). The same review the API runs (src/lib/ads/creative-review.ts reviewCreative, failing closed,
 * with its own daily budget per shop); the answer is its view — approved with the creative's id, or the reasons in English
 * and Vietnamese, never a bare code. While creative ads are in their private test (creative-gate.ts) an admin's only,
 * refused BEFORE any review runs (no model call).
 */
export const POST = route(
  {
    auth: 'userId',
    rateLimit: { bucket: 'ad-review-form', limit: 30, window: '1 h' },
    body: z.object({ creative: z.record(z.string(), z.unknown()) }),
  },
  async ({ userId, body }) => {
    // edition-lint-allow: the signed-in person's own storefront (`ownerId: userId` after the 401), its id only; nothing public.
    const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
    if (!seller) throw new ApiError('no_shop', 403)
    if (!(await creativeAdsAllowed(userId))) throw new ApiError('creative_ads_not_open', 403)
    const out = await reviewCreative(seller.id, body.creative)
    return NextResponse.json({ review: out.view }, { headers: { 'Cache-Control': 'private, no-store' } })
  },
)
