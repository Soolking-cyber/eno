import 'server-only'
import { db } from '@/lib/db'
import { adFigures, type AdFigures, type HourRow } from './stats'

/**
 * ── THE SHOP'S ADS FOR ITS DASHBOARD (/dashboard/ads, owner 2026-11-25: "realtime stats … to industry standard"). Each ad
 * with its live figures (stats.ts adFigures: the stored hours plus what this process has not flushed yet) and what it
 * shows: a creative's headline, picture and review status, or the listing's title. The shop's own rows only (sellerId).
 */
export type DashboardAd = AdFigures & {
  hours: number
  target: { kind: 'creative'; headline: string; advertiserName: string; imageUrl: string; status: string } | { kind: 'listing'; title: string | null } | null
}

const LIVE = ['active', 'pending', 'unknown', 'review']

export async function dashboardAds(sellerId: string, now = new Date()): Promise<DashboardAd[]> {
  const ads = await db.listingAd.findMany({ where: { sellerId, status: { in: LIVE } }, orderBy: { createdAt: 'desc' }, take: 50 })
  if (!ads.length) return []
  const ids = ads.map((a) => a.id)
  const creativeIds = [...new Set(ads.flatMap((a) => (a.creativeId ? [a.creativeId] : [])))]
  const listingIds = [...new Set(ads.flatMap((a) => (a.listingId ? [a.listingId] : [])))]
  const [rows, creatives, listings] = await Promise.all([
    // Up to 50 ads × a week of hours; older hours of a long listing ad stay in its own GET /api/v1/ads/{id}/stats.
    db.adStat.findMany({ where: { adId: { in: ids }, bucket: { gte: new Date(now.getTime() - 14 * 86_400_000) } }, orderBy: { bucket: 'asc' }, take: 20_000 }),
    creativeIds.length ? db.adCreative.findMany({ where: { id: { in: creativeIds }, sellerId }, select: { id: true, headline: true, advertiserName: true, imageUrl: true, status: true } }) : Promise.resolve([]),
    // edition-lint-allow: the titles of the caller's own advertised listings (the ad rows are sellerId-scoped above); nothing public.
    listingIds.length ? db.listing.findMany({ where: { id: { in: listingIds }, sellerId }, select: { id: true, title: true } }) : Promise.resolve([] as { id: string; title: string }[]),
  ])
  const byAd = new Map<string, HourRow[]>()
  for (const r of rows) byAd.set(r.adId, [...(byAd.get(r.adId) ?? []), r])
  const creativeOf = new Map(creatives.map((c) => [c.id, c] as const))
  const titleOf = new Map(listings.map((l) => [l.id, l.title] as const))
  return ads.map((ad) => {
    const c = ad.creativeId ? creativeOf.get(ad.creativeId) : undefined
    return {
      ...adFigures(ad, byAd.get(ad.id) ?? [], now),
      hours: Math.round(ad.durationSec / 3600),
      target: c ? { kind: 'creative' as const, headline: c.headline, advertiserName: c.advertiserName, imageUrl: c.imageUrl, status: c.status }
        : ad.listingId ? { kind: 'listing' as const, title: titleOf.get(ad.listingId) ?? null } : null,
    }
  })
}
