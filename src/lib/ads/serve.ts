import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { cachedTranslations, localizeListingTitles } from '@/lib/translate'
import { logError } from '@/lib/log'
import type { SerializedListingCard } from '@/lib/types'
import type { AdCreativeCardData } from './creative-card'
import { reviewCountsHere } from './review-jev'

/**
 * ── Serving paid ads (owner 2026-11-23: one ad in category + search results, the home feed and the similar-listings row;
 * 2026-11-25: any lawful advertiser's own ad in the feed card). ONE place serves them: the first page of /api/listings
 * (route.ts → buildFeedPayload({ ads: true })), which the explorer (home, category, search) and the similar-listings row
 * all read.
 *   · A LISTING AD is the shop's own listing, shown FIRST with `isSponsored: true` — the card's existing "Ad / Quảng cáo"
 *     marker — and `adId`; its organic copy on that page is dropped, and later pages lose it to the explorer's own id
 *     dedupe (seenIdsRef), so no card is drawn twice.
 *   · A CREATIVE AD (creative-card.ts) matches every feed, and is a candidate ONLY when the request opts in (`adc=1`, which
 *     the explorer sends): it travels as the payload's separate `adCreative`, never inside `listings[]`.
 * ⛔ ONE PICK, UNIFORM, among the running listing ads that match the request's own final filter (`feedWhere`: category,
 * words, district, the edition scope that keeps the e-Visa desk off eno.vn, hidden shops, the home feed's in-app
 * narrowing) AND the running creative ads when opted in. Never on a storefront (`seller`), an id list, `featured`, a
 * histogram or a later page.
 * ⛔ A CREATIVE RUNS ONLY WHILE IT IS APPROVED by a review that counts here (review-jev.ts reviewCountsHere): eno's removal
 * takes it out of this set at the next read — the set lives 15 s, and the feed's edge copy with a creative 45 s
 * (feed-payload.ts), so a removed ad stops showing within a minute.
 * ⛔ NOT IN SERVER-RENDERED HTML: / and /c/* are edge-cached for hours (infra/cloudflare/eno-html-edge-cache.js), so an ad
 * there would outlive its run. It arrives with the client's live fetch.
 * Fail-soft: any error here serves the organic page.
 */
export const ACTIVE_TTL_MS = 15_000
/** How long after its end an ad is still KNOWN (its late beacons are counted as invalid, never as nothing). */
const KNOWN_AFTER_END_MS = 86_400_000

type ActiveAd = { id: string; listingId: string | null; creativeId: string | null; startsAt: Date | null; endsAt: Date | null }
type ServedCreative = { id: string; advertiserName: string; headline: string; body: string | null; imageUrl: string; clickUrl: string }
type AdSet = { at: number; until: number; ads: ActiveAd[]; creatives: Map<string, ServedCreative> }
let cache: AdSet | null = null

/** Test seam, and eno's removal (admin): the next read loads the set again. */
export function __resetAdServeCache(): void { cache = null; i18nCache.clear() }
export const invalidateAdServeCache = __resetAdServeCache

async function adSet(now: Date): Promise<AdSet> {
  if (cache && now.getTime() >= cache.at && now.getTime() < cache.until) return cache
  try {
    const ads = await db.listingAd.findMany({
      where: { status: 'active', endsAt: { gt: new Date(now.getTime() - KNOWN_AFTER_END_MS) } },
      select: { id: true, listingId: true, creativeId: true, startsAt: true, endsAt: true },
      // The latest-ending first, so a cap ever reached drops the ones closest to their end.
      orderBy: { endsAt: 'desc' },
      take: 5_000,
    })
    const ids = [...new Set(ads.flatMap((a) => (a.creativeId ? [a.creativeId] : [])))]
    const rows = ids.length
      ? await db.adCreative.findMany({
          where: { id: { in: ids }, status: 'approved' },
          select: { id: true, advertiserName: true, headline: true, body: true, imageUrl: true, clickUrl: true, reviewModel: true },
        })
      : []
    const creatives = new Map(rows.filter((c) => c.imageUrl && reviewCountsHere(c.reviewModel)).map(({ reviewModel: _m, ...c }) => [c.id, c]))
    // The set may not outlive the next start or end among its ads: that moment caps its life.
    const t = now.getTime()
    const next = ads.reduce((m, a) => Math.min(m, ...[a.startsAt?.getTime(), a.endsAt?.getTime()].filter((x): x is number => x !== undefined && x > t)), Infinity)
    cache = { at: t, until: Math.min(t + ACTIVE_TTL_MS, next), ads, creatives }
  } catch (e) {
    // Before scripts/listing-ad-ddl.mjs has run (or on a DB blip): no ads for the TTL, logged once per TTL — never a failed
    // query on every feed request.
    logError(e, { op: 'ads.active' })
    cache = { at: now.getTime(), until: now.getTime() + ACTIVE_TTL_MS, ads: [], creatives: new Map() }
  }
  return cache
}

const isRunning = (a: ActiveAd, set: AdSet, now: Date): boolean =>
  !!a.startsAt && !!a.endsAt && a.startsAt <= now && a.endsAt > now && (a.listingId ? true : !!a.creativeId && set.creatives.has(a.creativeId))

/** Whether `id` is an ad running now (the same short-lived set the feed reads). */
export async function isRunningAd(id: string, now = new Date()): Promise<boolean> {
  return (await adEventState(id, now)) === 'running'
}

/**
 * What the beacon route may count for `id` (stats.ts): 'running' → valid; 'known' (paid and active, but not running now —
 * not started, ended within a day, its creative removed) → invalid traffic; 'unknown' → nothing at all, so random ids
 * cannot grow the counters.
 */
export async function adEventState(id: string, now = new Date()): Promise<'running' | 'known' | 'unknown'> {
  const set = await adSet(now)
  const ad = set.ads.find((a) => a.id === id)
  if (!ad) return 'unknown'
  return isRunning(ad, set, now) ? 'running' : 'known'
}

/** The params that make a feed request one an ad may join. */
export function adEligibleRequest(sp: URLSearchParams, offset: number, histogram: boolean): boolean {
  if (offset !== 0 || histogram) return false
  if (sp.get('ads') === '0') return false
  return !sp.get('seller') && !sp.get('ids') && sp.get('featured') !== 'true'
}

/** Translations per (creative, language), held 10 minutes: the store is read once, not on every feed request. */
const I18N_TTL_MS = 600_000
const i18nCache = new Map<string, { at: number; headline?: string; body?: string }>()

async function creativeCard(adId: string, c: ServedCreative, lang: string | undefined, now: number): Promise<AdCreativeCardData> {
  const card: AdCreativeCardData = { adId, advertiserName: c.advertiserName, headline: c.headline, body: c.body, imageUrl: c.imageUrl, clickUrl: c.clickUrl }
  if (!lang) return card
  // The SAME store the listing titles read (translate.ts cachedTranslations): a creative is immutable, so its words are
  // keyed by their own text exactly as a title is. en and vi are embedded too — a creative has no Vietnamese column.
  const key = `${c.id}|${lang}`
  let hit = i18nCache.get(key)
  if (!hit || now - hit.at > I18N_TTL_MS) {
    const map = await cachedTranslations([c.headline, ...(c.body ? [c.body] : [])]).catch((e: unknown) => { logError(e, { op: 'ads.creative.i18n' }); return {} as Record<string, Record<string, string>> })
    hit = { at: now, headline: map[c.headline]?.[lang], body: c.body ? map[c.body]?.[lang] : undefined }
    i18nCache.set(key, hit)
    if (i18nCache.size > 5_000) i18nCache.delete(i18nCache.keys().next().value!)
  }
  return { ...card, ...(hit.headline ? { headlineI18n: { [lang]: hit.headline } } : {}), ...(hit.body ? { bodyI18n: { [lang]: hit.body } } : {}) }
}

export type AdPick = { listing: SerializedListingCard | null; creative: AdCreativeCardData | null }

/**
 * One ad for this request, or none: a uniform pick among the running listing ads that match it and — with `creatives`
 * (the request's `adc=1`) — every running creative ad.
 */
export async function pickAd(feedWhere: Prisma.ListingWhereInput, lang: string | undefined, now = new Date(), opts: { creatives?: boolean } = {}): Promise<AdPick> {
  const none: AdPick = { listing: null, creative: null }
  try {
    const set = await adSet(now)
    const running = set.ads.filter((a) => isRunning(a, set, now))
    if (!running.length) return none
    // ⛔ Never a null into `id: { in }`: a creative ad has no listing.
    const ids = [...new Set(running.flatMap((a) => (a.listingId ? [a.listingId] : [])))]
    // edition-lint-allow: `feedWhere` is the request's own resolveFeedFilters `where`, which already ANDs marketplaceListingScope().
    const matching = ids.length ? await db.listing.findMany({ where: { AND: [feedWhere, { id: { in: ids } }] }, select: LISTING_CARD_SELECT }) : []
    const byListing = new Map(matching.map((l) => [l.id, l]))
    // ⛔ UNIFORM, NOT FEWEST-IMPRESSIONS-FIRST (gate review 2026-11-23): impressions come from unauthenticated beacons, so a
    // rotation steered by them could be rigged to push a rival's ad out. Every candidate has the same chance.
    const candidates = running.filter((a) => (a.listingId ? byListing.has(a.listingId) : !!opts.creatives))
    if (!candidates.length) return none
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!
    if (pick.listingId) {
      const [card] = await localizeListingTitles([serializeListingCard(byListing.get(pick.listingId)!)], lang)
      return { listing: { ...card, isSponsored: true, adId: pick.id }, creative: null }
    }
    return { listing: null, creative: await creativeCard(pick.id, set.creatives.get(pick.creativeId!)!, lang, now.getTime()) }
  } catch (e) {
    logError(e, { op: 'ads.pick' })
    return none
  }
}

/** The ad first, its organic copy dropped; the organic rows otherwise untouched (offsets stay the page's). */
export function withAd<T extends { id: string }>(listings: T[], ad: T | null): T[] {
  if (!ad) return listings
  return [ad, ...listings.filter((l) => l.id !== ad.id)]
}
