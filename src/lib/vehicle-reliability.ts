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
 * the scraper's state/prev-<run>/details.jsonl). A car is compared with the snapshot CLOSEST TO
 * TRIPS_REFERENCE_TARGET_DAYS (14) among those TRIPS_REFERENCE_MIN_DAYS–TRIPS_REFERENCE_MAX_DAYS old THAT HOLD IT
 * (a tie goes to the older one) — on the 3-day cadence the 15-day one. A car no such snapshot holds (listed under
 * 12 days ago, or missed by every scrape in the window) does NOT qualify, and its reason says so: it cannot prove a
 * recent trip.
 *   · ⛔ NOT "THE NEWEST ONE ≥ 12 DAYS OLD" (review 2026-10-13): the 3-day cadence puts a snapshot 12.0x days before
 *     the record, so that rule tested "a trip in the last 12 days" — ~7% of the cars the owner's 14 days keeps
 *     (761 pass at 14 days on 10-12, 560 at 7: ~29 a day) — and flipped to the 15-day one whenever a run started a
 *     minute earlier than the run it was compared with.
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
 *   · ⛔ A REFERENCE TOO LOW PASSES CARS THAT HAD NO TRIP (review 2026-10-13: one scrape reading 0 trips for every
 *     car would, 12 days later, have passed 1,914 cars against 761 — revived and created with no alert). totalTrips
 *     never goes down (measured: 0 of ~7,100 shared cars in each of the three pairs of weekly scrapes 09-28 / 10-05 /
 *     10-12), so (1) screenTripsSnapshots refuses as a reference any snapshot in which more than
 *     MAX_TRIPS_DECREASE_SHARE of the cars it shares with the snapshot before it show FEWER trips, and (2) a car's
 *     reference count is never lower than an older snapshot in the window already saw. The status step's growth
 *     guard (src/lib/vehicle-status-plan.ts) is the backstop for what slips through both.
 */
import { GENERATED_DIMS } from './vehicle-rental-listing'

export const MIOTO_MIN_TRIPS = 10
export const MIOTO_MIN_RATING = 4.8
export const MIOTO_MIN_REVIEWS = 5
/** The trip test compares with a snapshot at least this many days older than the record… */
export const TRIPS_REFERENCE_MIN_DAYS = 12
/** …and at most this many: room for a car two scrapes in a row missed… */
export const TRIPS_REFERENCE_MAX_DAYS = 21
/** …and of those, the one closest to the owner's 14 days ("at least one completed trip in the last 14 days"). */
export const TRIPS_REFERENCE_TARGET_DAYS = 14
/**
 * A snapshot in which more than this share of the cars it shares with the snapshot before it show FEWER trips is a
 * broken scrape, never a reference. Measured 2026-10-13: 0 decreases of ~7,100 shared cars in every pair of the
 * three weekly scrapes; 5% leaves room for a correction on Mioto's side and still refuses a scrape that zeroed a
 * twentieth of the fleet.
 */
export const MAX_TRIPS_DECREASE_SHARE = 0.05
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

/** The share of a scrape's oldest fetch times earliestRecordTime looks past: a few odd records never freeze a source. */
export const SCRAPE_TIME_QUANTILE = 0.01

/**
 * When a car scrape was taken: its EARLIEST record fetch times — the 1st percentile (SCRAPE_TIME_QUANTILE), read from
 * `fields` only — else `fallback`. Mioto passes ['detail_fetched_at'], BonbonCar ['scraped_at'] (per record there).
 * ⛔ Never Mioto's `scraped_at`: `scraper.py build` stamps every record with the moment it BUILDS the file (all 5,637
 * on 10-12 carry 07:38:46), so a build over last run's details — a checkpoint that failed to move — read as a fresh
 * check (review 2026-10-13); a record without its own fetch time is no evidence, and the caller's fallback for "none
 * at all" is 0 — stale — never "now" (gate review). ⛔ And not the LATEST fetch: one car fetched today in a dataset of
 * last week's details would have made the whole dataset look fresh. The 1st percentile, not the strict minimum: a
 * dataset more than 1% old reads as old (stale: neither judged nor allowed to revive), while one malformed record
 * cannot freeze 5,600 cars (gate review).
 */
export function earliestRecordTime(records: readonly Record<string, unknown>[], fields: readonly string[], fallback: number): number {
  const times: number[] = []
  for (const r of records) {
    for (const f of fields) {
      const v = r[f]
      const t = typeof v === 'string' ? Date.parse(v) : NaN
      if (Number.isFinite(t) && t > 0) { times.push(t); break }
    }
  }
  if (!times.length) return fallback
  times.sort((a, b) => a - b)
  return times[Math.floor(SCRAPE_TIME_QUANTILE * (times.length - 1))]
}

/**
 * The trips count this car had in the snapshot taken CLOSEST TO `targetDays` before `at`, among those between
 * `minDays` and `maxDays` before it that hold the car (a tie goes to the older one), or null. Snapshots newer than
 * `minDays` (this run's own, last run's) are never a reference, nor older than `maxDays`.
 * ⛔ The count is never lower than an older snapshot in the window already saw: totalTrips never goes down, so a
 * lower one is a broken scrape, and taking it would pass a car that had no trip.
 */
export function pickTripsReference(
  id: string, snapshots: readonly TripsSnapshot[], at: number,
  minDays: number = TRIPS_REFERENCE_MIN_DAYS, maxDays: number = TRIPS_REFERENCE_MAX_DAYS, targetDays: number = TRIPS_REFERENCE_TARGET_DAYS,
): { takenAt: number; trips: number } | null {
  const cutoff = at - minDays * DAY_MS, floor = at - maxDays * DAY_MS, target = at - targetDays * DAY_MS
  let best: { takenAt: number; trips: number } | null = null
  for (const s of snapshots) {
    if (!(s.takenAt <= cutoff && s.takenAt >= floor)) continue
    const t = s.trips.get(id)
    if (t === undefined) continue
    const off = Math.abs(s.takenAt - target)
    if (!best) { best = { takenAt: s.takenAt, trips: t }; continue }
    const bestOff = Math.abs(best.takenAt - target)
    if (off < bestOff || (off === bestOff && s.takenAt < best.takenAt)) best = { takenAt: s.takenAt, trips: t }
  }
  if (!best) return null
  let trips = best.trips
  for (const s of snapshots) {
    if (s.takenAt < floor || s.takenAt >= best.takenAt) continue
    const t = s.trips.get(id)
    if (t !== undefined && t > trips) trips = t
  }
  return { takenAt: best.takenAt, trips }
}

/**
 * The snapshots fit to be a reference, and the ones refused with why. Each is checked against the last snapshot
 * before it that was NOT refused: more than MAX_TRIPS_DECREASE_SHARE of the cars both hold showing FEWER trips = a
 * broken scrape (a field read as 0, a parser change), refused. ⛔ Against the last FIT one, not merely the one
 * before: a scraper that stays broken files one broken snapshot per run, and the second of two zeroed scrapes shows
 * no decrease against the first. (The costs, accepted: a snapshot that read trips too HIGH would make the next ones
 * look broken — the history then stops judging, warned every run, until that file is removed — loud, never a bulk
 * pass; and the very FIRST snapshot has nothing to be checked against — the history keeps every file, so that is
 * the 09-28 seed — with the status step's growth guard behind it.)
 */
export function screenTripsSnapshots(snapshots: readonly TripsSnapshot[]): { usable: TripsSnapshot[]; refused: { takenAt: number; reason: string }[] } {
  const sorted = [...snapshots].sort((a, b) => a.takenAt - b.takenAt)
  const usable: TripsSnapshot[] = [], refused: { takenAt: number; reason: string }[] = []
  for (const s of sorted) {
    const before = usable.at(-1) ?? null
    let shared = 0, fewer = 0
    if (before) {
      for (const [id, t] of s.trips) {
        const was = before.trips.get(id)
        if (was === undefined) continue
        shared++
        if (t < was) fewer++
      }
    }
    if (before && fewer > 0 && fewer > MAX_TRIPS_DECREASE_SHARE * shared) {
      refused.push({ takenAt: s.takenAt, reason: `${fewer} of the ${shared} cars it shares with the ${day(before.takenAt)} snapshot show FEWER trips (> ${MAX_TRIPS_DECREASE_SHARE * 100}%; totalTrips never goes down) — a broken scrape, never a reference` })
      continue
    }
    usable.push(s)
  }
  return { usable, refused }
}

/** A Mioto record's id exactly as the importer writes it (stageMioto trims it), or null when it is not one. */
export function miotoIdOf(r: Record<string, unknown>): string | null {
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  return MIOTO_ID.test(id) ? id : null
}
/** A BonbonCar record's SKU exactly as the importer writes it (stageBonbon trims it), or null when it is not one. */
export function bonbonSkuOf(r: Record<string, unknown>): string | null {
  const sku = typeof r.sku === 'string' ? r.sku.trim() : ''
  return BONBON_SKU.test(sku) ? sku : null
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
  const ref = pickTripsReference(miotoIdOf(r) ?? String(r.id), snapshots, at)
  if (!ref) {
    return opts.tripsHealthy === false
      ? unknown('tripsHistoryUnusable', `the trips history holds no snapshot ${TRIPS_REFERENCE_MIN_DAYS}–${TRIPS_REFERENCE_MAX_DAYS} days old for most cars — not judged`)
      : drop('noTripsReference', `no trips snapshot ${TRIPS_REFERENCE_MIN_DAYS}–${TRIPS_REFERENCE_MAX_DAYS} days old holds this car, so a recent trip cannot be proven`)
  }
  if (trips <= ref.trips) return drop('noRecentTrip', `${trips} trips now, ${ref.trips} on ${day(ref.takenAt)} (${days(at - ref.takenAt)} days earlier): no trip since`)
  return keep(`${trips - ref.trips} trip(s) since ${day(ref.takenAt)} (${days(at - ref.takenAt)} d) · ${trips} trips · ${rating.toFixed(2)}★ · ${reviews} reviews`)
}

/**
 * Every HCMC Mioto record's verdict, keyed by the importer's externalId (`mioto:<id>`, the id trimmed as the stage
 * trims it), plus whether the trips history could judge at all. `considered` = HCMC cars Mioto lists as active;
 * `withReference` = those an old enough snapshot holds. A record outside HCMC or with a malformed id is not in the
 * map (the importer never created such a row, and an existing row whose car moved out of HCMC reads as absent).
 * Only the snapshots screenTripsSnapshots passes are a reference; `refusedSnapshots` are the others, for the report.
 */
export function miotoVerdicts(
  records: readonly Record<string, unknown>[], allSnapshots: readonly TripsSnapshot[], now: number,
): { verdicts: Map<string, Verdict>; considered: number; withReference: number; tripsHealthy: boolean; refusedSnapshots: { takenAt: number; reason: string }[] } {
  const { usable: snapshots, refused: refusedSnapshots } = screenTripsSnapshots(allSnapshots)
  const inScope = records.filter((r) => r.city === MIOTO_HCMC && miotoIdOf(r) !== null)
  let considered = 0, withReference = 0
  for (const r of inScope) {
    if (Number(r.status) !== 2) continue
    considered++
    if (pickTripsReference(miotoIdOf(r)!, snapshots, recordTime(r, now))) withReference++
  }
  const tripsHealthy = considered === 0 || (considered - withReference) / considered <= MAX_NO_REFERENCE_SHARE
  const verdicts = new Map<string, Verdict>()
  for (const r of inScope) {
    const key = `mioto:${miotoIdOf(r)}`
    if (!verdicts.has(key)) verdicts.set(key, miotoReliability(r, snapshots, now, { tripsHealthy }))
  }
  return { verdicts, considered, withReference, tripsHealthy, refusedSnapshots }
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

/** Every HCMC BonbonCar record's verdict, keyed by the importer's externalId (`bonboncar:<sku>`, trimmed as the stage does). */
export function bonbonVerdicts(records: readonly Record<string, unknown>[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  for (const r of records) {
    const sku = bonbonSkuOf(r)
    if (r.city !== BONBON_HCMC || sku === null) continue
    const key = `bonboncar:${sku}`
    if (!out.has(key)) out.set(key, bonbonReliability(r))
  }
  return out
}

/**
 * May the importer stage this car record? null = yes; else the reason it is tallied as dropped.
 * ⛔ AN HCMC RECORD IS STAGED ONLY WITH A `keep` VERDICT UNDER THE VERY KEY THE STAGE WRITES — no verdict is no
 * (review 2026-10-13: `if (v && v.kind !== 'keep')` let through every HCMC record that HAD no verdict, and one id
 * with a stray space — trimmed by the stage, not by the verdicts — imported a 3-trip 3★ car). A record outside
 * HCMC goes on to the stage, which drops it as notHcmc.
 */
export function carStageBlock(source: 'mioto' | 'bonboncar', r: Record<string, unknown>, verdicts: ReadonlyMap<string, Verdict>): string | null {
  if (r.city !== (source === 'mioto' ? MIOTO_HCMC : BONBON_HCMC)) return null
  const id = source === 'mioto' ? miotoIdOf(r) : bonbonSkuOf(r)
  const v = id === null ? undefined : verdicts.get(`${source}:${id}`)
  if (v?.kind === 'keep') return null
  return v ? `${v.kind === 'drop' ? 'unreliable' : 'notJudged'}:${v.reason}` : 'notJudged:noVerdict'
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
    // The id as the importer and the verdicts read it (trimmed), so a padded id is the same car in every place.
    const id = typeof r.id === 'string' ? r.id.trim() : r.id, t = num(r.totalTrips)
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
