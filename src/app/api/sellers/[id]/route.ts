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
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const seller = await db.seller.findUnique({
    where: { id },
    include: {
      owner: { select: { accountType: true, lastSeenAt: true } },
      handle: { select: { handle: true } },
      listings: {
        where: { verified: true, status: 'active' },
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
