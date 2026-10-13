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
 * is churn, not a broken scrape, and a refusal there would repeat on every run. An unjudged source expires nothing;
 * a short run is recorded as NOT accepted, so it neither becomes a reference nor counts as a MISSED check — but a row
 * it does list still counts as SEEN (review 2026-10-13: a bike listed in a short scrape was counted missing across
 * it, and expired 6 days after it was last seen). Revival needs no judging: it acts only on POSITIVE evidence (the
 * car's own record, the bike's own listing) — from a FRESH scrape (not older than the last recorded, not stale).
 * ⛔ NO SOURCE SHRINKS OR GROWS BY MORE THAN HALF ITS LIVE ROWS IN ONE RUN. Expiries above
 * max(EXPIRE_ALLOWANCE, MAX_EXPIRE_SHARE × live), or of ALL its live rows, are held — a small shop too (review
 * 2026-10-13: under 20 live rows there was no cap, and a 14-bike shop could lose every row with no alert); the
 * importer's creations (scripts/import-vehicle-rentals.ts) and the revivals TOGETHER above
 * max(GROWTH_ALLOWANCE, MAX_GROWTH_SHARE × live before the run) are held — one budget, an import retry included — as
 * a broken trips history or a fleet flag read wrong passes cars in bulk, and nothing limited that before (review
 * 2026-10-13). The count guard cannot see a scrape whose count is whole but whose
 * fields are garbage — these catch the shape such a fault produces. --accept <source> overrides all of them for an
 * operator holding independent evidence (even an empty scrape: a closed shop); nothing overrides a scrape older than
 * the last recorded. ⚠️ 'expired' IS REVIVABLE BY DESIGN: a car taken down by hand with scripts/expire-rentals.ts
 * comes back once it passes the rule again — to keep a row down for good, hide it ('hidden' is never revived).
 */
import { EXPIRED_STATUS } from './apartment-freshness'
import { SHOP_KEYS, type SellerKey, type ShopKey } from './vehicle-rental-listing'
import { SCRAPE_TIME_QUANTILE, type Verdict } from './vehicle-reliability'

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
/**
 * A scrape stamped further ahead of the clock than this is a skewed clock, not a check: refused, never clamped —
 * a clamped stamp would turn ONE scrape into a "new" check on every re-import of it (review 2026-10-13).
 */
export const FUTURE_SCRAPE_TOLERANCE_DAYS = 10 / 1440
/** A car is expired for ABSENCE only after this many complete scrapes in a row without it… */
export const CAR_ABSENT_RUNS = 2
/** …spanning at least this many days (two runs of a failed-then-retried day do not count twice). */
export const CAR_ABSENT_MIN_SPAN_DAYS = 2
/** A source may lose at most this share of its live rows in one run… */
export const MAX_EXPIRE_SHARE = 0.5
/** …or this many, whichever is more — and never its whole live list at once (a 1-row source keeps its row until accepted). */
export const EXPIRE_ALLOWANCE = 3
/** A source may gain (revive, or the importer create) at most this share of its live rows in one run… */
export const MAX_GROWTH_SHARE = 0.5
/** …or this many, whichever is more (a few new listings on a small or empty source are normal). */
export const GROWTH_ALLOWANCE = 20
export const CAR_SOURCES = ['mioto', 'bonboncar'] as const
export type CarSource = (typeof CAR_SOURCES)[number]
export const CAR_SUBCAT = 'car-rental'
export const BIKE_SUBCAT = 'motorbike-rental'
/** A shop's product id as the importer accepts it (stageShopBike). */
const BIKE_EXTERNAL_ID = /^[A-Za-z0-9_.-]{1,80}$/
const DAY_MS = 86_400_000

// ── The count guard ───────────────────────────────────────────────────────────────────────────────

export type Guard = { judged: boolean; accepted: boolean; fresh: boolean; reference: number | null; reason: string }

/**
 * Is this run's scrape of ONE source whole enough to expire on?
 *   · `judged`   — its absences and failures may expire rows this run.
 *   · `accepted` — its count may be a later run's reference and its presence a bike's checked run.
 *   · `fresh`    — it is THIS run's evidence: newer than every recorded scrape, not stale, not stamped in the future.
 *                  Only a fresh scrape revives anything (a re-imported old dataset is last month's listing).
 * @param priorAccepted counts of earlier ACCEPTED runs of this source, newest first.
 * @param fallback the weekly baseline's count (vehicle-rentals-gone.py's `latest/`) when no run is recorded yet.
 * @param newest false when a scrape of this source newer than this one is already recorded.
 */
export function presenceGuard(a: { count: number; priorAccepted: readonly number[]; fallback: number | null; force?: boolean; newest?: boolean; ageDays?: number }): Guard {
  if (a.newest === false) return { judged: false, accepted: false, fresh: false, reference: null, reason: 'a newer scrape of this source is already recorded — refusing to go back in time' }
  if (a.ageDays !== undefined && !(a.ageDays <= MAX_SCRAPE_AGE_DAYS)) {
    return { judged: false, accepted: false, fresh: false, reference: null, reason: `the scrape is ${Number.isFinite(a.ageDays) ? a.ageDays.toFixed(1) : '?'} days old (> ${MAX_SCRAPE_AGE_DAYS}) — a re-used dataset is not a new check` }
  }
  if (a.ageDays !== undefined && a.ageDays < -FUTURE_SCRAPE_TOLERANCE_DAYS) {
    return { judged: false, accepted: false, fresh: false, reference: null, reason: `the scrape is stamped ${(-a.ageDays * 24).toFixed(1)} h in the future — a skewed clock; nothing is judged on it` }
  }
  const recent = a.priorAccepted.slice(0, PRESENCE_BASELINE_RUNS)
  const reference = recent.length ? Math.max(...recent) : a.fallback
  // --accept even takes an EMPTY scrape (a shop that really closed): one accepted run cannot expire anything —
  // a bike needs BIKE_MISS_RUNS accepted checks, a car CAR_ABSENT_RUNS.
  if (a.force) return { judged: true, accepted: true, fresh: true, reference, reason: `accepted by the operator (--accept)${reference !== null ? `, fresh ${a.count} vs reference ${reference}` : ''}` }
  if (!(a.count > 0)) return { judged: false, accepted: false, fresh: true, reference, reason: 'empty scrape — nothing is judged on it (--accept <source> if the source really has nothing)' }
  if (reference === null) return { judged: false, accepted: true, fresh: true, reference: null, reason: `no baseline yet — fresh ${a.count} is recorded as one; nothing expires on this run` }
  if (a.count < PRESENCE_MIN_SHARE * reference && reference - a.count > PRESENCE_ABS_SLACK) {
    return { judged: false, accepted: false, fresh: true, reference, reason: `fresh ${a.count} < ${PRESENCE_MIN_SHARE * 100}% of the reference ${reference} — a short scrape expires nothing` }
  }
  return { judged: true, accepted: true, fresh: true, reference, reason: `fresh ${a.count} ≥ ${PRESENCE_MIN_SHARE * 100}% of the reference ${reference}` }
}

/**
 * Why `n` expiries are too many for a source with `live` live rows in one run, or null: more than half of them (at
 * least EXPIRE_ALLOWANCE may go) — and never ALL of them (gate review: max(3, 50%) let a 1-3-row source empty out).
 */
export function shrinkRefusal(n: number, live: number): string | null {
  if (!(n > 0)) return null
  const cap = Math.min(live - 1, Math.max(EXPIRE_ALLOWANCE, MAX_EXPIRE_SHARE * live))
  return n > cap
    ? `would expire ${n} of ${live} live rows (> ${Math.max(cap, 0)}: ${MAX_EXPIRE_SHARE * 100}%, at least ${EXPIRE_ALLOWANCE}, never all) in one run — refused; a fault upstream looks like this`
    : null
}

/**
 * Why `n` revivals or creations are too many for a source with `live` live rows BEFORE the run, or null. ⛔ ONE
 * BUDGET: `already` = the rows this run already added the other way (the importer's creations, when judging the
 * revivals), so creations and revivals together stay within max(GROWTH_ALLOWANCE, MAX_GROWTH_SHARE × live) — not
 * half each (gate review: 380 created + 380 revived on 761 live passed unrefused).
 */
export function growthRefusal(kind: 'revive' | 'create', n: number, live: number, already = 0): string | null {
  const cap = Math.max(GROWTH_ALLOWANCE, MAX_GROWTH_SHARE * live)
  return n + already > cap
    ? `would ${kind} ${n} rows${already ? ` (+ ${already} created)` : ''} against ${live} live (> ${cap}: ${MAX_GROWTH_SHARE * 100}% or ${GROWTH_ALLOWANCE}) in one run — refused; a broken trips history or a field read wrong passes cars in bulk like this`
    : null
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
 * already recorded) count once, so a retried import cannot add a bike's missed check: the ACCEPTED one, else the
 * later-recorded one — a re-import refused only for being stale must not un-accept the check that scrape was.
 */
export function recordedRuns(source: string, entries: readonly PresenceEntry[]): SourceRun[] {
  const byScrape = new Map<number, { recordedAt: number; run: SourceRun }>()
  for (const e of entries) {
    const s = e.sources[source]
    if (!s) continue
    const at = Date.parse(s.scrapedAt), rec = Date.parse(e.recordedAt)
    const prev = byScrape.get(at)
    if (prev && (prev.run.accepted !== s.accepted ? prev.run.accepted : !(rec > prev.recordedAt))) continue
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
 * `runs` — this run and every recorded one, accepted or not, newest first, without runs stamped in the future: what
 * missStreak reads (a short run's sightings count, its misses do not).
 */
export function guardFor(
  source: string, entries: readonly PresenceEntry[], current: { scrapedAt: number; count: number; present?: ReadonlySet<string> }, fallback: number | null, force: boolean, now?: number,
): { guard: Guard; prior: SourceRun[]; runs: SourceRun[] } {
  const prior = recordedRuns(source, entries).filter((r) => r.scrapedAt !== current.scrapedAt)
  const accepted = prior.filter((r) => r.accepted)
  // Any recorded scrape newer than this one refuses it (no going back in time) — except one stamped in the FUTURE at
  // `now`: a skewed clock's run, refused when it came, must not block every real scrape until the clock catches up.
  const skewed = (r: { scrapedAt: number }) => now !== undefined && r.scrapedAt - now > FUTURE_SCRAPE_TOLERANCE_DAYS * DAY_MS
  const newest = prior.every((r) => skewed(r) || r.scrapedAt < current.scrapedAt)
  const lastForced = accepted.findIndex((r) => r.forced)
  const window = lastForced >= 0 ? accepted.slice(0, lastForced + 1) : accepted
  const ageDays = now === undefined ? undefined : (now - current.scrapedAt) / DAY_MS
  const guard = presenceGuard({ count: current.count, priorAccepted: window.map((r) => r.count), fallback, force, newest, ageDays })
  const thisRun: SourceRun = { scrapedAt: current.scrapedAt, count: current.count, accepted: guard.accepted, forced: guard.accepted && force, present: current.present ?? new Set() }
  const runs = [thisRun, ...prior].filter((r) => !skewed(r)).sort((a, b) => b.scrapedAt - a.scrapedAt)
  return { guard, prior, runs }
}

/**
 * How many ACCEPTED checks in a row, newest first, a row is missing from — and the days from the newest of those
 * misses to the oldest. `runs` = every run of the source, newest first (guardFor's `runs`): a run that was NOT
 * accepted (a short scrape) is no missed check, but a row it lists was SEEN there, which ends the streak.
 */
export function missStreak(externalId: string, runs: readonly SourceRun[]): { streak: number; spanDays: number } {
  let streak = 0, newest = NaN, oldest = NaN
  for (const r of runs) {
    if (r.present.has(externalId)) break
    if (!r.accepted) continue
    if (!streak) newest = r.scrapedAt
    streak++
    oldest = r.scrapedAt
  }
  return { streak, spanDays: streak ? (newest - oldest) / DAY_MS : 0 }
}

// ── What a scrape says about presence ─────────────────────────────────────────────────────────────

/**
 * Per HCMC shop: how many bikes it lists (the count guard's number), which are PRESENT — listed and not out of stock
 * (only Jan's reports stock; "listed" / "unknown" count as present) — and when the scrape was taken: its EARLIEST
 * listings' `scraped_at` (the 1st percentile, as for the cars — gate review: the latest let one fresh listing make a
 * shop's old dataset look fresh). Keys are the importer's externalIds (`<shop>:<external_id>`).
 */
export function bikePresence(records: readonly Record<string, unknown>[], fallbackAt: number): Record<ShopKey, { count: number; present: Set<string>; scrapedAt: number }> {
  const out = Object.fromEntries(SHOP_KEYS.map((s) => [s, { count: 0, present: new Set<string>(), scrapedAt: -Infinity }])) as Record<ShopKey, { count: number; present: Set<string>; scrapedAt: number }>
  const times = Object.fromEntries(SHOP_KEYS.map((s) => [s, [] as number[]])) as Record<ShopKey, number[]>
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
    if (Number.isFinite(t) && t > 0) times[shop].push(t)
  }
  for (const s of SHOP_KEYS) {
    const ts = times[s].sort((a, b) => a - b)
    if (ts.length) out[s].scrapedAt = ts[Math.floor(SCRAPE_TIME_QUANTILE * (ts.length - 1))]
  }
  // A shop listing nothing: this run's empty scrape (`fallbackAt`, the caller's now — --accept can take a closed shop).
  // A shop whose listings carry no scrape time: stale (0) — never judged, never fresh (gate review: "now" let an
  // undated dataset pass for a fresh check).
  for (const s of SHOP_KEYS) if (!Number.isFinite(out[s].scrapedAt)) out[s].scrapedAt = out[s].count > 0 ? 0 : fallbackAt
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

// ── The status journal (written by scripts/vehicle-rentals-status.ts applyMoves) ───────────────────

export const STATUS_JOURNAL_KIND = 'vehicle-status'
export type StatusJournalRow = { id: string; externalId: string; seller: string; from: string; to: string; updatedAt: string; code: string; reason: string }
export type StatusJournal = { kind: typeof STATUS_JOURNAL_KIND; version: 1; createdAt: string; stamp: string; rows: StatusJournalRow[] }
/** A Postgres `timestamp::text` ('2026-10-13 06:55:46.738'), the only time shape the journal stores — and a real date. */
const isPgTimestamp = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(v)) return false
  // Round trip, not just "parses": V8 rolls 2026-02-31 over into March instead of refusing it.
  const t = Date.parse(`${v.slice(0, 19).replace(' ', 'T')}Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === v.slice(0, 19).replace(' ', 'T')
}

/**
 * Why a status journal is refused, or null. ⛔ Whole or nothing, before any database work: every row must be the
 * shape applyMoves wrote — a listing id, one of the two moves, a real timestamp, a non-empty externalId and one of
 * the vehicle storefronts (own keys only), with no id twice.
 */
export function statusJournalProblem(raw: unknown, sellers: Readonly<Record<string, unknown>>): string | null {
  if (!raw || typeof raw !== 'object') return 'not an object'
  const j = raw as Partial<StatusJournal>
  if (j.kind !== STATUS_JOURNAL_KIND || j.version !== 1) return `not a ${STATUS_JOURNAL_KIND} v1 journal`
  if (!isPgTimestamp(j.stamp)) return 'stamp is not a timestamp'
  if (!Array.isArray(j.rows)) return 'rows is not a list'
  const ids = new Set<string>()
  for (const [i, r] of j.rows.entries()) {
    if (!r || typeof r !== 'object') return `row ${i} is not an object`
    if (typeof r.id !== 'string' || !/^c[a-z0-9]{20,30}$/.test(r.id)) return `row ${i}: bad id`
    if (ids.has(r.id)) return `row ${i}: ${r.id} twice`
    ids.add(r.id)
    if (!((r.from === ACTIVE_STATUS && r.to === EXPIRED_STATUS) || (r.from === EXPIRED_STATUS && r.to === ACTIVE_STATUS))) return `row ${i}: not an expiry or a revival`
    if (!isPgTimestamp(r.updatedAt)) return `row ${i}: updatedAt is not a timestamp`
    if (typeof r.externalId !== 'string' || !r.externalId.trim()) return `row ${i}: no externalId`
    if (typeof r.seller !== 'string' || !Object.hasOwn(sellers, r.seller)) return `row ${i}: not a vehicle storefront`
  }
  return null
}

// ── The plan ──────────────────────────────────────────────────────────────────────────────────────

export type DbRow = { id: string; externalId: string | null; status: string; seller: SellerKey; subcat: string | null }
/** `code` is the stable outcome key (a reliability reason, 'absent', 'missing', 'revived'); `reason` the sentence for the journal. */
export type Move = { id: string; externalId: string; seller: SellerKey; from: string; to: string; code: string; reason: string }
export type PlanInput = {
  /** Every imported row of the vehicle storefronts, any status. */
  rows: readonly DbRow[]
  /**
   * Only the car sources this run loaded: `judged` / `fresh` from presenceGuard (fresh defaults to true); a verdict
   * per HCMC record (absent = not listed); `runs` = guardFor's runs (all, newest first) — the absence streak reads them.
   */
  cars: Partial<Record<CarSource, { judged: boolean; fresh?: boolean; verdicts: ReadonlyMap<string, Verdict>; runs: readonly SourceRun[] }>>
  /**
   * Only the shops this run loaded: `judged` / `fresh` from presenceGuard; `runs` = guardFor's runs (all, newest
   * first); `present` = this run's present set, accepted or not (revival reads it).
   */
  bikes: Partial<Record<ShopKey, { judged: boolean; fresh?: boolean; runs: readonly SourceRun[]; present: ReadonlySet<string> }>>
  /** externalIds this run's import created, refreshed or found unchanged — the only rows that may be revived. */
  ready: ReadonlySet<string>
  /** Sources whose shrink / growth guards the operator overrides (--accept). */
  force?: ReadonlySet<string>
  /**
   * Per source, from the importer: its live rows BEFORE this run and the rows its import CREATED — the growth guard
   * then holds revivals that would take creations + revivals past one budget. Without it, the plan's live count.
   */
  growth?: Readonly<Partial<Record<string, { liveBefore: number; created: number }>>>
  /** Sources refused upstream this run (the importer held their creations): nothing of theirs moves either. */
  held?: ReadonlySet<string>
}
export type Plan = {
  expire: Move[]
  revive: Move[]
  /** Per source: outcome → rows (keep, held reasons, untouched statuses), for the report. */
  tally: Record<string, Record<string, number>>
  /** Sources whose expiries or revivals a guard held this run, with why. */
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
      if (v?.kind === 'keep' && input.ready.has(ext) && car.fresh !== false) { revive.push(move(ACTIVE_STATUS, 'qualifies', `qualifies again: ${v.detail}`)); continue }
      count(s, v?.kind === 'keep'
        ? (car.fresh === false ? 'stays expired: qualifies in a stale scrape' : 'stays expired: qualifies, not refreshed this run')
        : `stays expired: ${v ? v.reason : 'absent'}`)
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
    if (b.present.has(ext) && input.ready.has(ext) && b.fresh !== false) { revive.push(move(ACTIVE_STATUS, 'listed', 'listed again')); continue }
    count(s, !b.present.has(ext) ? 'stays expired: not listed' : b.fresh === false ? 'stays expired: listed in a stale scrape' : 'stays expired: listed, not refreshed this run')
  }

  // ⛔ The shrink and growth guards, per source, after the plan is whole (refused messages of one source are joined).
  // A source refused by either — or held upstream (the importer held its creations) — moves NOTHING this run: a run
  // that looks this wrong is not trusted for its other moves either, and runStatusStep records its scrape as no check
  // (gate review: a held spike was still recorded as an accepted run, and became the next runs' reference).
  const refuse = (s: string, why: string) => { refused[s] = refused[s] ? `${refused[s]}; ${why}` : why }
  const bySeller = (moves: readonly Move[]) => {
    const by = new Map<string, Move[]>()
    for (const m of moves) (by.get(m.seller) ?? by.set(m.seller, []).get(m.seller)!).push(m)
    return by
  }
  const shrinkHeld = new Set<string>(), growthHeld = new Set<string>()
  for (const [s, moves] of bySeller(expire)) {
    const why = input.force?.has(s) ? null : shrinkRefusal(moves.length, activeBy.get(s) ?? 0)
    if (why) { refuse(s, `${why} (--accept ${s} after checking)`); shrinkHeld.add(s) }
  }
  for (const [s, moves] of bySeller(revive)) {
    const g = input.growth?.[s]
    const why = input.force?.has(s) ? null : g ? growthRefusal('revive', moves.length, g.liveBefore, g.created) : growthRefusal('revive', moves.length, activeBy.get(s) ?? 0)
    if (why) { refuse(s, `${why} (--accept ${s} after checking)`); growthHeld.add(s) }
  }
  const stopped = (s: string) => shrinkHeld.has(s) || growthHeld.has(s) || !!input.held?.has(s)
  const keptExpire: Move[] = [], keptRevive: Move[] = []
  for (const m of expire) {
    if (!stopped(m.seller)) { keptExpire.push(m); count(m.seller, `expire: ${m.code}`); continue }
    count(m.seller, shrinkHeld.has(m.seller) ? `held: expire-share guard (${m.code})` : `held: source refused this run (${m.code})`)
  }
  for (const m of revive) {
    if (!stopped(m.seller)) { keptRevive.push(m); count(m.seller, `revive: ${m.code}`); continue }
    count(m.seller, growthHeld.has(m.seller) ? `held: growth guard (${m.code})` : `held: source refused this run (${m.code})`)
  }
  return { expire: keptExpire, revive: keptRevive, tally, refused }
}

// ── Wiring: what this scrape says → the plan's input and the run record ───────────────────────────

/** What one scrape says about a car source (the importer's stageAll): a verdict per HCMC record, and when it was taken. */
export type CarPresence = { verdicts: ReadonlyMap<string, Verdict>; scrapedAt: number }
/** …and about one shop: how many HCMC bikes it lists, which are present (listed and in stock), and when. */
export type ShopPresence = { count: number; present: ReadonlySet<string>; scrapedAt: number }

/**
 * Per loaded source: its guard against the recorded runs, the plan's input (this run combined with every recorded
 * run — guardFor's `runs`), and this run's entry for the presence history. Only the sources given are touched.
 */
export function statusInputs(a: {
  cars: Partial<Record<CarSource, CarPresence>>
  bikes: Partial<Record<ShopKey, ShopPresence>> | null
  entries: readonly PresenceEntry[]
  fallback: Readonly<Record<string, number>>
  accept: ReadonlySet<string>
  now: number
}): { cars: PlanInput['cars']; bikes: PlanInput['bikes']; current: PresenceEntry['sources']; guards: Record<string, Guard> } {
  const cars: PlanInput['cars'] = {}, bikes: PlanInput['bikes'] = {}
  const current: PresenceEntry['sources'] = {}, guards: Record<string, Guard> = {}
  const iso = (ms: number) => new Date(ms).toISOString()
  const one = (source: string, p: { scrapedAt: number; count: number; present: ReadonlySet<string> }) => {
    const { guard, runs } = guardFor(source, a.entries, p, a.fallback[source] ?? null, a.accept.has(source), a.now)
    guards[source] = guard
    current[source] = { scrapedAt: iso(p.scrapedAt), count: p.count, accepted: guard.accepted, forced: guard.accepted && a.accept.has(source), present: [...p.present] }
    return { guard, runs }
  }
  for (const src of CAR_SOURCES) {
    const p = a.cars[src]
    if (!p) continue
    const { guard, runs } = one(src, { scrapedAt: p.scrapedAt, count: p.verdicts.size, present: new Set(p.verdicts.keys()) })
    cars[src] = { judged: guard.judged, fresh: guard.fresh, verdicts: p.verdicts, runs }
  }
  for (const shop of SHOP_KEYS) {
    const p = a.bikes?.[shop]
    if (!p) continue
    const { guard, runs } = one(shop, p)
    bikes[shop] = { judged: guard.judged, fresh: guard.fresh, runs, present: p.present }
  }
  return { cars, bikes, current, guards }
}

/** The guards' refusals that matter: a source not accepted this run AND holding live rows its refusal leaves unjudged. */
export function guardRefusals(guards: Readonly<Record<string, Guard>>, liveSources: ReadonlySet<string>): string[] {
  return Object.entries(guards).filter(([s, g]) => !g.accepted && liveSources.has(s)).map(([s]) => `${s}: scrape not accepted (see its guard line)`)
}

/**
 * The importer's creations the growth guard holds, per source → why: more new rows than max(GROWTH_ALLOWANCE,
 * MAX_GROWTH_SHARE × live) in one run, unless the operator accepts the source. Creations are the half of growth the
 * status step never sees (a new row is created 'active'). `already` = rows an earlier attempt of THIS run created (the
 * job retries the import once): they count against the same budget.
 */
export function heldCreations(
  planned: ReadonlyMap<string, number>, live: ReadonlyMap<string, number>, accept: ReadonlySet<string>, already: ReadonlyMap<string, number> = new Map(),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [s, n] of planned) {
    const why = accept.has(s) ? null : growthRefusal('create', n, live.get(s) ?? 0, already.get(s) ?? 0)
    if (why) out[s] = `${why} (--accept ${s} after checking)`
  }
  return out
}

/**
 * The growth guard's baseline from the importer's stored rows: per source, the rows live BEFORE this run, and the rows
 * an earlier attempt of this run already created (createdAt at or after `runStart` — the job's start, VEH_RUN_START).
 * ⛔ Without it the job's one import retry would read the first attempt's creations as live rows and hand the
 * revivals a fresh, larger budget (gate review).
 */
export function growthBaseline(
  stored: Iterable<{ seller: string | undefined; status: string; createdAt: number }>, runStart: number,
): { liveBefore: Map<string, number>; createdEarlier: Map<string, number> } {
  const liveBefore = new Map<string, number>(), createdEarlier = new Map<string, number>()
  for (const r of stored) {
    if (!r.seller) continue
    if (Number.isFinite(runStart) && r.createdAt >= runStart) { createdEarlier.set(r.seller, (createdEarlier.get(r.seller) ?? 0) + 1); continue }
    if (r.status === 'active') liveBefore.set(r.seller, (liveBefore.get(r.seller) ?? 0) + 1)
  }
  return { liveBefore, createdEarlier }
}

/**
 * Each source's count in the gone helper's weekly baseline (`latest/`, parsed) — the guard's reference on the first
 * run. ⛔ Rows the helper carried forward WITHOUT seeing them (`_carried`) are not last run's scrape, so not counted.
 */
export function baselineCountsFrom(files: { mioto?: unknown; bonbon?: unknown; bikes?: unknown }): Record<string, number> {
  const out: Record<string, number> = {}
  const fresh = (v: unknown): Record<string, unknown>[] | null =>
    Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !(r as Record<string, unknown>)._carried) : null
  const m = fresh(files.mioto), b = fresh(files.bonbon), k = fresh(files.bikes)
  if (m) out.mioto = m.length
  if (b) out.bonboncar = b.length
  if (k) for (const s of SHOP_KEYS) out[s] = k.filter((r) => r.shop === s).length
  return out
}
