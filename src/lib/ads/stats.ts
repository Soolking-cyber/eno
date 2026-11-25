import 'server-only'
import { db } from '@/lib/db'
import { logError, logInfo } from '@/lib/log'
import { usdcText } from '@/lib/x402/config'
import type { AdRow } from './book'

/**
 * ── AN AD'S FIGURES, TO INDUSTRY STANDARD, IN REAL TIME (owner 2026-11-25: "they should have realtime stats for their ads
 * views clicks etc all to industry standard"). <AdBeacons> reports what a browser saw; /api/ads/[id]/event hands it here.
 *
 *   impression  a VIEWABLE one (the IAB/MRC display standard): ≥ 50 % of the card on screen for ≥ 1 continuous second;
 *   click       a primary click or a middle/aux click on the card (`click` + `auxclick`);
 *   each counted once per (browser session, ad, kind) per 30 minutes — the session is a random id the browser keeps in
 *   sessionStorage, NOT the IP: one carrier NAT puts thousands of phones behind one address. A browser without it falls
 *   back to its IP (/64 for IPv6). A per-(IP, ad, kind) cap stays as the abuse guard — generous for a NAT (60 viewable
 *   impressions, 20 clicks of one ad per address per 10 minutes), and the ceiling of what minted session ids can add;
 *   invalid     general invalid traffic (GIVT): known bots and crawlers, prefetches, events for an ad that is not running
 *               (ended, not started, its creative removed), and events past the per-IP cap — counted, never as valid;
 *   reach       sessions that saw the ad, each counted once per UTC day (`reachNew`); `frequency` = impressions / reach.
 *
 * ⛔ COUNTED IN PROCESS MEMORY, FLUSHED EVERY 10 s — never a row write per event: per ad ONE transaction of one UPDATE of the
 * totals (ListingAd.impressions / clicks) and one upsert per ad-hour into AdStat. A flush that fails is put back and tried
 * again (three times, then logged and dropped: before scripts/listing-ad-ddl.mjs, AdStat does not exist).
 * ⚠️ PER PROCESS: the dedupe, the reach sets and the IP cap live in this process (one container per edition on the box);
 * a session served by both editions could count once on each. Up to 10 s of counts are lost if the process is killed.
 */
export const FLUSH_MS = 10_000
export const DEDUPE_MS = 30 * 60_000
/** Valid events of one ad, of one kind, from one address, per window. */
export const IP_CAP = { i: 60, c: 20 } as const
export const IP_WINDOW_MS = 10 * 60_000
/** Sessions remembered per ad per UTC day for reach; past it a new session adds no reach (an undercount, never more). */
export const REACH_PER_AD_DAY = 50_000
/** Bounds on the in-memory maps; past them the oldest entries go first (Map keeps insertion order). */
const MAX_SEEN = 200_000
const MAX_IPS = 50_000
const MAX_FLUSH_TRIES = 3
const HOUR_MS = 3_600_000

export type AdEventKind = 'i' | 'c'
export type Delta = { impressions: number; clicks: number; invalid: number; reachNew: number }
const zero = (): Delta => ({ impressions: 0, clicks: 0, invalid: 0, reachNew: 0 })

let pending = new Map<string, Map<number, Delta>>()
const tries = new Map<string, number>()
const seen = new Map<string, number>()
const reach = new Map<string, Set<string>>()
const ips = new Map<string, { n: number; until: number }>()
let timer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> | null = null

/** Test seam. */
export function __resetAdStats(): void {
  pending = new Map(); tries.clear(); seen.clear(); reach.clear(); ips.clear()
  if (timer) clearTimeout(timer)
  timer = null
  flushing = null
}

const hourOf = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function deltaFor(adId: string, bucket: number): Delta {
  let byHour = pending.get(adId)
  if (!byHour) { byHour = new Map(); pending.set(adId, byHour) }
  let d = byHour.get(bucket)
  if (!d) { d = zero(); byHour.set(bucket, d) }
  return d
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => { timer = null; void flushAdStats() }, FLUSH_MS)
  timer.unref?.()
}

function trim<K, V>(m: Map<K, V>, max: number): void {
  if (m.size <= max) return
  let drop = m.size - max
  for (const k of m.keys()) { if (drop-- <= 0) break; m.delete(k) }
}

export type AdEvent = {
  adId: string
  kind: AdEventKind
  /** The browser session's id (sessionStorage), or null when the browser sent none. */
  sid: string | null
  /** The visitor's address as the limiter keys it (an IPv6 /64). */
  ip: string
  /** General invalid traffic: a known bot or a prefetch. */
  givt: boolean
  /** The ad runs now (startsAt ≤ now < endsAt, paid, its creative live). */
  running: boolean
  now?: number
}

/** One event. 'duplicate' is not counted at all (the same session within 30 minutes); 'invalid' is counted as such. */
export function recordAdEvent(e: AdEvent): 'valid' | 'invalid' | 'duplicate' {
  const now = e.now ?? Date.now()
  const d = deltaFor(e.adId, hourOf(now))
  schedule()
  const who = e.sid ? `s:${e.sid}` : `ip:${e.ip}`
  const remember = (key: string) => {
    seen.delete(key) // re-inserted last, so the oldest-first trim never drops a fresh entry
    seen.set(key, now + DEDUPE_MS)
    trim(seen, MAX_SEEN)
  }
  const fresh = (key: string) => { const until = seen.get(key); return until === undefined || until <= now }
  // Invalid traffic is deduplicated too, so nobody can grow a rival's invalid figure without bound.
  if (e.givt || !e.running) {
    const key = `x|${who}|${e.ip}|${e.adId}|${e.kind}`
    if (!fresh(key)) return 'duplicate'
    remember(key)
    d.invalid++
    return 'invalid'
  }
  const key = `${who}|${e.adId}|${e.kind}`
  if (!fresh(key)) return 'duplicate'
  const ipKey = `${e.ip}|${e.adId}|${e.kind}`
  const ip = ips.get(ipKey)
  if (!ip || ip.until <= now) {
    ips.set(ipKey, { n: 1, until: now + IP_WINDOW_MS })
    trim(ips, MAX_IPS)
  } else if (++ip.n > IP_CAP[e.kind]) {
    // Past the cap: one invalid per session, like any invalid event.
    const xKey = `x|${who}|${e.ip}|${e.adId}|${e.kind}`
    if (!fresh(xKey)) return 'duplicate'
    remember(xKey)
    d.invalid++
    return 'invalid'
  }
  remember(key)
  if (e.kind === 'c') { d.clicks++; return 'valid' }
  d.impressions++
  const dayKey = `${e.adId}|${dayOf(now)}`
  let sessions = reach.get(dayKey)
  if (!sessions) { sessions = new Set(); reach.set(dayKey, sessions) }
  if (!sessions.has(who) && sessions.size < REACH_PER_AD_DAY) { sessions.add(who); d.reachNew++ }
  return 'valid'
}

/** What this process counted for `adId` and has not written yet, per UTC hour (the live part of the figures). */
export function pendingFor(adId: string): Map<number, Delta> {
  return new Map([...(pending.get(adId) ?? new Map<number, Delta>())].map(([b, d]) => [b, { ...d }]))
}

function prune(now: number): void {
  for (const [k, until] of seen) if (until <= now) seen.delete(k)
  for (const [k, v] of ips) if (v.until <= now) ips.delete(k)
  const yesterday = dayOf(now - 86_400_000)
  for (const k of reach.keys()) if (k.slice(k.lastIndexOf('|') + 1) < yesterday) reach.delete(k)
}

/** Write what was counted: per ad, the totals and its ad-hours in ONE transaction, so a failure puts it all back. */
export async function flushAdStats(now = Date.now()): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    const batch = pending
    pending = new Map()
    for (const [adId, byHour] of batch) {
      let impressions = 0, clicks = 0
      for (const d of byHour.values()) { impressions += d.impressions; clicks += d.clicks }
      const writes = [
        ...(impressions || clicks ? [db.$executeRaw`UPDATE "ListingAd" SET "impressions" = "impressions" + ${impressions}, "clicks" = "clicks" + ${clicks} WHERE "id" = ${adId}`] : []),
        ...[...byHour].map(([bucket, d]) => db.$executeRaw`INSERT INTO "AdStat" ("adId", "bucket", "impressions", "clicks", "invalid", "reachNew")
          VALUES (${adId}, ${new Date(bucket)}, ${d.impressions}, ${d.clicks}, ${d.invalid}, ${d.reachNew})
          ON CONFLICT ("adId", "bucket") DO UPDATE SET "impressions" = "AdStat"."impressions" + EXCLUDED."impressions",
            "clicks" = "AdStat"."clicks" + EXCLUDED."clicks", "invalid" = "AdStat"."invalid" + EXCLUDED."invalid",
            "reachNew" = "AdStat"."reachNew" + EXCLUDED."reachNew"`),
      ]
      try {
        try {
          await db.$transaction(writes)
        } catch (e) {
          // Before the AdStat table exists (the DDL creates it with the creative column): the totals alone, as before.
          if (!(e instanceof Error && /AdStat|42P01/.test(e.message)) || !(impressions || clicks)) throw e
          await db.$transaction(writes.slice(0, 1))
          logInfo('ads_stats_no_hourly_table', { adId })
        }
        tries.delete(adId)
      } catch (e) {
        const n = (tries.get(adId) ?? 0) + 1
        if (n >= MAX_FLUSH_TRIES) {
          tries.delete(adId)
          logError(e, { op: 'ads.stats.flush-dropped', adId, impressions, clicks })
          continue
        }
        tries.set(adId, n)
        logInfo('ads_stats_flush_retry', { adId, try: n })
        // Put it back, added to whatever was counted meanwhile.
        for (const [bucket, d] of byHour) {
          const into = deltaFor(adId, bucket)
          into.impressions += d.impressions; into.clicks += d.clicks; into.invalid += d.invalid; into.reachNew += d.reachNew
        }
        schedule()
      }
    }
    prune(now)
  })().finally(() => { flushing = null })
  return flushing
}

// ── The figures as an advertiser reads them ──────────────────────────────────────────────────────────────────────────

export type HourRow = { bucket: Date; impressions: number; clicks: number; invalid: number; reachNew: number }

export type AdFigures = {
  ad_id: string
  listing_id: string | null
  creative_id: string | null
  status: string
  starts_at: string | null
  ends_at: string | null
  totals: {
    impressions: number; clicks: number; invalid: number
    /** clicks ÷ impressions, 0..1 (4 decimals); null with no impression. */
    ctr: number | null
    /** Sessions that saw it, once per UTC day, summed over its days. */
    reach: number
    /** impressions ÷ reach; null with no reach. */
    frequency: number | null
    /** The price paid, pro rata to the part of the run that has elapsed, in USDC (decimal string). */
    spend_usdc: string
    paid_usdc: string
    /** Spend per 1,000 impressions and per click, in USDC; null without any. */
    ecpm_usdc: string | null
    ecpc_usdc: string | null
  }
  hourly: { hour_utc: string; hour_ict: string; impressions: number; clicks: number; invalid: number; reach_new: number }[]
  updated_at: string
}

/** The hour as it reads in Vietnam (UTC+7, no daylight saving): "2026-11-25 15:00 ICT". */
export function ictLabel(bucket: Date): string {
  const t = new Date(bucket.getTime() + 7 * HOUR_MS).toISOString()
  return `${t.slice(0, 10)} ${t.slice(11, 16)} ICT`
}

/** The price paid, pro rata to the elapsed part of the run, in atomic units (floor). */
export function spendAtomic(ad: Pick<AdRow, 'amount' | 'startsAt' | 'endsAt' | 'status'>, now: Date): bigint {
  if (ad.status !== 'active' || !ad.startsAt || !ad.endsAt) return BigInt(0)
  const total = ad.endsAt.getTime() - ad.startsAt.getTime()
  if (total <= 0) return BigInt(0)
  const elapsed = Math.min(Math.max(now.getTime() - ad.startsAt.getTime(), 0), total)
  return (BigInt(ad.amount) * BigInt(Math.round(elapsed))) / BigInt(total)
}

/** The stored hours plus what this process has not flushed yet: the figures, live to the event. */
export function adFigures(ad: AdRow, rows: HourRow[], now = new Date()): AdFigures {
  const byHour = new Map<number, Delta>(rows.map((r) => [r.bucket.getTime(), { impressions: r.impressions, clicks: r.clicks, invalid: r.invalid, reachNew: r.reachNew }]))
  for (const [b, d] of pendingFor(ad.id)) {
    const into = byHour.get(b) ?? zero()
    into.impressions += d.impressions; into.clicks += d.clicks; into.invalid += d.invalid; into.reachNew += d.reachNew
    byHour.set(b, into)
  }
  const hours = [...byHour].sort(([a], [b]) => a - b)
  const sum = hours.reduce((t, [, d]) => ({ impressions: t.impressions + d.impressions, clicks: t.clicks + d.clicks, invalid: t.invalid + d.invalid, reachNew: t.reachNew + d.reachNew }), zero())
  const spend = spendAtomic(ad, now)
  const round4 = (x: number) => Math.round(x * 10_000) / 10_000
  return {
    ad_id: ad.id,
    listing_id: ad.listingId,
    creative_id: ad.creativeId,
    status: ad.status,
    starts_at: ad.startsAt?.toISOString() ?? null,
    ends_at: ad.endsAt?.toISOString() ?? null,
    totals: {
      impressions: sum.impressions,
      clicks: sum.clicks,
      invalid: sum.invalid,
      ctr: sum.impressions ? round4(sum.clicks / sum.impressions) : null,
      reach: sum.reachNew,
      frequency: sum.reachNew ? Math.round((sum.impressions / sum.reachNew) * 100) / 100 : null,
      spend_usdc: usdcText(spend.toString()),
      paid_usdc: usdcText(ad.amount),
      ecpm_usdc: sum.impressions ? usdcText(((spend * BigInt(1000)) / BigInt(sum.impressions)).toString()) : null,
      ecpc_usdc: sum.clicks ? usdcText((spend / BigInt(sum.clicks)).toString()) : null,
    },
    hourly: hours.map(([b, d]) => ({ hour_utc: new Date(b).toISOString(), hour_ict: ictLabel(new Date(b)), impressions: d.impressions, clicks: d.clicks, invalid: d.invalid, reach_new: d.reachNew })),
    updated_at: now.toISOString(),
  }
}

/** One of the shop's ads with its figures, or null when it is not this shop's (the caller answers 404). */
export async function shopAdFigures(adId: string, sellerId: string, now = new Date()): Promise<AdFigures | null> {
  if (!sellerId || !/^[A-Za-z0-9_-]{1,64}$/.test(adId)) return null
  const ad = await db.listingAd.findUnique({ where: { id: adId } })
  if (!ad || ad.sellerId !== sellerId) return null
  // A run is at most 90 days: 2,160 hours.
  const rows = await db.adStat.findMany({ where: { adId }, orderBy: { bucket: 'asc' }, take: 2_200 })
  return adFigures(ad, rows, now)
}
