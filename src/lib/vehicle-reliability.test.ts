import { describe, expect, it } from 'vitest'
import {
  BONBON_MIN_REAL_PHOTOS, MAX_NO_REFERENCE_SHARE, MAX_TRIPS_DECREASE_SHARE, MIOTO_MIN_RATING, TRIPS_REFERENCE_MAX_DAYS, TRIPS_REFERENCE_MIN_DAYS,
  SCRAPE_TIME_QUANTILE, TRIPS_REFERENCE_TARGET_DAYS,
  bonbonReliability, bonbonSkuOf, bonbonVerdicts, buildTripsSnapshot, carStageBlock, earliestRecordTime, miotoIdOf, miotoReliability, miotoVerdicts,
  parseTripsSnapshot, pickTripsReference, realPhotoCount, recordTime, screenTripsSnapshots, snapshotReplaces, sourceKeyOf, tripsSnapshotFile,
  tripsSnapshotFileName, type TripsSnapshot,
} from './vehicle-reliability'

const DAY = 86_400_000
const T0 = Date.parse('2026-10-16T07:00:00+07:00')
const snap = (daysBefore: number, trips: Record<string, number>): TripsSnapshot => ({ takenAt: T0 - daysBefore * DAY, trips: new Map(Object.entries(trips)) })

function mioto(over: Record<string, unknown> = {}) {
  return {
    id: 'K2D7ZE', city: 'TP. Hồ Chí Minh', status: 2, totalTrips: 25, totalReviews: 12, rating: 4.9,
    detail_fetched_at: new Date(T0).toISOString(), scraped_at: new Date(T0).toISOString(),
    ...over,
  }
}

describe('pickTripsReference — the snapshot closest to 14 days among those 12–21 days old that hold the car', () => {
  it('takes the eligible snapshot closest to 14 days, never a younger one', () => {
    const s = [snap(18, { K2D7ZE: 10 }), snap(13, { K2D7ZE: 20 }), snap(4, { K2D7ZE: 24 })]
    expect(pickTripsReference('K2D7ZE', s, T0)).toEqual({ takenAt: T0 - 13 * DAY, trips: 20 })
  })

  it('counts exactly 12 days as old enough and 11.9 as not', () => {
    expect(pickTripsReference('K2D7ZE', [snap(TRIPS_REFERENCE_MIN_DAYS, { K2D7ZE: 3 })], T0)?.trips).toBe(3)
    expect(pickTripsReference('K2D7ZE', [snap(11.9, { K2D7ZE: 3 })], T0)).toBeNull()
  })

  it('falls back PER CAR to an older snapshot when the newest eligible one missed it (a wider window)', () => {
    const s = [snap(19, { K2D7ZE: 5 }), snap(13, { OTHER1: 9 })]
    expect(pickTripsReference('K2D7ZE', s, T0)).toEqual({ takenAt: T0 - 19 * DAY, trips: 5 })
  })

  it(`never reaches past ${TRIPS_REFERENCE_MAX_DAYS} days — a trip a month ago is not a trip in the last two weeks`, () => {
    expect(pickTripsReference('K2D7ZE', [snap(TRIPS_REFERENCE_MAX_DAYS, { K2D7ZE: 5 })], T0)?.trips).toBe(5)
    expect(pickTripsReference('K2D7ZE', [snap(TRIPS_REFERENCE_MAX_DAYS + 0.1, { K2D7ZE: 5 }), snap(30, { K2D7ZE: 1 })], T0)).toBeNull()
  })

  it('returns null when no snapshot old enough holds the car', () => {
    expect(pickTripsReference('K2D7ZE', [snap(5, { K2D7ZE: 1 })], T0)).toBeNull()
    expect(pickTripsReference('K2D7ZE', [], T0)).toBeNull()
  })

  it('ignores the order of the snapshot list', () => {
    const s = [snap(4, { K2D7ZE: 24 }), snap(13, { K2D7ZE: 20 }), snap(18, { K2D7ZE: 10 })]
    expect(pickTripsReference('K2D7ZE', s, T0)?.trips).toBe(20)
  })

  it(`⛔ on the 3-day cadence it is the 15-day snapshot, not the 12.0x-day one — whatever minutes the runs start at`, () => {
    // A run every 3 days; each snapshot is dated by its earliest fetch, the record by its own fetch hours later.
    const cadence = (lagMin: number) => [3, 6, 9, 12, 15, 18, 21].map((d) => snap(d + lagMin / 1440, { K2D7ZE: 30 - d }))
    expect(TRIPS_REFERENCE_TARGET_DAYS).toBe(14)
    // the record fetched 27 min after the old run's first fetch (12.02 d): the newest-≥12 rule took that one
    expect(pickTripsReference('K2D7ZE', cadence(27), T0)).toMatchObject({ takenAt: T0 - (15 + 27 / 1440) * DAY })
    // this run started a minute EARLIER than that one (11.999 d): still the 15-day snapshot, not a flip
    expect(pickTripsReference('K2D7ZE', cadence(-1), T0)).toMatchObject({ takenAt: T0 - (15 - 1 / 1440) * DAY })
  })

  it('a tie goes to the OLDER snapshot (the longer window)', () => {
    expect(pickTripsReference('K2D7ZE', [snap(13, { K2D7ZE: 20 }), snap(15, { K2D7ZE: 18 })], T0)).toEqual({ takenAt: T0 - 15 * DAY, trips: 18 })
  })

  it('⛔ never lets a reference count fall below what an older snapshot in the window saw (totalTrips never goes down)', () => {
    // the 15-day snapshot read 0 for this car (a broken scrape): the 18-day one already saw 24
    const s = [snap(18, { K2D7ZE: 24 }), snap(15, { K2D7ZE: 0 })]
    expect(pickTripsReference('K2D7ZE', s, T0)).toEqual({ takenAt: T0 - 15 * DAY, trips: 24 })
    // older than the window does not count, and neither does a NEWER snapshot
    expect(pickTripsReference('K2D7ZE', [snap(25, { K2D7ZE: 24 }), snap(15, { K2D7ZE: 0 })], T0)?.trips).toBe(0)
    expect(pickTripsReference('K2D7ZE', [snap(13, { K2D7ZE: 99 }), snap(15, { K2D7ZE: 5 })], T0)?.trips).toBe(5)
  })
})

describe('screenTripsSnapshots — a snapshot showing fewer trips than the one before it is never a reference', () => {
  const ids = Array.from({ length: 100 }, (_, i) => `KCAR${String(i).padStart(2, '0')}`)
  const fleet = (daysBefore: number, f: (i: number) => number) => snap(daysBefore, Object.fromEntries(ids.map((id, i) => [id, f(i)])))

  it('refuses a scrape that read 0 trips for the fleet — and not the snapshot after it, which rises from zero', () => {
    const r = screenTripsSnapshots([fleet(21, (i) => 20 + i), fleet(18, () => 0), fleet(15, (i) => 22 + i)])
    expect(r.usable.map((s) => (T0 - s.takenAt) / DAY)).toEqual([21, 15])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0].reason).toMatch(/100 of the 100 cars .* show FEWER trips/)
  })

  it('⛔ refuses TWO zeroed scrapes in a row (a scraper that stays broken) — the second shows no drop against the first', () => {
    const r = screenTripsSnapshots([fleet(21, (i) => 20 + i), fleet(18, () => 0), fleet(15, () => 0), fleet(12, (i) => 25 + i)])
    expect(r.usable.map((s) => (T0 - s.takenAt) / DAY)).toEqual([21, 12])
    expect(r.refused).toHaveLength(2)
  })

  it(`tolerates up to ${MAX_TRIPS_DECREASE_SHARE * 100}% of shared cars going down (a correction on Mioto's side)`, () => {
    const atLimit = screenTripsSnapshots([fleet(18, () => 30), fleet(15, (i) => (i < 5 ? 29 : 31))])
    expect(atLimit.refused).toEqual([])
    const over = screenTripsSnapshots([fleet(18, () => 30), fleet(15, (i) => (i < 6 ? 29 : 31))])
    expect(over.refused).toHaveLength(1)
  })

  it('miotoVerdicts judges only with usable snapshots: a zeroed scrape 15 days ago does not pass the fleet', () => {
    const recs = ids.slice(0, 10).map((id) => mioto({ id, totalTrips: 25 }))
    const history = [fleet(18, () => 25), fleet(15, () => 0)]
    const r = miotoVerdicts(recs, history, T0)
    expect(r.refusedSnapshots).toHaveLength(1)
    expect([...r.verdicts.values()].every((v) => v.kind === 'drop' && v.reason === 'noRecentTrip')).toBe(true)
  })
})

describe('miotoReliability — the owner’s Mioto rule (2026-10-13)', () => {
  const history = [snap(14, { K2D7ZE: 24 })]

  it('keeps a proven car with a trip since the snapshot ~14 days earlier', () => {
    const v = miotoReliability(mioto(), history, T0)
    expect(v.kind).toBe('keep')
    expect(v.detail).toMatch(/1 trip\(s\) since 2026-10-02/)
  })

  it('drops a car below each threshold, naming the threshold', () => {
    expect(miotoReliability(mioto({ totalTrips: 9 }), history, T0)).toMatchObject({ kind: 'drop', reason: 'fewTrips' })
    expect(miotoReliability(mioto({ rating: 4.79 }), history, T0)).toMatchObject({ kind: 'drop', reason: 'lowRating' })
    expect(miotoReliability(mioto({ totalReviews: 4 }), history, T0)).toMatchObject({ kind: 'drop', reason: 'fewReviews' })
  })

  it('takes the thresholds inclusively: 10 trips, 4.8★, 5 reviews pass', () => {
    const h = [snap(14, { K2D7ZE: 9 })]
    expect(miotoReliability(mioto({ totalTrips: 10, rating: MIOTO_MIN_RATING, totalReviews: 5 }), h, T0).kind).toBe('keep')
  })

  it('does not fail a car the site shows at 4.8 over float noise in its average', () => {
    expect(miotoReliability(mioto({ rating: 4.8 - 1e-12 }), history, T0).kind).toBe('keep')
    expect(miotoReliability(mioto({ rating: 4.8999999999999995 }), history, T0).kind).toBe('keep')
  })

  it('reads a raw details.jsonl rating object too', () => {
    expect(miotoReliability(mioto({ rating: { avg: 4.95 } }), history, T0).kind).toBe('keep')
    expect(miotoReliability(mioto({ rating: { avg: 4.5 } }), history, T0)).toMatchObject({ kind: 'drop', reason: 'lowRating' })
  })

  it('drops a car with no trip since the reference (equal OR fewer trips)', () => {
    expect(miotoReliability(mioto({ totalTrips: 24 }), history, T0)).toMatchObject({ kind: 'drop', reason: 'noRecentTrip' })
    expect(miotoReliability(mioto({ totalTrips: 20 }), history, T0)).toMatchObject({ kind: 'drop', reason: 'noRecentTrip' })
  })

  it('does NOT qualify a car no old snapshot holds — and says so in the reason', () => {
    const v = miotoReliability(mioto(), [snap(5, { K2D7ZE: 1 })], T0)
    expect(v).toMatchObject({ kind: 'drop', reason: 'noTripsReference' })
    expect(v.detail).toMatch(/no trips snapshot 12–21 days old holds this car/)
  })

  it('reads a missing reference as NOT JUDGED when the history itself is unusable', () => {
    expect(miotoReliability(mioto(), [], T0, { tripsHealthy: false })).toMatchObject({ kind: 'unknown', reason: 'tripsHistoryUnusable' })
  })

  it('measures the 12 days from the record’s own fetch time, not the wall clock', () => {
    // fetched 2 days after T0: the 11-day-old snapshot (relative to T0) is 13 days older than the record
    const rec = mioto({ detail_fetched_at: new Date(T0 + 2 * DAY).toISOString() })
    expect(miotoReliability(rec, [snap(11, { K2D7ZE: 24 })], T0).kind).toBe('keep')
  })

  it('drops an inactive car on its explicit status, and never judges one without stats', () => {
    expect(miotoReliability(mioto({ status: 4 }), history, T0)).toMatchObject({ kind: 'drop', reason: 'notActive' })
    expect(miotoReliability(mioto({ status: undefined }), history, T0)).toMatchObject({ kind: 'unknown', reason: 'noStats' })
    expect(miotoReliability(mioto({ totalTrips: null }), history, T0)).toMatchObject({ kind: 'unknown', reason: 'noStats' })
    expect(miotoReliability(mioto({ rating: 'n/a' }), history, T0)).toMatchObject({ kind: 'unknown', reason: 'noStats' })
  })
})

describe('miotoVerdicts — every HCMC car, and whether the trips history could judge', () => {
  it('keys verdicts by the importer’s externalId and leaves out cars outside HCMC or with a bad id', () => {
    const recs = [mioto(), mioto({ id: 'K9OUTX', city: 'Bình Dương' }), mioto({ id: 'bad id' })]
    const r = miotoVerdicts(recs, [snap(14, { K2D7ZE: 24 })], T0)
    expect([...r.verdicts.keys()]).toEqual(['mioto:K2D7ZE'])
    expect(r.tripsHealthy).toBe(true)
  })

  it(`calls the history unusable when more than ${MAX_NO_REFERENCE_SHARE * 100}% of active cars have no snapshot in the window`, () => {
    const ids = Array.from({ length: 10 }, (_, i) => `KCAR${String(i).padStart(2, '0')}`)
    const recs = ids.map((id) => mioto({ id }))
    const held = (n: number) => [snap(14, Object.fromEntries(ids.slice(0, n).map((id) => [id, 24])))]
    const healthy = miotoVerdicts(recs, held(8), T0) // 2 of 10 without one: new listings, booked-out cars
    expect(healthy).toMatchObject({ considered: 10, withReference: 8, tripsHealthy: true })
    expect(healthy.verdicts.get('mioto:KCAR09')).toMatchObject({ kind: 'drop', reason: 'noTripsReference' })
    const broken = miotoVerdicts(recs, held(7), T0) // 3 of 10: part of the history is gone
    expect(broken).toMatchObject({ withReference: 7, tripsHealthy: false })
    expect(broken.verdicts.get('mioto:KCAR09')).toMatchObject({ kind: 'unknown', reason: 'tripsHistoryUnusable' })
    // a car that fails on its own stats is still dropped — only the missing reference turns into "not judged"
    const lowRated = miotoVerdicts([...recs, mioto({ id: 'KLOW01', rating: 4 })], [], T0)
    expect(lowRated.verdicts.get('mioto:KLOW01')).toMatchObject({ kind: 'drop', reason: 'lowRating' })
  })

  it('an empty trips history judges nobody by the trip test (a wiped or unseeded directory)', () => {
    const r = miotoVerdicts([mioto()], [], T0)
    expect(r.tripsHealthy).toBe(false)
    expect(r.verdicts.get('mioto:K2D7ZE')?.kind).toBe('unknown')
  })

  it('a gap in runs (no snapshot inside the window) freezes the trip test instead of failing every car', () => {
    const r = miotoVerdicts([mioto(), mioto({ id: 'KAAAA1' })], [snap(40, { K2D7ZE: 1, KAAAA1: 1 }), snap(5, { K2D7ZE: 20, KAAAA1: 20 })], T0)
    expect(r).toMatchObject({ withReference: 0, tripsHealthy: false })
    expect([...r.verdicts.values()].every((v) => v.kind === 'unknown')).toBe(true)
  })

  it('counts only active cars toward the health share', () => {
    const recs = [mioto(), mioto({ id: 'KINACT', status: 3 })]
    expect(miotoVerdicts(recs, [snap(14, { K2D7ZE: 24 })], T0)).toMatchObject({ considered: 1, withReference: 1, tripsHealthy: true })
  })
})

function bonbon(over: Record<string, unknown> = {}) {
  const meta = Array.from({ length: 4 }, () => ({ width: 2560, height: 1920 }))
  return { sku: 'ACCENT_013', city: 'Hồ Chí Minh', status: 'Onboard', detail_ok: true, is_b2b: false, rating: 5, image_meta: meta, ...over }
}

describe('bonbonReliability — own fleet, real photos, ≥4★', () => {
  it('keeps an own-fleet car with real photos and a 4★+ rating', () => {
    expect(bonbonReliability(bonbon()).kind).toBe('keep')
    expect(bonbonReliability(bonbon({ rating: 4 })).kind).toBe('keep')
  })

  it('drops a partner (B2B) car, and one with no fleet flag', () => {
    expect(bonbonReliability(bonbon({ is_b2b: true }))).toMatchObject({ kind: 'drop', reason: 'notOwnFleet' })
    expect(bonbonReliability(bonbon({ is_b2b: undefined }))).toMatchObject({ kind: 'drop', reason: 'notOwnFleet' })
  })

  it(`needs ${BONBON_MIN_REAL_PHOTOS} photos that are not image-model output sizes`, () => {
    const gen = [{ width: 1184, height: 864 }, { width: 864, height: 1184 }, { width: 1344, height: 768 }, { width: 768, height: 1344 }]
    expect(bonbonReliability(bonbon({ image_meta: [...gen, { width: 2560, height: 1920 }, { width: 1600, height: 1200 }] })))
      .toMatchObject({ kind: 'drop', reason: 'fewRealPhotos' })
    expect(bonbonReliability(bonbon({ image_meta: [...gen, { width: 2560, height: 1920 }, { width: 1600, height: 1200 }, { width: 1200, height: 1600 }] })).kind).toBe('keep')
  })

  it('drops an unrated or under-4★ car', () => {
    expect(bonbonReliability(bonbon({ rating: null }))).toMatchObject({ kind: 'drop', reason: 'noRating' })
    expect(bonbonReliability(bonbon({ rating: 3 }))).toMatchObject({ kind: 'drop', reason: 'lowRating' })
  })

  it('never judges a car whose detail page was not read this run', () => {
    expect(bonbonReliability(bonbon({ detail_ok: false, is_b2b: true }))).toMatchObject({ kind: 'unknown', reason: 'noDetail' })
  })

  it('drops a car BonbonCar no longer has onboard', () => {
    expect(bonbonReliability(bonbon({ status: 'Offboard' }))).toMatchObject({ kind: 'drop', reason: 'notActive' })
    expect(bonbonReliability(bonbon({ status: '' }))).toMatchObject({ kind: 'unknown', reason: 'noStats' })
  })

  it('bonbonVerdicts keeps HCMC cars only, keyed bonboncar:<sku>', () => {
    const m = bonbonVerdicts([bonbon(), bonbon({ sku: 'X_BD_1', city: 'Bình Dương' }), bonbon({ sku: 'bad sku!' })])
    expect([...m.keys()]).toEqual(['bonboncar:ACCENT_013'])
  })
})

describe('realPhotoCount', () => {
  it('counts measured photos that are not a generated size; an unmeasured photo does not count', () => {
    expect(realPhotoCount([{ width: 2560, height: 1920 }, null, { width: 1184, height: 864 }, {}, { width: '1440', height: '1080' }])).toBe(2)
    expect(realPhotoCount(undefined)).toBe(0)
  })
})

describe('the trips history files', () => {
  const recs = [
    { id: 'K2D7ZE', totalTrips: 24, _fetched_at: '2026-09-28T01:21:42+07:00' },
    { id: 'KAAAA1', totalTrips: 3, _fetched_at: '2026-09-28T14:26:45+07:00' },
    { id: 'bad', totalTrips: 3, _fetched_at: '2026-09-28T14:26:45+07:00' },
    { id: 'KAAAA2', totalTrips: 1.5, _fetched_at: '2026-09-28T14:26:45+07:00' },
    { id: 'KAAAA3', totalTrips: 2 },
  ]

  it('files a padded id under the trimmed id the importer and the verdicts use', () => {
    const s = buildTripsSnapshot([{ id: ' K2D7ZE ', totalTrips: 7, _fetched_at: '2026-09-28T01:21:42+07:00' }])!
    expect([...s.trips.keys()]).toEqual(['K2D7ZE'])
  })

  it('builds a snapshot dated by its EARLIEST record fetch, skipping malformed records', () => {
    const s = buildTripsSnapshot(recs)!
    expect(s.takenAt).toBe(Date.parse('2026-09-28T01:21:42+07:00'))
    expect(s.lastAt).toBe(Date.parse('2026-09-28T14:26:45+07:00'))
    expect(Object.fromEntries(s.trips)).toEqual({ K2D7ZE: 24, KAAAA1: 3 })
    expect(s.skipped).toBe(3)
    expect(buildTripsSnapshot([{ id: 'bad' }])).toBeNull()
  })

  it('names the file by the ICT date (a scrape starting 01:21 ICT is that day, not the UTC day before)', () => {
    expect(tripsSnapshotFileName(Date.parse('2026-09-28T01:21:42+07:00'))).toBe('2026-09-28.json')
    expect(tripsSnapshotFileName(Date.parse('2026-09-27T23:59:00+07:00'))).toBe('2026-09-27.json')
  })

  it('round-trips through the file shape, and refuses a malformed file whole', () => {
    const s = buildTripsSnapshot(recs)!
    const back = parseTripsSnapshot(JSON.parse(JSON.stringify(tripsSnapshotFile(s, '/x/details.jsonl'))))
    expect(typeof back).toBe('object')
    if (typeof back === 'string') return
    expect(back.takenAt).toBe(s.takenAt)
    expect(Object.fromEntries(back.trips)).toEqual({ K2D7ZE: 24, KAAAA1: 3 })
    expect(parseTripsSnapshot({ kind: 'mioto-trips', version: 1, takenAt: 'x', trips: {} })).toMatch(/takenAt/)
    expect(parseTripsSnapshot({ kind: 'mioto-trips', version: 1, takenAt: '2026-09-28T00:00:00Z', trips: { K2D7ZE: -1 } })).toMatch(/bad entry/)
    expect(parseTripsSnapshot({ kind: 'other' })).toMatch(/not a mioto-trips/)
  })

  it('records the source file’s size + mtime as a re-read cache key (never as a date)', () => {
    const s = buildTripsSnapshot(recs)!
    const f = JSON.parse(JSON.stringify(tripsSnapshotFile(s, '/x/details.jsonl', { bytes: 64063491, mtimeMs: 1760229466123.456 })))
    expect(sourceKeyOf(f)).toBe('64063491:1760229466123.456')
    expect(sourceKeyOf(tripsSnapshotFile(s, '/x/details.jsonl'))).toBeNull()
    expect(sourceKeyOf(null)).toBeNull()
    expect(typeof parseTripsSnapshot(f)).toBe('object')
  })

  it('files a date once per scrape, and keeps the fuller of two scrapes on one date', () => {
    expect(snapshotReplaces(null, { takenAt: 1, count: 5 })).toBe(true)
    expect(snapshotReplaces({ takenAt: 1, count: 5 }, { takenAt: 1, count: 9 })).toBe(false)
    expect(snapshotReplaces({ takenAt: 1, count: 5 }, { takenAt: 2, count: 9 })).toBe(true)
    expect(snapshotReplaces({ takenAt: 1, count: 9 }, { takenAt: 2, count: 5 })).toBe(false)
  })

  it('earliestRecordTime: a scrape is dated by its records\' own EARLIEST fetch — never Mioto\'s build stamp', () => {
    const D = ['detail_fetched_at']
    const recs = [
      { detail_fetched_at: '2026-10-12T05:33:23+07:00', scraped_at: '2026-10-12T07:38:46+07:00' },
      { detail_fetched_at: '2026-10-12T07:37:46+07:00', scraped_at: '2026-10-12T07:38:46+07:00' },
    ]
    expect(earliestRecordTime(recs, D, 0)).toBe(Date.parse('2026-10-12T05:33:23+07:00'))
    // last run's details re-built today (a checkpoint that did not move): still last run's fetches…
    expect(earliestRecordTime([{ detail_fetched_at: '2026-10-05T07:00:00+07:00', scraped_at: '2026-10-12T07:38:46+07:00' }], D, 0)).toBe(Date.parse('2026-10-05T07:00:00+07:00'))
    // …and ONE car fetched today does not make last week's dataset fresh
    expect(earliestRecordTime([{ detail_fetched_at: '2026-10-05T07:00:00+07:00' }, { detail_fetched_at: '2026-10-12T06:00:00+07:00' }], D, 0)).toBe(Date.parse('2026-10-05T07:00:00+07:00'))
    // ⛔ a Mioto record with only the build stamp is no evidence: none at all = the caller's fallback (0 — stale)
    expect(earliestRecordTime([{ scraped_at: '2026-10-12T07:38:46+07:00' }], D, 0)).toBe(0)
    expect(earliestRecordTime([{}], D, 42)).toBe(42)
    // BonbonCar's scraped_at is per record
    expect(earliestRecordTime([{ scraped_at: '2026-10-12T07:40:14+07:00' }, { scraped_at: '2026-10-12T07:41:17+07:00' }], ['scraped_at'], 0)).toBe(Date.parse('2026-10-12T07:40:14+07:00'))
  })

  it(`earliestRecordTime looks past the oldest ${SCRAPE_TIME_QUANTILE * 100}% — one odd record never freezes a source, a stale share still shows`, () => {
    const D = ['detail_fetched_at']
    const fresh = (n: number) => Array.from({ length: n }, (_, i) => ({ detail_fetched_at: new Date(T0 + i * 1000).toISOString() }))
    const old = { detail_fetched_at: new Date(T0 - 7 * DAY).toISOString() }
    expect(earliestRecordTime([old, ...fresh(199)], D, 0)).toBe(T0) // 1 of 200: looked past
    expect(earliestRecordTime([old, old, old, old, ...fresh(196)], D, 0)).toBe(T0 - 7 * DAY) // 2% old: old
    expect(earliestRecordTime([old, ...fresh(40)], D, 0)).toBe(T0 - 7 * DAY) // a small source: the minimum
  })

  it('recordTime prefers the detail fetch, then the build, then the fallback', () => {
    expect(recordTime({ detail_fetched_at: '2026-10-12T06:48:50+07:00', scraped_at: '2026-10-12T07:38:46+07:00' }, 0)).toBe(Date.parse('2026-10-12T06:48:50+07:00'))
    expect(recordTime({ scraped_at: '2026-10-12T07:38:46+07:00' }, 0)).toBe(Date.parse('2026-10-12T07:38:46+07:00'))
    expect(recordTime({}, 42)).toBe(42)
  })
})

describe('⛔ the staging gate — an HCMC car is staged only with a keep verdict under the key the stage writes', () => {
  const history = [snap(14, { K2D7ZE: 24 })]

  it('Mioto: a padded id is judged under its trimmed id — a 3-trip 3★ car is NOT staged', () => {
    const bad = mioto({ id: ' K2D7ZE', totalTrips: 3, rating: 3 })
    expect(miotoIdOf(bad)).toBe('K2D7ZE')
    const v = miotoVerdicts([bad], history, T0)
    expect(v.verdicts.get('mioto:K2D7ZE')).toMatchObject({ kind: 'drop', reason: 'fewTrips' })
    expect(carStageBlock('mioto', bad, v.verdicts)).toBe('unreliable:fewTrips')
    // the same car passing the rule is staged
    const good = mioto({ id: 'K2D7ZE ' })
    expect(carStageBlock('mioto', good, miotoVerdicts([good], history, T0).verdicts)).toBeNull()
  })

  it('BonbonCar: a padded SKU of a B2B, 2★, 1-photo car is NOT staged', () => {
    const bad = bonbon({ sku: 'ACCENT_039 ', is_b2b: true, rating: 2, image_meta: [{ width: 2560, height: 1920 }] })
    expect(bonbonSkuOf(bad)).toBe('ACCENT_039')
    const v = bonbonVerdicts([bad])
    expect([...v.keys()]).toEqual(['bonboncar:ACCENT_039'])
    expect(carStageBlock('bonboncar', bad, v)).toBe('unreliable:notOwnFleet')
  })

  it('an HCMC record with NO verdict is not staged; a record outside HCMC goes on to the stage (notHcmc there)', () => {
    expect(carStageBlock('mioto', mioto({ id: 'K2D7ZE' }), new Map())).toBe('notJudged:noVerdict')
    expect(carStageBlock('mioto', mioto({ id: 'bad id' }), new Map())).toBe('notJudged:noVerdict')
    expect(carStageBlock('mioto', mioto({ city: 'Bình Dương' }), new Map())).toBeNull()
    expect(carStageBlock('bonboncar', bonbon(), new Map())).toBe('notJudged:noVerdict')
    expect(carStageBlock('mioto', mioto(), new Map([['mioto:K2D7ZE', { kind: 'unknown', reason: 'noStats', detail: '' }]]))).toBe('notJudged:noStats')
  })
})
