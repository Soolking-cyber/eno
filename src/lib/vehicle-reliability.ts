/**
 * WHICH IMPORTED CARS STAY LIVE — the owner's reliability rule, the pure half (no file, no database).
 *
 * Owner, 2026-10-13: "remove most of car rental leave only reliable fresh ones". Picked the same day:
 *   · Mioto     — totalTrips ≥ 10, rating ≥ 4.8, totalReviews ≥ 5, AND at least one trip completed in the
 *                 last ~14 days: totalTrips now > totalTrips in an earlier scrape (the TRIPS HISTORY below).
 *   · BonbonCar — its own fleet (is_b2b === false), ≥ 3 real photos (an image-model output size does not
 *                 count — GENERATED_DIMS), rating ≥ 4.
 * The same rule ran once by hand that day (scripts/expire-rentals.ts --vehicle-ids: 5,410 cars expired,
 * 976 kept); scripts/import-vehicle-rentals.ts applies it on every refresh — only a car that passes is
 * created or updated, and scripts/vehicle-rentals-status.ts expires the live ones that stop passing and
 * revives the expired ones that pass again (src/lib/vehicle-status-plan.ts).
 *
 * ⛔ THREE ANSWERS, NOT TWO. `keep`, `drop` (the record itself says no: 3 trips, 4.5★, a B2B car) and
 * `unknown` (this run could not judge it: no stats in the record, BonbonCar's detail page not read, or a
 * trips history too broken to prove anything). An unknown car is neither created, updated, expired nor
 * revived — a fetch failure is never evidence about the car.
 *
 * ⛔ THE 14-DAY TRIP TEST NEEDS A SNAPSHOT 12–21 DAYS OLD. The job writes one snapshot (id → totalTrips) per
 * scrape (scripts/vehicle-trips-history.ts, ~/eno-import-journals/vehicles/trips/<YYYY-MM-DD>.json, seeded from
 * the scraper's state/prev-<run>/details.jsonl). A car is compared with the NEWEST snapshot between
 * TRIPS_REFERENCE_MIN_DAYS and TRIPS_REFERENCE_MAX_DAYS old THAT HOLDS IT — on the 3-day cadence a 12–15-day
 * window. A car no such snapshot holds (listed under 12 days ago, or missed by every scrape in the window) does
 * NOT qualify, and its reason says so: it cannot prove a recent trip.
 *   · WHY PER CAR, NOT ONE SNAPSHOT FOR ALL: a scrape misses some cars (Mioto's search only shows a car free in
 *     one of the asked windows), so the newest old snapshot may lack a car an older one has. Falling back to the
 *     older one widens THAT car's window — up to 21 days, never further (review 2026-10-13: an unbounded fallback
 *     let a trip a month ago pass for "the last 14 days").
 *   · AN OUTAGE IS NOT THE CARS' FAULT: after a gap in runs no snapshot sits in the window for most cars — the
 *     health check below then reads the history as broken, and nothing is judged by the trip test (no mass expiry)
 *     until a fresh snapshot ages into the window.
 *   · ⛔ A HISTORY THAT CANNOT JUDGE IS NOT A VERDICT. When more than MAX_NO_REFERENCE_SHARE of the live HCMC cars
 *     have no old snapshot (a wiped or unseeded trips dir), "no reference" is the HISTORY's fault, not the cars':
 *     every such car becomes `unknown` and the run is flagged (miotoVerdicts → tripsHealthy: false).
 */
import { GENERATED_DIMS } from './vehicle-rental-listing'

export const MIOTO_MIN_TRIPS = 10
export const MIOTO_MIN_RATING = 4.8
export const MIOTO_MIN_REVIEWS = 5
/** The trip test compares with a snapshot at least this many days older than the record… */
export const TRIPS_REFERENCE_MIN_DAYS = 12
/** …and at most this many: 12–15 on the 3-day cadence, room for a car two scrapes in a row missed. */
export const TRIPS_REFERENCE_MAX_DAYS = 21
/**
 * Above this share of live HCMC cars without a snapshot in the window, the trips history is broken, not the cars.
 * Measured 2026-10-13: 319 of 5,637 (5.7%) on a single seeding snapshot — new listings and cars booked out of that
 * scrape. 20% leaves room for that and still freezes the trip test when a part of the history is lost (review
 * 2026-10-13: at 50%, a history missing 40% of its cars would have expired 40% of the fleet as "unproven").
 */
export const MAX_NO_REFERENCE_SHARE = 0.2
export const BONBON_MIN_REAL_PHOTOS = 3
export const BONBON_MIN_RATING = 4
/** The scrapes' own HCMC spellings (stageMioto / stageBonbon filter on exactly these). */
export const MIOTO_HCMC = 'TP. Hồ Chí Minh'
export const BONBON_HCMC = 'Hồ Chí Minh'
/** Mioto's ids and BonbonCar's SKUs as the importer accepts them (stageMioto / stageBonbon). */
export const MIOTO_ID = /^[A-Z0-9]{4,12}$/
export const BONBON_SKU = /^[A-Za-z0-9_.-]{2,40}$/
/**
 * A Mioto rating is an AVERAGE (4.8999999999999995, 4.866666666666666): a float a hair under the line must not
 * fail a car the site shows at 4.8. The 2026-10-13 one-off compared the raw average; this only absorbs float noise.
 */
const RATING_EPSILON = 1e-9
const DAY_MS = 86_400_000
/** Vietnam keeps no DST: snapshot file names are ICT calendar dates. */
const ICT_OFFSET_MS = 7 * 3_600_000

export type DropReason =
  | 'notActive' | 'fewTrips' | 'lowRating' | 'fewReviews' | 'noTripsReference' | 'noRecentTrip'
  | 'notOwnFleet' | 'fewRealPhotos' | 'noRating'
export type UnknownReason = 'noStats' | 'tripsHistoryUnusable' | 'noDetail'
export type Verdict =
  | { kind: 'keep'; detail: string }
  | { kind: 'drop'; reason: DropReason; detail: string }
  | { kind: 'unknown'; reason: UnknownReason; detail: string }

/** One scrape's trip counts: when it was taken (its EARLIEST fetch, ms) and Mioto id → totalTrips. */
export type TripsSnapshot = { takenAt: number; trips: ReadonlyMap<string, number> }

const keep = (detail: string): Verdict => ({ kind: 'keep', detail })
const drop = (reason: DropReason, detail: string): Verdict => ({ kind: 'drop', reason, detail })
const unknown = (reason: UnknownReason, detail: string): Verdict => ({ kind: 'unknown', reason, detail })

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
/** all_rentals.json carries the average as a number; a raw details.jsonl record as { avg }. */
const ratingOf = (v: unknown): number | null =>
  v && typeof v === 'object' ? num((v as { avg?: unknown }).avg) : num(v)
/** An ICT calendar date — the same date the snapshot's file is named by. */
const day = (ms: number) => new Date(ms + ICT_OFFSET_MS).toISOString().slice(0, 10)
const days = (ms: number) => (ms / DAY_MS).toFixed(1)

/** When the record was fetched (its detail fetch, else the build), else `fallback`. */
export function recordTime(r: Record<string, unknown>, fallback: number): number {
  for (const v of [r.detail_fetched_at, r.scraped_at, r._fetched_at]) {
    const t = typeof v === 'string' ? Date.parse(v) : NaN
    if (Number.isFinite(t) && t > 0) return t
  }
  return fallback
}

/**
 * The trips count this car had in the NEWEST snapshot taken between `minDays` and `maxDays` before `at` that
 * holds it, or null. Snapshots newer than that (this run's own, last run's) are never a reference, nor older ones.
 */
export function pickTripsReference(
  id: string, snapshots: readonly TripsSnapshot[], at: number,
  minDays: number = TRIPS_REFERENCE_MIN_DAYS, maxDays: number = TRIPS_REFERENCE_MAX_DAYS,
): { takenAt: number; trips: number } | null {
  const cutoff = at - minDays * DAY_MS, floor = at - maxDays * DAY_MS
  let best: { takenAt: number; trips: number } | null = null
  for (const s of snapshots) {
    if (!(s.takenAt <= cutoff && s.takenAt >= floor)) continue
    const t = s.trips.get(id)
    if (t === undefined) continue
    if (!best || s.takenAt > best.takenAt) best = { takenAt: s.takenAt, trips: t }
  }
  return best
}

/** One Mioto record (all_rentals.json) against the rule. `now` only stands in for a record with no fetch time. */
export function miotoReliability(
  r: Record<string, unknown>, snapshots: readonly TripsSnapshot[], now: number, opts: { tripsHealthy?: boolean } = {},
): Verdict {
  // ⛔ Only an EXPLICIT status says anything (vehicle-rentals-gone.py reads it the same way).
  if (r.status === undefined || r.status === null) return unknown('noStats', 'no status in the record')
  if (Number(r.status) !== 2) return drop('notActive', `Mioto status ${String(r.status)} (2 = active)`)
  const trips = num(r.totalTrips), reviews = num(r.totalReviews), rating = ratingOf(r.rating)
  if (trips === null || reviews === null || rating === null) return unknown('noStats', 'totalTrips / totalReviews / rating missing from the record')
  if (trips < MIOTO_MIN_TRIPS) return drop('fewTrips', `${trips} trips < ${MIOTO_MIN_TRIPS}`)
  if (rating + RATING_EPSILON < MIOTO_MIN_RATING) return drop('lowRating', `${rating.toFixed(2)}★ < ${MIOTO_MIN_RATING}`)
  if (reviews < MIOTO_MIN_REVIEWS) return drop('fewReviews', `${reviews} reviews < ${MIOTO_MIN_REVIEWS}`)
  const at = recordTime(r, now)
  const ref = pickTripsReference(String(r.id), snapshots, at)
  if (!ref) {
    return opts.tripsHealthy === false
      ? unknown('tripsHistoryUnusable', `the trips history holds no snapshot ${TRIPS_REFERENCE_MIN_DAYS}–${TRIPS_REFERENCE_MAX_DAYS} days old for most cars — not judged`)
      : drop('noTripsReference', `no trips snapshot ${TRIPS_REFERENCE_MIN_DAYS}–${TRIPS_REFERENCE_MAX_DAYS} days old holds this car, so a recent trip cannot be proven`)
  }
  if (trips <= ref.trips) return drop('noRecentTrip', `${trips} trips now, ${ref.trips} on ${day(ref.takenAt)} (${days(at - ref.takenAt)} days earlier): no trip since`)
  return keep(`${trips - ref.trips} trip(s) since ${day(ref.takenAt)} (${days(at - ref.takenAt)} d) · ${trips} trips · ${rating.toFixed(2)}★ · ${reviews} reviews`)
}

/**
 * Every HCMC Mioto record's verdict, keyed by the importer's externalId (`mioto:<id>`), plus whether the trips
 * history could judge at all. `considered` = HCMC cars Mioto lists as active; `withReference` = those an old
 * enough snapshot holds. A record outside HCMC or with a malformed id is not in the map (the importer never
 * created such a row, and an existing row whose car moved out of HCMC reads as absent).
 */
export function miotoVerdicts(
  records: readonly Record<string, unknown>[], snapshots: readonly TripsSnapshot[], now: number,
): { verdicts: Map<string, Verdict>; considered: number; withReference: number; tripsHealthy: boolean } {
  const inScope = records.filter((r) => r.city === MIOTO_HCMC && typeof r.id === 'string' && MIOTO_ID.test(r.id))
  let considered = 0, withReference = 0
  for (const r of inScope) {
    if (Number(r.status) !== 2) continue
    considered++
    if (pickTripsReference(String(r.id), snapshots, recordTime(r, now))) withReference++
  }
  const tripsHealthy = considered === 0 || (considered - withReference) / considered <= MAX_NO_REFERENCE_SHARE
  const verdicts = new Map<string, Verdict>()
  for (const r of inScope) {
    const key = `mioto:${r.id}`
    if (!verdicts.has(key)) verdicts.set(key, miotoReliability(r, snapshots, now, { tripsHealthy }))
  }
  return { verdicts, considered, withReference, tripsHealthy }
}

/** Photos whose measured size is NOT an image-model output size. A photo with no measured size does not count. */
export function realPhotoCount(imageMeta: unknown): number {
  if (!Array.isArray(imageMeta)) return 0
  let n = 0
  for (const m of imageMeta) {
    if (!m || typeof m !== 'object') continue
    const w = num((m as { width?: unknown }).width), h = num((m as { height?: unknown }).height)
    if (w === null || h === null || w <= 0 || h <= 0) continue
    if (!GENERATED_DIMS.has(`${w}x${h}`)) n++
  }
  return n
}

/** One BonbonCar record (all_rentals.json) against the rule. */
export function bonbonReliability(r: Record<string, unknown>): Verdict {
  if (!r.status) return unknown('noStats', 'no status in the record')
  if (r.status !== 'Onboard') return drop('notActive', `BonbonCar status ${String(r.status)}`)
  // Rating, fleet flag and photo sizes come from the detail page: not read this run = not judged.
  if (r.detail_ok !== true) return unknown('noDetail', 'detail page not read this run')
  if (r.is_b2b !== false) return drop('notOwnFleet', r.is_b2b === true ? 'a partner (B2B) car, not BonbonCar’s own fleet' : 'no fleet flag (is_b2b) in the record')
  const real = realPhotoCount(r.image_meta)
  if (real < BONBON_MIN_REAL_PHOTOS) return drop('fewRealPhotos', `${real} real photo(s) < ${BONBON_MIN_REAL_PHOTOS} (image-model output sizes do not count)`)
  const rating = num(r.rating)
  if (rating === null) return drop('noRating', 'no rating')
  if (rating + RATING_EPSILON < BONBON_MIN_RATING) return drop('lowRating', `${rating}★ < ${BONBON_MIN_RATING}`)
  return keep(`own fleet · ${real} real photos · ${rating}★`)
}

/** Every HCMC BonbonCar record's verdict, keyed by the importer's externalId (`bonboncar:<sku>`). */
export function bonbonVerdicts(records: readonly Record<string, unknown>[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  for (const r of records) {
    if (r.city !== BONBON_HCMC || typeof r.sku !== 'string' || !BONBON_SKU.test(r.sku)) continue
    const key = `bonboncar:${r.sku}`
    if (!out.has(key)) out.set(key, bonbonReliability(r))
  }
  return out
}

// ── The trips history: one snapshot per scrape ────────────────────────────────────────────────────

export const TRIPS_SNAPSHOT_KIND = 'mioto-trips'
export const TRIPS_SNAPSHOT_VERSION = 1
export type TripsSnapshotFile = {
  kind: typeof TRIPS_SNAPSHOT_KIND
  version: typeof TRIPS_SNAPSHOT_VERSION
  /** The scrape's EARLIEST record fetch (ISO) — the conservative "taken at". */
  takenAt: string
  /** Its latest record fetch (ISO), for the reader. */
  lastFetchedAt: string
  /** The details.jsonl it was built from. */
  source: string
  /**
   * That file's size and mtime when it was read — a cache key only, never a date: the job MOVES details.jsonl into
   * state/prev-<run>/ (a rename keeps both), so a file already filed is recognised by a stat instead of a re-read.
   */
  sourceBytes?: number
  sourceMtimeMs?: number
  count: number
  trips: Record<string, number>
}

/**
 * A snapshot from one scrape's raw detail records (the scraper's details.jsonl lines: `id`, `totalTrips`,
 * `_fetched_at`). Records with a malformed id or a non-integer trip count are skipped and counted; the time is
 * read from the RECORDS (never a file mtime, which a copy resets). null when no record can be dated or kept.
 */
export function buildTripsSnapshot(records: Iterable<Record<string, unknown>>): { takenAt: number; lastAt: number; trips: Map<string, number>; skipped: number } | null {
  const trips = new Map<string, number>()
  let takenAt = Infinity, lastAt = -Infinity, skipped = 0
  for (const r of records) {
    const id = r.id, t = num(r.totalTrips)
    const at = typeof r._fetched_at === 'string' ? Date.parse(r._fetched_at) : NaN
    if (typeof id !== 'string' || !MIOTO_ID.test(id) || t === null || !Number.isInteger(t) || t < 0 || !Number.isFinite(at)) { skipped++; continue }
    trips.set(id, t)
    if (at < takenAt) takenAt = at
    if (at > lastAt) lastAt = at
  }
  if (!trips.size) return null
  return { takenAt, lastAt, trips, skipped }
}

/** `<YYYY-MM-DD>.json`, the ICT date the snapshot was taken. */
export function tripsSnapshotFileName(takenAt: number): string {
  return `${new Date(takenAt + ICT_OFFSET_MS).toISOString().slice(0, 10)}.json`
}

export function tripsSnapshotFile(
  s: { takenAt: number; lastAt: number; trips: ReadonlyMap<string, number> }, source: string, stat?: { bytes: number; mtimeMs: number },
): TripsSnapshotFile {
  return {
    kind: TRIPS_SNAPSHOT_KIND, version: TRIPS_SNAPSHOT_VERSION,
    takenAt: new Date(s.takenAt).toISOString(), lastFetchedAt: new Date(s.lastAt).toISOString(),
    source, ...(stat ? { sourceBytes: stat.bytes, sourceMtimeMs: stat.mtimeMs } : {}),
    count: s.trips.size, trips: Object.fromEntries(s.trips),
  }
}

/** The cache key a filed snapshot recorded for its source file, or null (an older file without one). */
export function sourceKeyOf(raw: unknown): string | null {
  const f = (raw ?? {}) as Partial<TripsSnapshotFile>
  return Number.isFinite(f.sourceBytes) && Number.isFinite(f.sourceMtimeMs) ? `${f.sourceBytes}:${f.sourceMtimeMs}` : null
}

/** A snapshot file read back, or the reason it is refused (never half-trusted). */
export function parseTripsSnapshot(raw: unknown): TripsSnapshot | string {
  if (!raw || typeof raw !== 'object') return 'not an object'
  const f = raw as Partial<TripsSnapshotFile>
  if (f.kind !== TRIPS_SNAPSHOT_KIND || f.version !== TRIPS_SNAPSHOT_VERSION) return `not a ${TRIPS_SNAPSHOT_KIND} v${TRIPS_SNAPSHOT_VERSION} file`
  const takenAt = typeof f.takenAt === 'string' ? Date.parse(f.takenAt) : NaN
  if (!Number.isFinite(takenAt)) return 'takenAt is not a date'
  if (!f.trips || typeof f.trips !== 'object' || Array.isArray(f.trips)) return 'trips is not an object'
  const trips = new Map<string, number>()
  for (const [id, t] of Object.entries(f.trips)) {
    if (!MIOTO_ID.test(id) || typeof t !== 'number' || !Number.isInteger(t) || t < 0) return `bad entry ${JSON.stringify(id)}: ${JSON.stringify(t)}`
    trips.set(id, t)
  }
  if (!trips.size) return 'no entries'
  return { takenAt, trips }
}

/**
 * Whether `next` should replace the snapshot already filed under the same date: never the same scrape twice,
 * and otherwise the one holding more cars (a re-run the same day after a short scrape keeps the fuller one).
 */
export function snapshotReplaces(existing: { takenAt: number; count: number } | null, next: { takenAt: number; count: number }): boolean {
  if (!existing) return true
  if (existing.takenAt === next.takenAt) return false
  return next.count > existing.count
}
