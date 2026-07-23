import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { dayCoarse } from '@/lib/last-seen'
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
//      buyer-initiated conversations in the trust window, AND whenever the row lacks
//      a responseMetricAt receipt (the nightly job's n>=5 write marker). NOTE the
//      Wilson bound alone is NOT a substitute for these gates — wilsonLowerBound(3,3)
//      ≈ 0.65, not ~0 — which is why trust.ts gates its responseQ term on the same
//      receipt. A fresh seller shows nothing, never a placeholder.
//
// convoCount is the 90d Conversation count the caller already has (it's computed by
// the trust engine as `conversations90`, or via one indexed
// db.conversation.count({ sellerId, createdAt: gte 90d })). By construction every
// Conversation is buyer-opened, so this IS the buyer-initiated count.

/** Minimum 90d buyer conversations before any responsiveness label is shown. */
export const RESPONSE_MIN_CONVOS = 5
/** responseRate at/above this reads as "responds quickly". */
const RESPONSE_FAST_RATE = 80
/** Below this replied-within-24h rate NO label shows — "Responds within a day" would
 *  be a false claim about a seller who mostly doesn't. Show nothing, never a fake. */
const RESPONSE_DAY_FLOOR = 50
// HONESTY GATE — flipped true 2026-07-23: recomputeResponseRates() (response-rate.ts,
// nightly via the daily-reminders cron, backfilled first) now measures the real
// replied-within-24h rate + median first-reply gap over 90d buyer conversations.
// The flag alone is NOT the whole gate: a seller the job has never written (thin
// history, n<5 at every run) still carries the fabricated =100 DEFAULT, so both the
// display bucket below and the trust responseQ term additionally require a non-null
// Seller.responseMetricAt — the compute job's write receipt. That per-row gate is
// what closes the crossing-the-threshold race (a seller reaching 5 convos midday
// would otherwise pass the live convoCount gate while still holding the default;
// dual external review caught it, 2026-07-23).
export const RESPONSE_METRIC_IS_REAL: boolean = true

export type ResponseBucket = {
  key: 'fast' | 'day' | null
  en: string
  vi: string
}

/** Seller fields the responsiveness bucket reads — raw values stay server-side. */
type ResponseSellerInput = {
  responseRate: number | null
  responseTime: string | null
  /** recomputeResponseRates()'s write receipt — null means the row still holds the
   *  fabricated =100 default and MUST stay suppressed regardless of convoCount. */
  responseMetricAt: Date | string | null
}

/**
 * Coarse, honest responsiveness label. Returns key:null (render NOTHING) when there
 * is no real track record. Never exposes the raw responseRate number.
 */
export function responseBucket(seller: ResponseSellerInput, convoCount: number): ResponseBucket {
  const SUPPRESS: ResponseBucket = { key: null, en: '', vi: '' }
  // Flag off = the compute job isn't live anywhere; row-level receipt missing = the
  // job has never measured THIS seller. Either way the stored number is the =100
  // default and any label would launder it — show nothing.
  if (!RESPONSE_METRIC_IS_REAL || !seller.responseMetricAt) return SUPPRESS
  // No current track record → suppress even if once measured (the 90d window slid).
  if (convoCount < RESPONSE_MIN_CONVOS) return SUPPRESS

  const rate = seller.responseRate ?? 0
  const time = (seller.responseTime ?? '').toLowerCase()
  // "<1h" signalled by a high replied-within-24h rate AND a sub-hour median gap —
  // either alone can mislead (a seller who answers 1 of 10 threads instantly has a
  // sub-hour median but is not "quick").
  const subHour = time.includes('hour') || time.includes('minute') || time.includes('min')
  if (rate >= RESPONSE_FAST_RATE && subHour) {
    return { key: 'fast', en: 'Responds quickly', vi: 'Phản hồi nhanh' }
  }
  // "Within a day" must be TYPICAL to be claimed: majority replied within 24h.
  if (rate >= RESPONSE_DAY_FLOOR) {
    return { key: 'day', en: 'Responds within a day', vi: 'Phản hồi trong ngày' }
  }
  return SUPPRESS
}

/** Client-safe metrics bundle for SellerCard / storefront / PDP seller block. */
export type SellerMetrics = {
  responseBucket: ResponseBucket
  /** Presence as a UTC day string ('YYYY-MM-DD') or null — NEVER the raw timestamp.
   *  Day-coarse so the client can compute the bucket at render time (the PDP is
   *  30d-ISR; a server-computed bucket would freeze — see src/lib/last-seen.ts). */
  lastSeenDay: string | null
  memberSinceYear: number
  reviewCount: number
  rating: number
  trustScore: number
  trustTier: string
}

/** Seller fields sellerMetrics reads. Raw responseRate/responseTime/lastSeenAt are
 *  consumed here and only the bucketed/day-coarse results escape — never add the
 *  raw values to the return shape. */
type MetricsSellerInput = ResponseSellerInput & {
  memberSince: Date | string
  reviewCount: number
  rating: number
  trustScore: number
  trustTier: string
  /** The owning Profile's presence heartbeat (seller.owner.lastSeenAt); optional so
   *  guest sellers (no owner) and older call sites simply surface nothing. */
  lastSeenAt?: Date | string | null
}

/**
 * Decompose a Seller row into the display bundle SellerCard/storefront/PDP consume.
 * `convoCount` is the seller's 90d conversation count (see module header).
 */
export function sellerMetrics(seller: MetricsSellerInput, convoCount: number): SellerMetrics {
  const since = seller.memberSince instanceof Date ? seller.memberSince : new Date(seller.memberSince)
  return {
    responseBucket: responseBucket(seller, convoCount),
    lastSeenDay: dayCoarse(seller.lastSeenAt ?? null),
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
