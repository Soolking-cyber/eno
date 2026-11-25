import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { logError } from '@/lib/log'
import type { SerializedListingCard } from '@/lib/types'

/**
 * ── Serving paid ads (owner 2026-11-23: one ad in category + search results, the home feed and the similar-listings row).
 * ONE place serves them: the first page of /api/listings (route.ts → buildFeedPayload({ ads: true })), which the explorer
 * (home, category, search) and the similar-listings row all read. The ad is the shop's own listing, shown FIRST with
 * `isSponsored: true` — the card's existing "Ad / Quảng cáo" marker — and `adId`; its organic copy on that page is dropped,
 * and later pages lose it to the explorer's own id dedupe (seenIdsRef), so no card is drawn twice.
 * ⛔ IT MATCHES THE REQUEST'S OWN FINAL FILTER (`feedWhere`: category, words, district, the edition scope that keeps the
 * e-Visa desk off eno.vn, hidden shops, the home feed's in-app narrowing) — an ad can only be a card the same request could
 * have returned anyway. Never on a storefront (`seller`), an id list, `featured`, a histogram or a later page.
 * ⛔ NOT IN SERVER-RENDERED HTML: / and /c/* are edge-cached for hours (infra/cloudflare/eno-html-edge-cache.js), so an ad
 * there would outlive its week. It arrives with the client's live fetch, which is edge-cached for 60 s at most.
 * Fail-soft: any error here serves the organic page.
 */
const ACTIVE_TTL_MS = 60_000
let activeCache: { at: number; ads: { id: string; listingId: string | null; impressions: number }[] } | null = null

/** Test seam. */
export function __resetAdServeCache(): void { activeCache = null }

async function activeAds(now: Date): Promise<{ id: string; listingId: string | null; impressions: number }[]> {
  if (activeCache && now.getTime() - activeCache.at < ACTIVE_TTL_MS) {
    return activeCache.ads
  }
  let ads: { id: string; listingId: string | null; impressions: number; endsAt: Date | null }[]
  try {
    ads = await db.listingAd.findMany({
      where: { status: 'active', startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true, listingId: true, impressions: true, endsAt: true },
      take: 5_000,
    })
  } catch (e) {
    // Before scripts/listing-ad-ddl.mjs has run (or on a DB blip): no ads for a minute, logged once a minute — never a
    // failed query on every feed request.
    logError(e, { op: 'ads.active' })
    activeCache = { at: now.getTime(), ads: [] }
    return []
  }
  // The cache may not hold an ad past its end: the earliest end in the set caps its life.
  const live = ads.map(({ id, listingId, impressions }) => ({ id, listingId, impressions }))
  activeCache = { at: now.getTime(), ads: live }
  const firstEnd = ads.reduce((m, a) => Math.min(m, a.endsAt?.getTime() ?? Infinity), Infinity)
  if (Number.isFinite(firstEnd) && firstEnd - now.getTime() < ACTIVE_TTL_MS) activeCache.at = firstEnd - ACTIVE_TTL_MS
  return live
}

/** Whether `id` is an ad running now (the same 60-second cache the feed reads): the beacon route counts nothing else, so
 *  random ids cannot grow the rate-limit table or cost a write. */
export async function isRunningAd(id: string, now = new Date()): Promise<boolean> {
  return (await activeAds(now)).some((a) => a.id === id)
}

/** The params that make a feed request one an ad may join. */
export function adEligibleRequest(sp: URLSearchParams, offset: number, histogram: boolean): boolean {
  if (offset !== 0 || histogram) return false
  if (sp.get('ads') === '0') return false
  return !sp.get('seller') && !sp.get('ids') && sp.get('featured') !== 'true'
}

/** One ad for this request, or null: a uniform pick among the running ads that match it. */
export async function pickAd(feedWhere: Prisma.ListingWhereInput, lang: string | undefined, now = new Date()): Promise<SerializedListingCard | null> {
  try {
    const ads = await activeAds(now)
    if (!ads.length) return null
    // ⛔ Never a null into `id: { in }`: a creative ad has no listing.
    const ids = [...new Set(ads.flatMap((a) => (a.listingId ? [a.listingId] : [])))]
    if (!ids.length) return null
    // edition-lint-allow: `feedWhere` is the request's own resolveFeedFilters `where`, which already ANDs marketplaceListingScope().
    const matching = await db.listing.findMany({ where: { AND: [feedWhere, { id: { in: ids } }] }, select: LISTING_CARD_SELECT })
    if (!matching.length) return null
    const byListing = new Map(matching.map((l) => [l.id, l]))
    // ⛔ UNIFORM, NOT FEWEST-IMPRESSIONS-FIRST (gate review 2026-11-23): impressions come from unauthenticated beacons, so a
    // rotation steered by them could be rigged to push a rival's ad out. Every matching running ad has the same chance.
    const candidates = ads.filter((a): a is typeof a & { listingId: string } => !!a.listingId && byListing.has(a.listingId))
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    const [card] = await localizeListingTitles([serializeListingCard(byListing.get(pick.listingId)!)], lang)
    return { ...card, isSponsored: true, adId: pick.id }
  } catch (e) {
    logError(e, { op: 'ads.pick' })
    return null
  }
}

/** The ad first, its organic copy dropped; the organic rows otherwise untouched (offsets stay the page's). */
export function withAd<T extends { id: string }>(listings: T[], ad: T | null): T[] {
  if (!ad) return listings
  return [ad, ...listings.filter((l) => l.id !== ad.id)]
}
