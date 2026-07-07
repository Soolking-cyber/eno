import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import type { SerializedListingCard } from '@/lib/types'

// ── Seller display metrics (SellerCard / storefront / PDP) ───────────────────────
//
// The ONLY honest-by-construction decomposition of a Seller row into buyer-facing
// signals. Two rules are load-bearing and MUST NOT be softened:
//
//   1. The raw responseRate number NEVER leaves the server. Seller.responseRate
//      defaults to 100 (a lie for a seller with no history), so exposing "100%"
//      would fabricate trust. We only ever emit a coarse bucket label.
//   2. The response bucket is SUPPRESSED (key: null) below RESPONSE_MIN_CONVOS
//      buyer-initiated conversations in the trust window — the same >=5 bar the
//      trust engine effectively uses (wilsonLowerBound(_, n<5) contributes ~0).
//      A fresh seller shows nothing, never a placeholder.
//
// convoCount is the 90d Conversation count the caller already has (it's computed by
// the trust engine as `conversations90`, or via one indexed
// db.conversation.count({ sellerId, createdAt: gte 90d })). By construction every
// Conversation is buyer-opened, so this IS the buyer-initiated count.

/** Minimum 90d buyer conversations before any responsiveness label is shown. */
export const RESPONSE_MIN_CONVOS = 5
/** responseRate at/above this reads as "responds quickly". */
const RESPONSE_FAST_RATE = 80
// HONESTY GATE. Seller.responseRate / responseTime are NOT yet computed from real
// conversation-reply data anywhere in the app — responseRate is only ever written as
// the =100 default and responseTime stays "within an hour". Bucketing off those would
// fabricate a "responds quickly" claim for EVERY seller (the exact raw-100 leak the
// module header forbids). So until a job measures real first-reply latency, we suppress
// the responsiveness label entirely (asymmetric honesty: show nothing, never a fake).
// Flip to true — and keep it typed `boolean` so the bucket logic stays reachable — the
// moment those columns are backed by real data. The >=5-convo gate proves activity, not
// responsiveness, so it can't stand in for a real signal.
const RESPONSE_METRIC_IS_REAL: boolean = false

export type ResponseBucket = {
  key: 'fast' | 'day' | null
  en: string
  vi: string
}

/** Seller fields the responsiveness bucket reads — raw values stay server-side. */
type ResponseSellerInput = {
  responseRate: number | null
  responseTime: string | null
}

/**
 * Coarse, honest responsiveness label. Returns key:null (render NOTHING) when there
 * is no real track record. Never exposes the raw responseRate number.
 */
export function responseBucket(seller: ResponseSellerInput, convoCount: number): ResponseBucket {
  const SUPPRESS: ResponseBucket = { key: null, en: '', vi: '' }
  // Until responseRate/responseTime are real (see RESPONSE_METRIC_IS_REAL), any label
  // would launder the =100 default — so show nothing.
  if (!RESPONSE_METRIC_IS_REAL) return SUPPRESS
  // No track record → suppress entirely (a fresh seller must not show a fake "100%").
  if (convoCount < RESPONSE_MIN_CONVOS) return SUPPRESS

  const rate = seller.responseRate ?? 0
  const time = (seller.responseTime ?? '').toLowerCase()
  // "<1h" signalled either by a high replied-within-24h rate OR a sub-hour typical time.
  const subHour = time.includes('hour') || time.includes('minute') || time.includes('min')
  if (rate >= RESPONSE_FAST_RATE || subHour) {
    return { key: 'fast', en: 'Responds quickly', vi: 'Phản hồi nhanh' }
  }
  return { key: 'day', en: 'Responds within a day', vi: 'Phản hồi trong ngày' }
}

/** Client-safe metrics bundle for SellerCard / storefront / PDP seller block. */
export type SellerMetrics = {
  responseBucket: ResponseBucket
  memberSinceYear: number
  reviewCount: number
  rating: number
  trustScore: number
  trustTier: string
}

/** Seller fields sellerMetrics reads. Raw responseRate/responseTime are consumed here
 *  and only the bucketed result escapes — never add them to the return shape. */
type MetricsSellerInput = ResponseSellerInput & {
  memberSince: Date | string
  reviewCount: number
  rating: number
  trustScore: number
  trustTier: string
}

/**
 * Decompose a Seller row into the display bundle SellerCard/storefront/PDP consume.
 * `convoCount` is the seller's 90d conversation count (see module header).
 */
export function sellerMetrics(seller: MetricsSellerInput, convoCount: number): SellerMetrics {
  const since = seller.memberSince instanceof Date ? seller.memberSince : new Date(seller.memberSince)
  return {
    responseBucket: responseBucket(seller, convoCount),
    memberSinceYear: since.getFullYear(),
    reviewCount: seller.reviewCount,
    rating: seller.rating,
    trustScore: seller.trustScore,
    trustTier: seller.trustTier,
  }
}

export type SellerReviewPreview = {
  author: string
  rating: number
  text: string
  verified: boolean
  createdAt: string
}

export type TopSellerReviews = {
  reviews: SellerReviewPreview[]
  total: number
  avg: number
}

/**
 * Top `take` reviews for a seller, verified-buyer first then most-recent, plus the
 * denormalized total/avg (read off Seller.reviewCount/rating — zero extra aggregate).
 * Resilient to the pre-migration schema: if the provenance columns don't exist yet,
 * falls back to the legacy select (nothing shows the verified badge). Mirrors the
 * loadReviews pattern in seller-storefront.tsx.
 */
export const topSellerReviews = cache(async (sellerId: string, take = 2, known?: { total: number; avg: number }): Promise<TopSellerReviews> => {
  // Bounded fetch (verified-first can't be expressed as an index-only order without a
  // provenance sort key that may not exist), then stable-sort in JS and slice.
  const SCAN = Math.max(20, take * 5)
  const [seller, rows] = await Promise.all([
    // Skip the seller lookup when the caller already holds reviewCount/rating (the PDP
    // has them on the serialized listing) — otherwise read the denormalized totals.
    known ? Promise.resolve(null) : db.seller.findUnique({ where: { id: sellerId }, select: { reviewCount: true, rating: true } }),
    (async () => {
      try {
        return await db.review.findMany({
          where: { sellerId },
          orderBy: { createdAt: 'desc' },
          take: SCAN,
          select: { author: true, rating: true, text: true, createdAt: true, conversationId: true, authorProfileId: true },
        })
      } catch {
        const legacy = await db.review.findMany({
          where: { sellerId },
          orderBy: { createdAt: 'desc' },
          take: SCAN,
          select: { author: true, rating: true, text: true, createdAt: true },
        })
        return legacy.map((r) => ({ ...r, conversationId: null as string | null, authorProfileId: null as string | null }))
      }
    })(),
  ])

  const mapped: SellerReviewPreview[] = rows.map((r) => ({
    author: r.author,
    rating: r.rating,
    text: r.text,
    verified: !!(r.conversationId || r.authorProfileId),
    createdAt: r.createdAt.toISOString(),
  }))
  // Verified-buyer first, then most recent (stable — rows already came in desc order).
  mapped.sort((a, b) => (a.verified === b.verified ? 0 : a.verified ? -1 : 1))

  return {
    reviews: mapped.slice(0, take),
    total: known?.total ?? seller?.reviewCount ?? mapped.length,
    avg: known?.avg ?? seller?.rating ?? 0,
  }
})

/**
 * Other verified+active listings from the same seller, excluding the current one,
 * serialized as cards (LISTING_CARD_SELECT — the cheap projection). Newest first.
 * For the PDP "More from this seller" shelf; parallelize into the page's Promise.all.
 */
export const sameSellerListings = cache(
  async (sellerId: string, excludeListingId: string, take = 10): Promise<SerializedListingCard[]> => {
    const rows = await db.listing.findMany({
      where: { sellerId, verified: true, status: 'active', id: { not: excludeListingId } },
      orderBy: { postedAt: 'desc' },
      take,
      select: LISTING_CARD_SELECT,
    })
    return rows.map(serializeListingCard)
  },
)
