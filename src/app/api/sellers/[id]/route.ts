import { IS_MARKETPLACE } from '@/lib/edition'
import { deskSellerIds, scopedListingWhere } from '@/lib/edition-scope'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { topSellerReviews, sellerMetrics } from '@/lib/seller-metrics'
import { lastSeenBucket } from '@/lib/last-seen'
import { isBusinessVerified } from '@/lib/business-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public seller storefront for the native apps (the web /sellers/[id] and
// /<handle> pages are SSR and never call this). Returns the storefront header
// metrics (bucketed responsiveness — raw responseRate stays server-side, the
// honesty gate), the seller's active listings as cards, and top reviews.
//
// ⚠️ WS6 — NOT MIGRATED: all four wrapper options would be empty (public, no limiter, no JSON body),
// so route() would be pure noise here. It would also cost something: both 404s emit
// `{"error":"Not found"}` — capital N, a space — which is NOT an ApiErrorCode and cannot be
// `ApiError('not_found')` without changing the bytes the native apps parse, and the success path sets
// its own `Cache-Control: s-maxage=60`, so it would have to keep returning a Response by hand anyway.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  /**
   * ⚠️ MARKETPLACE ONLY — deskSellerIds() is edition-BLIND (it answers "who is the desk", not
   * "should I hide them"), so the IS_MARKETPLACE test is load-bearing: without it this 404s the
   * desk's own storefront on eno.forum, which is where it is supposed to live. GUARDED BEFORE THE QUERY, AND NOT WITH marketplaceListingScope(). That fragment keys on
   * `sellerId`, a LISTING column; spreading it into a Seller `where: { id }` is a SILENT NO-OP that
   * looks exactly like protection. This route has no auth at all, sets `s-maxage=60`, and returns
   * the desk's storefront header, metrics and reviews to anyone who asks — the worst single leak in
   * its batch. deskSellerIds() resolves to [] on the services edition, so eno.forum is unaffected.
   */
  if (IS_MARKETPLACE && (await deskSellerIds()).includes(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const seller = await db.seller.findUnique({
    where: { id },
    include: {
      owner: { select: { accountType: true, lastSeenAt: true } },
      handle: { select: { handle: true } },
      listings: {
        // Nested-include reads are invisible to a Prisma client extension and to edition-lint's
        // regex, so this one only ever gets fixed by hand.
        where: await scopedListingWhere({ verified: true, status: 'active' }),
        orderBy: { postedAt: 'desc' },
        take: 24,
        include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
      },
    },
  })
  if (!seller) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [reviews, convoCount] = await Promise.all([
    topSellerReviews(seller.id, 3, { total: seller.reviewCount, avg: seller.rating }),
    db.conversation.count({ where: { sellerId: seller.id, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } } }),
  ])
  const metrics = sellerMetrics(
    {
      responseRate: seller.responseRate,
      responseTime: seller.responseTime,
      responseMetricAt: seller.responseMetricAt,
      memberSince: seller.memberSince,
      reviewCount: seller.reviewCount,
      rating: seller.rating,
      trustScore: seller.trustScore,
      trustTier: seller.trustTier,
      lastSeenAt: seller.owner?.lastSeenAt ?? null,
    },
    convoCount,
  )
  const listings = await localizeListingTitles(seller.listings.map(serializeListing), req.cookies.get('lang')?.value)

  const res = NextResponse.json({
    seller: {
      id: seller.id,
      name: seller.name,
      avatarUrl: seller.avatarUrl,
      avatarColor: seller.avatarColor,
      bio: seller.bio,
      location: seller.location,
      isBusiness: seller.owner?.accountType === 'business',
      businessVerified: seller.owner?.accountType === 'business' && isBusinessVerified(seller),
      handle: seller.handle?.handle ?? null,
      trustScore: metrics.trustScore,
      trustTier: metrics.trustTier,
      rating: metrics.rating,
      reviewCount: metrics.reviewCount,
      memberSinceYear: metrics.memberSinceYear,
      // Honest, bucketed responsiveness — null when there's no real track record.
      responseLabel: metrics.responseBucket.key
        ? { en: metrics.responseBucket.en, vi: metrics.responseBucket.vi }
        : null,
      // Coarse presence ("Active today/this week/this month") — null when unknown or
      // >30d stale. Bucketed server-side: this route is force-dynamic, so unlike the
      // ISR PDP the label can't freeze. Additive; existing decoders ignore it.
      lastSeenLabel: (() => {
        const b = lastSeenBucket(metrics.lastSeenDay)
        return b.key ? { en: b.en, vi: b.vi } : null
      })(),
    },
    listings,
    reviews,
  })
  res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  return res
}
