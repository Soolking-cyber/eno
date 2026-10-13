/**
 * WHICH IMPORTED VEHICLE ROWS GO DOWN, AND WHICH COME BACK — the pure half of the every-3-days refresh
 * (scripts/vehicle-rentals-weekly.sh → scripts/import-vehicle-rentals.ts --stage import → this plan →
 * scripts/vehicle-rentals-status.ts writes it). No file, no database.
 *
 * Owner, 2026-10-13: "remove most of car rental leave only reliable fresh ones same with motorbike rentals maybe
 * 7-10 days old ones". Picked the same day:
 *   · CARS (Mioto, BonbonCar) — live only while the car passes the reliability rule (src/lib/vehicle-reliability.ts).
 *     A live row whose car fails it → EXPIRED_STATUS; one whose car is ABSENT from CAR_ABSENT_RUNS complete HCMC
 *     scrapes in a row, at least CAR_ABSENT_MIN_SPAN_DAYS apart, too. ⚠️ NOT ON ONE ABSENCE (review 2026-10-13):
 *     Mioto's search only shows a car free in one of the asked windows, so a car booked solid is missing from a
 *     scrape while it is live and busy — the reliable car the owner wants kept (measured: ~1.8% of HCMC cars a
 *     week, strong cars no more than the rest). A delisting proper is caught sooner by vehicle-rentals-gone.py's
 *     positive probe ('hidden'); absence here is only the backstop.
 *   · MOTORBIKES (the five HCMC shops) — live while the bike was listed (and, at Jan's, in stock) in at least one of
 *     the last BIKE_MISS_RUNS checks; missing from that many consecutive checks spanning ≥ BIKE_MISS_MIN_SPAN_DAYS
 *     → EXPIRED_STATUS (on a 3-day cadence: last seen ~9 days before, inside the owner's "7-10 days"). Stock counts
 *     wherever a shop reports it — today only Jan's does (the importer drops any shop's out-of-stock bike the same way).
 *   · REVIVAL — an EXPIRED row comes back to 'active' when this run shows it fresh again: the car passes the rule,
 *     the bike is listed in stock — AND this run's import refreshed the row (`ready`), so a revived page never
 *     shows last month's price.
 *
 * ⛔ ONLY active ↔ expired. 'hidden' (a moderator, the content screen, or vehicle-rentals-gone.py's POSITIVE gone
 * signal — delisted, 404), 'removed' (the compliance tombstone), 'sold' and anything else are never touched.
 * ⛔ A SHORT SCRAPE EXPIRES NOTHING. Each source (Mioto, BonbonCar, and each shop on its own) is JUDGED only when
 * its fresh in-scope count is at least PRESENCE_MIN_SHARE of its reference — the LARGEST of its last
 * PRESENCE_BASELINE_RUNS accepted counts (so a slow decline cannot ratchet it down), else the weekly baseline the
 * gone helper keeps (the first run) — or at most PRESENCE_ABS_SLACK rows short of it: a 14-bike shop selling 3 bikes
 * is churn, not a broken scrape, and a refusal there would repeat on every run. An unjudged source expires nothing; a short run is recorded as NOT accepted, so
 * it neither becomes a reference nor counts as a bike's missed check. Revival needs no judging: it acts only on
 * POSITIVE evidence (the car's own record, the bike's own listing).
 * ⛔ NO SOURCE LOSES MORE THAN MAX_EXPIRE_SHARE OF ITS LIVE ROWS IN ONE RUN (from EXPIRE_SHARE_FLOOR live rows). The
 * count guard cannot see a scrape whose count is whole but whose fields are garbage (every rating 0, a trips
 * history gone wrong) — this catches the shape such a fault produces. --accept <source> overrides both guards for
 * an operator holding independent evidence (even an empty scrape: a closed shop); nothing overrides a scrape older
 * than the last recorded. ⚠️ 'expired' IS REVIVABLE BY DESIGN: a car taken down by hand with scripts/expire-rentals.ts
 * comes back once it passes the rule again — to keep a row down for good, hide it ('hidden' is never revived).
 */
import { EXPIRED_STATUS } from './apartment-freshness'
import { SHOP_KEYS, type SellerKey, type ShopKey } from './vehicle-rental-listing'
import type { Verdict } from './vehicle-reliability'

export const ACTIVE_STATUS = 'active'
export const PRESENCE_MIN_SHARE = 0.8
/** A drop of this many rows or fewer is never "short", whatever the share (small shops). */
export const PRESENCE_ABS_SLACK = 3
export const PRESENCE_BASELINE_RUNS = 3
export const BIKE_MISS_RUNS = 3
/**
 * Three checks on a 3-day cadence span 6 days — give or take the scrape's own timing (the shops are scraped hours
 * into a run whose length varies), so the bar is 5.5: a span of 5.99 must not push the expiry to a fourth check
 * (~12 days, outside "7-10"), while three checks squeezed into a few days of retries still do not count.
 */
export const BIKE_MISS_MIN_SPAN_DAYS = 5.5
/**
 * A scrape older than this is not judged on and not recorded as a check (review 2026-10-13): the job imports within
 * hours of its scrape, so an older one is a re-used dataset (VEH_SKIP_SCRAPE), and counting it again would add a
 * missed check that never happened.
 */
export const MAX_SCRAPE_AGE_DAYS = 2
/** A car is expired for ABSENCE only after this many complete scrapes in a row without it… */
export const CAR_ABSENT_RUNS = 2
/** …spanning at least this many days (two runs of a failed-then-retried day do not count twice). */
export const CAR_ABSENT_MIN_SPAN_DAYS = 2
export const MAX_EXPIRE_SHARE = 0.5
export const EXPIRE_SHARE_FLOOR = 20
export const CAR_SOURCES = ['mioto', 'bonboncar'] as const
export type CarSource = (typeof CAR_SOURCES)[number]
export const CAR_SUBCAT = 'car-rental'
export const BIKE_SUBCAT = 'motorbike-rental'
/** A shop's product id as the importer accepts it (stageShopBike). */
const BIKE_EXTERNAL_ID = /^[A-Za-z0-9_.-]{1,80}$/
const DAY_MS = 86_400_000

// ── The count guard ───────────────────────────────────────────────────────────────────────────────

export type Guard = { judged: boolean; accepted: boolean; reference: number | null; reason: string }

/**
 * Is this run's scrape of ONE source whole enough to expire on?
 *   · `judged`   — its absences and failures may expire rows this run.
 *   · `accepted` — its count may be a later run's reference and its presence a bike's checked run.
 * @param priorAccepted counts of earlier ACCEPTED runs of this source, newest first.
 * @param fallback the weekly baseline's count (vehicle-rentals-gone.py's `latest/`) when no run is recorded yet.
 * @param newest false when a scrape of this source newer than this one is already recorded.
 */
export function presenceGuard(a: { count: number; priorAccepted: readonly number[]; fallback: number | null; force?: boolean; newest?: boolean; ageDays?: number }): Guard {
  if (a.newest === false) return { judged: false, accepted: false, reference: null, reason: 'a newer scrape of this source is already recorded — refusing to go back in time' }
  if (a.ageDays !== undefined && !(a.ageDays <= MAX_SCRAPE_AGE_DAYS)) {
    return { judged: false, accepted: false, reference: null, reason: `the scrape is ${Number.isFinite(a.ageDays) ? a.ageDays.toFixed(1) : '?'} days old (> ${MAX_SCRAPE_AGE_DAYS}) — a re-used dataset is not a new check` }
  }
  const recent = a.priorAccepted.slice(0, PRESENCE_BASELINE_RUNS)
  const reference = recent.length ? Math.max(...recent) : a.fallback
  // --accept even takes an EMPTY scrape (a shop that really closed): one accepted run cannot expire anything —
  // a bike needs BIKE_MISS_RUNS accepted checks, a car CAR_ABSENT_RUNS.
  if (a.force) return { judged: true, accepted: true, reference, reason: `accepted by the operator (--accept)${reference !== null ? `, fresh ${a.count} vs reference ${reference}` : ''}` }
  if (!(a.count > 0)) return { judged: false, accepted: false, reference, reason: 'empty scrape — nothing is judged on it (--accept <source> if the source really has nothing)' }
  if (reference === null) return { judged: false, accepted: true, reference: null, reason: `no baseline yet — fresh ${a.count} is recorded as one; nothing expires on this run` }
  if (a.count < PRESENCE_MIN_SHARE * reference && reference - a.count > PRESENCE_ABS_SLACK) {
    return { judged: false, accepted: false, reference, reason: `fresh ${a.count} < ${PRESENCE_MIN_SHARE * 100}% of the reference ${reference} — a short scrape expires nothing` }
  }
  return { judged: true, accepted: true, reference, reason: `fresh ${a.count} ≥ ${PRESENCE_MIN_SHARE * 100}% of the reference ${reference}` }
}

// ── The presence history: one entry per applied run ───────────────────────────────────────────────

export const PRESENCE_KIND = 'vehicle-presence'
export const PRESENCE_VERSION = 1
/** `forced`: the operator accepted this run (--accept) — it resets the count guard's reference window. */
export type PresenceSource = { scrapedAt: string; count: number; accepted: boolean; forced?: boolean; present: string[] }
export type PresenceEntry = { kind: typeof PRESENCE_KIND; version: typeof PRESENCE_VERSION; recordedAt: string; sources: Record<string, PresenceSource> }
/** One source in one run: when its scrape was taken, how many in-scope rows it listed, and which were present. */
export type SourceRun = { scrapedAt: number; count: number; accepted: boolean; forced?: boolean; present: ReadonlySet<string> }

/** An entry read back from disk, or null when it is not one (never half-trusted). */
export function parsePresenceEntry(raw: unknown): PresenceEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<PresenceEntry>
  if (e.kind !== PRESENCE_KIND || e.version !== PRESENCE_VERSION || typeof e.recordedAt !== 'string' || !Number.isFinite(Date.parse(e.recordedAt))
    || !e.sources || typeof e.sources !== 'object') return null
  for (const s of Object.values(e.sources)) {
    if (!s || typeof s !== 'object' || !Number.isFinite(Date.parse(s.scrapedAt)) || !Number.isInteger(s.count) || s.count < 0
      || typeof s.accepted !== 'boolean' || (s.forced !== undefined && typeof s.forced !== 'boolean')
      || !Array.isArray(s.present) || s.present.some((x) => typeof x !== 'string')) return null
  }
  return e as PresenceEntry
}

/**
 * Every recorded run of `source`, newest first. Two entries for the SAME scrape (a re-run of the import on a scrape
 * already recorded) count once — the later-recorded one — so a retried import cannot add a bike's missed check.
 */
export function recordedRuns(source: string, entries: readonly PresenceEntry[]): SourceRun[] {
  const byScrape = new Map<number, { recordedAt: number; run: SourceRun }>()
  for (const e of entries) {
    const s = e.sources[source]
    if (!s) continue
    const at = Date.parse(s.scrapedAt), rec = Date.parse(e.recordedAt)
    const prev = byScrape.get(at)
    if (prev && !(rec > prev.recordedAt)) continue
    byScrape.set(at, { recordedAt: rec, run: { scrapedAt: at, count: s.count, accepted: s.accepted, forced: s.forced === true, present: new Set(s.present) } })
  }
  return [...byScrape.values()].map((x) => x.run).sort((a, b) => b.scrapedAt - a.scrapedAt)
}

/**
 * The guard for this run of `source` against what is recorded: earlier runs of the same scrape are ignored (this run
 * replaces them), any recorded scrape NEWER than this one refuses it, and so does a scrape older than
 * MAX_SCRAPE_AGE_DAYS at `now`. ⛔ AN OPERATOR-ACCEPTED (forced) RUN STARTS THE REFERENCE OVER: the window is the
 * accepted runs back to the newest forced one, so "VEH_ACCEPT=<source> for one run" really does accept a lower level
 * (review 2026-10-13: with the plain max-of-3 the next run was refused again against the old high).
 */
export function guardFor(
  source: string, entries: readonly PresenceEntry[], current: { scrapedAt: number; count: number }, fallback: number | null, force: boolean, now?: number,
): { guard: Guard; prior: SourceRun[] } {
  const prior = recordedRuns(source, entries).filter((r) => r.scrapedAt !== current.scrapedAt)
  const newest = prior.every((r) => r.scrapedAt < current.scrapedAt)
  const accepted = prior.filter((r) => r.accepted)
  const lastForced = accepted.findIndex((r) => r.forced)
  const window = lastForced >= 0 ? accepted.slice(0, lastForced + 1) : accepted
  const ageDays = now === undefined ? undefined : (now - current.scrapedAt) / DAY_MS
  const guard = presenceGuard({ count: current.count, priorAccepted: window.map((r) => r.count), fallback, force, newest, ageDays })
  return { guard, prior }
}

/**
 * How many of the newest ACCEPTED runs in a row a bike is missing from, and the days from the oldest of those to
 * the newest. `runs` = accepted runs, newest first, this run first.
 */
export function missStreak(externalId: string, runs: readonly SourceRun[]): { streak: number; spanDays: number } {
  let streak = 0, oldest = NaN
  for (const r of runs) {
    if (r.present.has(externalId)) break
    streak++
    oldest = r.scrapedAt
  }
  return { streak, spanDays: streak ? (runs[0].scrapedAt - oldest) / DAY_MS : 0 }
}

// ── What a scrape says about presence ─────────────────────────────────────────────────────────────

/**
 * Per HCMC shop: how many bikes it lists (the count guard's number), which are PRESENT — listed and not out of stock
 * (only Jan's reports stock; "listed" / "unknown" count as present) — and when the scrape was taken.
 * Keys are the importer's externalIds (`<shop>:<external_id>`).
 */
export function bikePresence(records: readonly Record<string, unknown>[], fallbackAt: number): Record<ShopKey, { count: number; present: Set<string>; scrapedAt: number }> {
  const out = Object.fromEntries(SHOP_KEYS.map((s) => [s, { count: 0, present: new Set<string>(), scrapedAt: -Infinity }])) as Record<ShopKey, { count: number; present: Set<string>; scrapedAt: number }>
  const seen = new Set<string>()
  for (const r of records) {
    const shop = r.shop as ShopKey
    if (!(SHOP_KEYS as readonly string[]).includes(shop) || !/Ho Chi Minh/.test(String(r.city ?? ''))) continue
    const ext = typeof r.external_id === 'string' ? r.external_id.trim() : ''
    if (!BIKE_EXTERNAL_ID.test(ext)) continue
    const key = `${shop}:${ext}`
    if (seen.has(key)) continue
    seen.add(key)
    const o = out[shop]
    o.count++
    if (!/out of stock/i.test(String(r.availability ?? ''))) o.present.add(key)
    const t = typeof r.scraped_at === 'string' ? Date.parse(r.scraped_at) : NaN
    if (Number.isFinite(t) && t > o.scrapedAt) o.scrapedAt = t
  }
  for (const s of SHOP_KEYS) if (!Number.isFinite(out[s].scrapedAt)) out[s].scrapedAt = fallbackAt
  return out
}

/** The latest parseable `scraped_at` among records, else `fallback` (ms). */
export function latestScrapedAt(records: readonly Record<string, unknown>[], fallback: number): number {
  let at = -Infinity
  for (const r of records) {
    const t = typeof r.scraped_at === 'string' ? Date.parse(r.scraped_at) : NaN
    if (Number.isFinite(t) && t > at) at = t
  }
  return Number.isFinite(at) ? at : fallback
}

// ── The plan ──────────────────────────────────────────────────────────────────────────────────────

export type DbRow = { id: string; externalId: string | null; status: string; seller: SellerKey; subcat: string | null }
/** `code` is the stable outcome key (a reliability reason, 'absent', 'missing', 'revived'); `reason` the sentence for the journal. */
export type Move = { id: string; externalId: string; seller: SellerKey; from: string; to: string; code: string; reason: string }
export type PlanInput = {
  /** Every imported row of the vehicle storefronts, any status. */
  rows: readonly DbRow[]
  /**
   * Only the car sources this run loaded: `judged` from presenceGuard; a verdict per HCMC record (absent = not
   * listed); `runs` = ACCEPTED runs newest first with this run first (when accepted) — the absence streak reads them.
   */
  cars: Partial<Record<CarSource, { judged: boolean; verdicts: ReadonlyMap<string, Verdict>; runs: readonly SourceRun[] }>>
  /**
   * Only the shops this run loaded: `judged` from presenceGuard; `runs` = ACCEPTED runs newest first with this run
   * first (when accepted); `present` = this run's present set, accepted or not (revival reads it).
   */
  bikes: Partial<Record<ShopKey, { judged: boolean; runs: readonly SourceRun[]; present: ReadonlySet<string> }>>
  /** externalIds this run's import created, refreshed or found unchanged — the only rows that may be revived. */
  ready: ReadonlySet<string>
  /** Sources whose expire-share guard the operator overrides (--accept). */
  force?: ReadonlySet<string>
}
export type Plan = {
  expire: Move[]
  revive: Move[]
  /** Per source: outcome → rows (keep, held reasons, untouched statuses), for the report. */
  tally: Record<string, Record<string, number>>
  /** Sources whose expiries the expire-share guard dropped this run, with why. */
  refused: Record<string, string>
}

const isCar = (s: SellerKey): s is CarSource => (CAR_SOURCES as readonly string[]).includes(s)
const isShop = (s: SellerKey): s is ShopKey => (SHOP_KEYS as readonly string[]).includes(s)

export function planVehicleStatus(input: PlanInput): Plan {
  const expire: Move[] = [], revive: Move[] = []
  const tally: Record<string, Record<string, number>> = {}
  const refused: Record<string, string> = {}
  const count = (seller: string, outcome: string) => { const t = (tally[seller] ??= {}); t[outcome] = (t[outcome] ?? 0) + 1 }
  const activeBy = new Map<string, number>()

  for (const row of input.rows) {
    const s = row.seller
    const car = isCar(s) ? input.cars[s] : undefined
    const bike = isShop(s) ? input.bikes[s] : undefined
    if (!car && !bike) continue // a source this run did not load: untouched, not counted
    if (row.status !== ACTIVE_STATUS && row.status !== EXPIRED_STATUS) { count(s, `untouched: ${row.status}`); continue }
    if (!row.externalId) { count(s, 'untouched: no externalId'); continue }
    if (row.subcat !== (car ? CAR_SUBCAT : BIKE_SUBCAT)) { count(s, `untouched: subcategory ${row.subcat ?? '(none)'}`); continue }
    const ext = row.externalId
    const move = (to: string, code: string, reason: string): Move => ({ id: row.id, externalId: ext, seller: s, from: row.status, to, code, reason })
    if (row.status === ACTIVE_STATUS) activeBy.set(s, (activeBy.get(s) ?? 0) + 1)

    if (car) {
      const v = car.verdicts.get(ext)
      if (row.status === ACTIVE_STATUS) {
        if (v?.kind === 'keep') { count(s, 'keep'); continue }
        if (v?.kind === 'unknown') { count(s, `held: not judged (${v.reason})`); continue }
        if (!car.judged) { count(s, `held: ${v ? v.reason : 'absent'}, scrape not judged`); continue }
        if (v) { expire.push(move(EXPIRED_STATUS, v.reason, `${v.reason}: ${v.detail}`)); continue }
        const m = missStreak(ext, car.runs)
        if (m.streak >= CAR_ABSENT_RUNS && m.spanDays >= CAR_ABSENT_MIN_SPAN_DAYS) {
          expire.push(move(EXPIRED_STATUS, 'absent', `absent from the source’s HCMC listing in its last ${m.streak} complete scrapes over ${m.spanDays.toFixed(1)} days`))
        } else count(s, `held: absent from ${m.streak} scrape(s) — booked out, or gone (the gone probe decides that)`)
        continue
      }
      // expired
      if (v?.kind === 'keep' && input.ready.has(ext)) { revive.push(move(ACTIVE_STATUS, 'qualifies', `qualifies again: ${v.detail}`)); continue }
      count(s, v?.kind === 'keep' ? 'stays expired: qualifies, not refreshed this run' : `stays expired: ${v ? v.reason : 'absent'}`)
      continue
    }

    // bike
    const b = bike!
    if (row.status === ACTIVE_STATUS) {
      if (!b.judged) { count(s, b.present.has(ext) ? 'keep' : 'held: scrape not judged'); continue }
      const m = missStreak(ext, b.runs)
      if (m.streak >= BIKE_MISS_RUNS && m.spanDays >= BIKE_MISS_MIN_SPAN_DAYS) {
        expire.push(move(EXPIRED_STATUS, 'missing', `missing from the shop's last ${m.streak} checks over ${m.spanDays.toFixed(1)} days`))
        continue
      }
      count(s, m.streak ? `keep: missing ${m.streak} check(s)` : 'keep')
      continue
    }
    if (b.present.has(ext) && input.ready.has(ext)) { revive.push(move(ACTIVE_STATUS, 'listed', 'listed again')); continue }
    count(s, b.present.has(ext) ? 'stays expired: listed, not refreshed this run' : 'stays expired: not listed')
  }

  // ⛔ The expire-share guard, per source, after the plan is whole.
  const kept: Move[] = []
  const bySource = new Map<string, Move[]>()
  for (const m of expire) (bySource.get(m.seller) ?? bySource.set(m.seller, []).get(m.seller)!).push(m)
  for (const [s, moves] of bySource) {
    const active = activeBy.get(s) ?? 0
    if (active >= EXPIRE_SHARE_FLOOR && moves.length > MAX_EXPIRE_SHARE * active && !input.force?.has(s)) {
      refused[s] = `would expire ${moves.length} of ${active} live rows (> ${MAX_EXPIRE_SHARE * 100}%) in one run — refused; a fault upstream looks like this (--accept ${s} after checking)`
      for (const m of moves) count(s, `held: expire-share guard (${m.code})`)
      continue
    }
    kept.push(...moves)
    for (const m of moves) count(s, `expire: ${m.code}`)
  }
  for (const m of revive) count(m.seller, `revive: ${m.code}`)
  return { expire: kept, revive, tally, refused }
}
