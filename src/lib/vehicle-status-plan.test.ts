import { describe, expect, it } from 'vitest'
import {
  BIKE_MISS_MIN_SPAN_DAYS, BIKE_MISS_RUNS, CAR_ABSENT_RUNS, EXPIRE_SHARE_FLOOR, MAX_SCRAPE_AGE_DAYS, PRESENCE_ABS_SLACK, PRESENCE_KIND, PRESENCE_MIN_SHARE,
  bikePresence, guardFor, latestScrapedAt, missStreak, parsePresenceEntry, planVehicleStatus, presenceGuard, recordedRuns,
  type DbRow, type PlanInput, type PresenceEntry, type SourceRun,
} from './vehicle-status-plan'
import { bonbonVerdicts, miotoVerdicts, type Verdict } from './vehicle-reliability'
import { stageBonbon, stageMioto, stageShopBike, type StageDeps } from './vehicle-rental-listing'

const DAY = 86_400_000
const T0 = Date.parse('2026-10-16T07:00:00Z')
const keep: Verdict = { kind: 'keep', detail: '2 trip(s) since 2026-10-02' }
const fewTrips: Verdict = { kind: 'drop', reason: 'fewTrips', detail: '3 trips < 10' }
const noDetail: Verdict = { kind: 'unknown', reason: 'noDetail', detail: 'detail page not read this run' }
let n = 0
const id = () => `cmtest${String(++n).padStart(20, '0')}`
const car = (externalId: string, status = 'active', over: Partial<DbRow> = {}): DbRow => ({ id: id(), externalId, status, seller: 'mioto', subcat: 'car-rental', ...over })
const bike = (externalId: string, status = 'active', over: Partial<DbRow> = {}): DbRow => ({ id: id(), externalId, status, seller: 'janmotorbike', subcat: 'motorbike-rental', ...over })
const run = (daysBefore: number, present: string[], over: Partial<SourceRun> = {}): SourceRun => ({ scrapedAt: T0 - daysBefore * DAY, count: 100, accepted: true, present: new Set(present), ...over })
const plan = (over: Partial<PlanInput>) => planVehicleStatus({ rows: [], cars: {}, bikes: {}, ready: new Set(), ...over })

describe('presenceGuard — a short scrape expires nothing', () => {
  it(`judges a scrape at ≥ ${PRESENCE_MIN_SHARE * 100}% of the reference, refuses one below`, () => {
    expect(presenceGuard({ count: 80, priorAccepted: [100], fallback: null })).toMatchObject({ judged: true, accepted: true, reference: 100 })
    expect(presenceGuard({ count: 79, priorAccepted: [100], fallback: null })).toMatchObject({ judged: false, accepted: false, reference: 100 })
  })

  it('takes the LARGEST of the last 3 accepted counts, so a slow decline cannot ratchet the reference down', () => {
    // 100 → 85 → 75: each step passes "80% of the last", but 70 is under 80% of 100
    expect(presenceGuard({ count: 70, priorAccepted: [75, 85, 100], fallback: null })).toMatchObject({ judged: false, reference: 100 })
    // a 4th-oldest count no longer counts
    expect(presenceGuard({ count: 70, priorAccepted: [75, 80, 82, 100], fallback: null })).toMatchObject({ judged: true, reference: 82 })
  })

  it('falls back to the weekly baseline before any run is recorded, and records a first count without judging it', () => {
    expect(presenceGuard({ count: 90, priorAccepted: [], fallback: 100 })).toMatchObject({ judged: true, reference: 100 })
    expect(presenceGuard({ count: 50, priorAccepted: [], fallback: 100 })).toMatchObject({ judged: false, accepted: false })
    expect(presenceGuard({ count: 50, priorAccepted: [], fallback: null })).toMatchObject({ judged: false, accepted: true, reference: null })
  })

  it('refuses an empty scrape — unless the operator accepts it (a shop that really closed)', () => {
    expect(presenceGuard({ count: 0, priorAccepted: [14], fallback: null })).toMatchObject({ judged: false, accepted: false })
    expect(presenceGuard({ count: 0, priorAccepted: [14], fallback: null, force: true })).toMatchObject({ judged: true, accepted: true })
  })

  it('never accepts a scrape older than one already recorded — not even under --accept', () => {
    expect(presenceGuard({ count: 100, priorAccepted: [100], fallback: null, force: true, newest: false })).toMatchObject({ judged: false, accepted: false })
  })

  it('--accept overrides a short count', () => {
    expect(presenceGuard({ count: 10, priorAccepted: [100], fallback: null, force: true })).toMatchObject({ judged: true, accepted: true })
  })

  it(`never calls a drop of ${PRESENCE_ABS_SLACK} rows or fewer short — a small shop's churn is not a broken scrape`, () => {
    expect(presenceGuard({ count: 14 - PRESENCE_ABS_SLACK, priorAccepted: [14], fallback: null })).toMatchObject({ judged: true })
    expect(presenceGuard({ count: 14 - PRESENCE_ABS_SLACK - 1, priorAccepted: [14], fallback: null })).toMatchObject({ judged: false })
    // on a big source the share still rules
    expect(presenceGuard({ count: 4000, priorAccepted: [5600], fallback: null })).toMatchObject({ judged: false })
  })
})

const entry = (recordedAt: string, sources: PresenceEntry['sources']): PresenceEntry => ({ kind: PRESENCE_KIND, version: 1, recordedAt, sources })
const src = (scrapedAt: string, count: number, present: string[], accepted = true) => ({ scrapedAt, count, accepted, present })

describe('the presence history', () => {
  const e1 = entry('2026-10-10T09:00:00Z', { janmotorbike: src('2026-10-10T01:00:00Z', 100, ['janmotorbike:a']) })
  const e2 = entry('2026-10-13T09:00:00Z', { janmotorbike: src('2026-10-13T01:00:00Z', 60, ['janmotorbike:b'], false) })
  const e2again = entry('2026-10-13T11:00:00Z', { janmotorbike: src('2026-10-13T01:00:00Z', 98, ['janmotorbike:c']) })

  it('lists runs newest first, and counts a re-recorded scrape once (the later record)', () => {
    const runs = recordedRuns('janmotorbike', [e2, e1, e2again])
    expect(runs.map((r) => [new Date(r.scrapedAt).toISOString(), r.count])).toEqual([['2026-10-13T01:00:00.000Z', 98], ['2026-10-10T01:00:00.000Z', 100]])
    expect(recordedRuns('mioto', [e1])).toEqual([])
  })

  it('guardFor ignores earlier records of this very scrape and refuses an older scrape', () => {
    const { guard, prior } = guardFor('janmotorbike', [e1, e2], { scrapedAt: Date.parse('2026-10-13T01:00:00Z'), count: 90 }, null, false)
    expect(prior).toHaveLength(1) // e2 is this scrape → replaced, not a reference
    expect(guard).toMatchObject({ judged: true, reference: 100 })
    const older = guardFor('janmotorbike', [e1, e2again], { scrapedAt: Date.parse('2026-10-11T01:00:00Z'), count: 100 }, null, false)
    expect(older.guard).toMatchObject({ judged: false, accepted: false })
  })

  it(`refuses a scrape older than ${MAX_SCRAPE_AGE_DAYS} days at the time of judging — a re-used dataset is not a new check`, () => {
    const at = Date.parse('2026-10-13T01:00:00Z')
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at, count: 100 }, null, false, at + 1.5 * DAY).guard).toMatchObject({ judged: true })
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at, count: 100 }, null, true, at + 2.5 * DAY).guard).toMatchObject({ judged: false, accepted: false })
  })

  it('an operator-accepted run starts the reference over, so ONE --accept really accepts a lower level', () => {
    const hi = (d: string) => entry(`${d}T09:00:00Z`, { tuanmotorbike: src(`${d}T01:00:00Z`, 14, []) })
    const forced = entry('2026-10-12T09:00:00Z', { tuanmotorbike: { ...src('2026-10-12T01:00:00Z', 8, []), forced: true } })
    const next = { scrapedAt: Date.parse('2026-10-15T01:00:00Z'), count: 8 }
    // without the forced run, 8 of 14 is short; after it, 8 is the new level
    expect(guardFor('tuanmotorbike', [hi('2026-10-06'), hi('2026-10-09')], next, null, false).guard).toMatchObject({ judged: false })
    expect(guardFor('tuanmotorbike', [hi('2026-10-06'), hi('2026-10-09'), forced], next, null, false).guard).toMatchObject({ judged: true, reference: 8 })
    expect(parsePresenceEntry({ ...forced, sources: { tuanmotorbike: { ...forced.sources.tuanmotorbike, forced: 'yes' } } })).toBeNull()
  })

  it('a refused (not accepted) run is never a reference', () => {
    const { guard } = guardFor('janmotorbike', [e1, e2], { scrapedAt: Date.parse('2026-10-16T01:00:00Z'), count: 85 }, null, false)
    expect(guard.reference).toBe(100)
  })

  it('parsePresenceEntry refuses anything malformed', () => {
    expect(parsePresenceEntry(JSON.parse(JSON.stringify(e1)))).not.toBeNull()
    expect(parsePresenceEntry({ ...e1, kind: 'x' })).toBeNull()
    expect(parsePresenceEntry({ ...e1, sources: { a: { ...e1.sources.janmotorbike, count: -1 } } })).toBeNull()
    expect(parsePresenceEntry({ ...e1, sources: { a: { ...e1.sources.janmotorbike, present: [1] } } })).toBeNull()
    expect(parsePresenceEntry({ ...e1, sources: { a: { ...e1.sources.janmotorbike, scrapedAt: 'never' } } })).toBeNull()
  })
})

describe('missStreak — consecutive accepted checks a bike is missing from', () => {
  it('counts from the newest run back to the last run it was present in', () => {
    const runs = [run(0, []), run(3, []), run(6, []), run(9, ['b']), run(12, [])]
    expect(missStreak('b', runs)).toEqual({ streak: 3, spanDays: 6 })
    expect(missStreak('b', [run(0, ['b']), run(3, [])])).toEqual({ streak: 0, spanDays: 0 })
    expect(missStreak('never', [run(0, []), run(1, [])])).toEqual({ streak: 2, spanDays: 1 })
  })
})

describe('bikePresence — listed, and in stock where the shop says', () => {
  it('counts every HCMC listing of the five shops and marks out-of-stock bikes absent', () => {
    const p = bikePresence([
      { shop: 'janmotorbike', city: 'Ho Chi Minh City', external_id: 'a', availability: 'in stock', scraped_at: '2026-10-16T01:00:00Z' },
      { shop: 'janmotorbike', city: 'Ho Chi Minh City', external_id: 'b', availability: 'out of stock', scraped_at: '2026-10-16T02:00:00Z' },
      { shop: 'janmotorbike', city: 'Ho Chi Minh City', external_id: 'a', availability: 'in stock' }, // duplicate
      { shop: 'tuanmotorbike', city: 'Hanoi', external_id: 'x', availability: 'listed' },
      { shop: 'dungmotorbikes', city: 'Ho Chi Minh City', external_id: 'd', availability: 'listed' },
      { shop: 'someoneelse', city: 'Ho Chi Minh City', external_id: 'z' },
      { shop: 'theextramile', city: 'Ho Chi Minh City', external_id: 'bad id!', availability: 'unknown' },
    ], T0)
    expect(p.janmotorbike.count).toBe(2)
    expect([...p.janmotorbike.present]).toEqual(['janmotorbike:a'])
    expect(p.janmotorbike.scrapedAt).toBe(Date.parse('2026-10-16T02:00:00Z'))
    expect([...p.dungmotorbikes.present]).toEqual(['dungmotorbikes:d'])
    expect(p.tuanmotorbike).toMatchObject({ count: 0, scrapedAt: T0 })
    expect(p.theextramile.count).toBe(0)
  })

  it('latestScrapedAt reads the records, else the fallback', () => {
    expect(latestScrapedAt([{ scraped_at: '2026-10-12T07:38:46+07:00' }, { scraped_at: 'x' }], 5)).toBe(Date.parse('2026-10-12T07:38:46+07:00'))
    expect(latestScrapedAt([], 5)).toBe(5)
  })
})

describe('planVehicleStatus — cars', () => {
  const verdicts = new Map<string, Verdict>([['mioto:KEEP01', keep], ['mioto:DROP01', fewTrips], ['mioto:UNKN01', noDetail]])
  const listed = [...verdicts.keys()]
  /** This run (accepted) plus earlier accepted runs, newest first, every 3 days. */
  const carRuns = (...present: string[][]) => present.map((p, i) => run(i * 3, p))

  it('expires a live car that fails the rule at once, keeps the reliable and the unjudged', () => {
    const rows = [car('mioto:KEEP01'), car('mioto:DROP01'), car('mioto:UNKN01')]
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: carRuns(listed) } } })
    expect(p.expire.map((m) => [m.externalId, m.code, m.to])).toEqual([['mioto:DROP01', 'fewTrips', 'expired']])
    expect(p.expire[0].reason).toMatch(/3 trips < 10/)
    expect(p.tally.mioto).toMatchObject({ keep: 1, 'held: not judged (noDetail)': 1, 'expire: fewTrips': 1 })
  })

  it(`expires a vanished car only after ${CAR_ABSENT_RUNS} complete scrapes in a row without it — one absence is a booked-out car`, () => {
    const rows = [car('mioto:GONE01')]
    const once = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: carRuns(listed, ['mioto:GONE01', ...listed]) } } })
    expect(once.expire).toEqual([])
    expect(once.tally.mioto).toMatchObject({ 'held: absent from 1 scrape(s) — booked out, or gone (the gone probe decides that)': 1 })
    const twice = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: carRuns(listed, listed, ['mioto:GONE01']) } } })
    expect(twice.expire.map((m) => [m.externalId, m.code])).toEqual([['mioto:GONE01', 'absent']])
    expect(twice.expire[0].reason).toMatch(/last 2 complete scrapes over 3\.0 days/)
    // two runs of one failed-then-retried day are not two absences
    const sameDay = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: [run(0, listed), run(1, listed), run(4, ['mioto:GONE01'])] } } })
    expect(sameDay.expire).toEqual([])
  })

  it('a scrape that is NOT judged expires nothing', () => {
    const rows = [car('mioto:DROP01'), car('mioto:GONE01')]
    const p = plan({ rows, cars: { mioto: { judged: false, verdicts, runs: carRuns(listed, listed, listed) } } })
    expect(p.expire).toEqual([])
    expect(p.tally.mioto).toMatchObject({ 'held: fewTrips, scrape not judged': 1, 'held: absent, scrape not judged': 1 })
  })

  it('revives an expired car that qualifies again only when this run refreshed it', () => {
    const rows = [car('mioto:KEEP01', 'expired'), car('mioto:KEEP02', 'expired'), car('mioto:DROP01', 'expired')]
    const v = new Map(verdicts).set('mioto:KEEP02', keep)
    const p = plan({ rows, cars: { mioto: { judged: false, verdicts: v, runs: [] } }, ready: new Set(['mioto:KEEP01']) })
    expect(p.revive.map((m) => [m.externalId, m.from, m.to, m.code])).toEqual([['mioto:KEEP01', 'expired', 'active', 'qualifies']])
    expect(p.tally.mioto).toMatchObject({ 'stays expired: qualifies, not refreshed this run': 1, 'stays expired: fewTrips': 1, 'revive: qualifies': 1 })
  })

  it('never touches hidden, removed, sold or another status — whatever the verdict', () => {
    const rows = ['hidden', 'removed', 'sold', 'stale', 'pending'].map((s) => car('mioto:KEEP01', s))
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: carRuns(listed) } }, ready: new Set(['mioto:KEEP01']) })
    expect(p.expire).toEqual([])
    expect(p.revive).toEqual([])
    expect(p.tally.mioto).toMatchObject({ 'untouched: hidden': 1, 'untouched: removed': 1, 'untouched: sold': 1, 'untouched: stale': 1 })
  })

  it('leaves alone a row with no externalId or of an unexpected subcategory, and any source this run did not load', () => {
    const rows = [car('mioto:X', 'active', { externalId: null }), car('mioto:Y', 'active', { subcat: 'motorbike-rental' }), car('bonboncar:Z', 'active', { seller: 'bonboncar' })]
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: carRuns([], [], []) } } })
    expect(p.expire).toEqual([])
    expect(p.tally.bonboncar).toBeUndefined()
  })
})

describe('planVehicleStatus — motorbikes (3 checks, ~7–10 days)', () => {
  const cadence = (present: string[][]) => present.map((p, i) => run(i * 3, p)) // newest first, every 3 days

  it(`expires a live bike missing from the last ${BIKE_MISS_RUNS} accepted checks spanning ≥ ${BIKE_MISS_MIN_SPAN_DAYS} days`, () => {
    const rows = [bike('janmotorbike:gone'), bike('janmotorbike:back'), bike('janmotorbike:new')]
    const runs = cadence([['janmotorbike:new'], ['janmotorbike:back'], [], ['janmotorbike:gone', 'janmotorbike:back']])
    const p = plan({ rows, bikes: { janmotorbike: { judged: true, runs, present: runs[0].present } } })
    expect(p.expire.map((m) => [m.externalId, m.code])).toEqual([['janmotorbike:gone', 'missing']])
    expect(p.expire[0].reason).toMatch(/last 3 checks over 6\.0 days/)
    expect(p.tally.janmotorbike).toMatchObject({ 'keep: missing 1 check(s)': 1, keep: 1 })
  })

  it('does not expire on three checks squeezed into a few days (failed-run retries)', () => {
    const runs = [run(0, []), run(1, []), run(2, []), run(5, ['janmotorbike:a'])]
    const p = plan({ rows: [bike('janmotorbike:a')], bikes: { janmotorbike: { judged: true, runs, present: new Set() } } })
    expect(p.expire).toEqual([])
    // …and does once the misses span the minimum
    const later = [run(0, []), run(1, []), run(2, []), run(6, []), run(9, ['janmotorbike:a'])]
    expect(plan({ rows: [bike('janmotorbike:a')], bikes: { janmotorbike: { judged: true, runs: later, present: new Set() } } }).expire).toHaveLength(1)
  })

  it('a span a few minutes short of 6 days still counts — scrape timing jitters from run to run', () => {
    const jitter = [run(0, []), run(3, []), run(5.99, []), run(9, ['janmotorbike:a'])]
    expect(BIKE_MISS_MIN_SPAN_DAYS).toBeLessThan(5.99)
    expect(plan({ rows: [bike('janmotorbike:a')], bikes: { janmotorbike: { judged: true, runs: jitter, present: new Set() } } }).expire).toHaveLength(1)
  })

  it('needs three recorded checks: a short history expires nothing', () => {
    const runs = [run(0, []), run(3, [])]
    expect(plan({ rows: [bike('janmotorbike:a')], bikes: { janmotorbike: { judged: true, runs, present: new Set() } } }).expire).toEqual([])
  })

  it('an unjudged shop scrape expires nothing', () => {
    const runs = cadence([[], [], [], []])
    expect(plan({ rows: [bike('janmotorbike:a')], bikes: { janmotorbike: { judged: false, runs, present: new Set() } } }).expire).toEqual([])
  })

  it('revives an expired bike listed again (and refreshed), even when the scrape is not judged', () => {
    const rows = [bike('janmotorbike:a', 'expired'), bike('janmotorbike:b', 'expired'), bike('janmotorbike:c', 'expired')]
    const present = new Set(['janmotorbike:a', 'janmotorbike:b'])
    const p = plan({ rows, bikes: { janmotorbike: { judged: false, runs: [], present } }, ready: new Set(['janmotorbike:a']) })
    expect(p.revive.map((m) => m.externalId)).toEqual(['janmotorbike:a'])
    expect(p.tally.janmotorbike).toMatchObject({ 'stays expired: listed, not refreshed this run': 1, 'stays expired: not listed': 1 })
  })

  it('never revives a hidden bike (a confirmed-gone or moderated row)', () => {
    const p = plan({ rows: [bike('janmotorbike:a', 'hidden')], bikes: { janmotorbike: { judged: true, runs: [run(0, ['janmotorbike:a'])], present: new Set(['janmotorbike:a']) } }, ready: new Set(['janmotorbike:a']) })
    expect(p.revive).toEqual([])
  })
})

describe('planVehicleStatus — the expire-share guard', () => {
  const many = (k: number, status = 'active') => Array.from({ length: k }, (_, i) => car(`mioto:C${String(i).padStart(5, '0')}`, status))

  it(`refuses a source's expiries when they exceed half its live rows (from ${EXPIRE_SHARE_FLOOR} live rows)`, () => {
    const rows = many(40)
    const verdicts = new Map(rows.map((r, i) => [r.externalId!, i < 21 ? fewTrips : keep] as [string, Verdict]))
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: [] } } })
    expect(p.expire).toEqual([])
    expect(p.refused.mioto).toMatch(/would expire 21 of 40 live rows/)
    expect(p.tally.mioto['held: expire-share guard (fewTrips)']).toBe(21)
  })

  it('lets exactly half through, and lets a small source empty out', () => {
    const rows = many(40)
    const half = new Map(rows.map((r, i) => [r.externalId!, i < 20 ? fewTrips : keep] as [string, Verdict]))
    expect(plan({ rows, cars: { mioto: { judged: true, verdicts: half, runs: [] } } }).expire).toHaveLength(20)
    const small = many(5)
    const absentTwice = [run(0, []), run(3, [])]
    expect(plan({ rows: small, cars: { mioto: { judged: true, verdicts: new Map(), runs: absentTwice } } }).expire).toHaveLength(5)
  })

  it('--accept <source> overrides it; revivals are never held by it', () => {
    const rows = [...many(40), car('mioto:BACK01', 'expired')]
    const verdicts = new Map<string, Verdict>([['mioto:BACK01', keep]])
    const runs = [run(0, ['mioto:BACK01']), run(3, ['mioto:BACK01'])]
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs } }, ready: new Set(['mioto:BACK01']) })
    expect(p.expire).toEqual([])
    expect(p.revive).toHaveLength(1)
    expect(plan({ rows, cars: { mioto: { judged: true, verdicts, runs } }, ready: new Set(['mioto:BACK01']), force: new Set(['mioto']) }).expire).toHaveLength(40)
  })

  it('judges each source on its own', () => {
    const rows = [...many(40), ...Array.from({ length: 30 }, (_, i) => car(`bonboncar:B${i}`, 'active', { seller: 'bonboncar' }))]
    const listedB = rows.slice(40, 52).map((r) => r.externalId!)
    const p = plan({
      rows,
      cars: {
        mioto: { judged: true, verdicts: new Map(rows.slice(0, 40).map((r) => [r.externalId!, keep] as [string, Verdict])), runs: [] },
        bonboncar: { judged: true, verdicts: new Map(listedB.map((x) => [x, keep] as [string, Verdict])), runs: [run(0, listedB), run(3, listedB)] },
      },
    })
    expect(p.refused).toEqual({ bonboncar: expect.stringMatching(/would expire 18 of 30/) })
  })
})

describe('the plan’s keys ARE the importer’s externalIds (a mismatch would read every live row as missing)', () => {
  const deps: StageDeps = { resolve: (rel) => `/data/${rel}`, fileOk: () => true }
  const photos = (n: number, base: string) => Array.from({ length: n }, (_, i) => `${base}${i}.jpg`)
  const locals = (id: string, n: number) => Array.from({ length: n }, (_, i) => `images/${id}/${String(i + 1).padStart(2, '0')}.jpg`)

  it('Mioto: stageMioto’s externalId is the verdict key', () => {
    const r = {
      id: 'K2D7ZE', name: 'VINFAST FADIL 2022', seats: 4, transmission: 'automatic', price_vnd_day: 850000, city: 'TP. Hồ Chí Minh',
      status: 2, totalTrips: 30, totalReviews: 10, rating: 5, photos: photos(5, 'https://cdn.example/p'), local_images: locals('K2D7ZE', 5),
      source_url: 'https://www.mioto.vn/car/vinfast-fadil-2022/K2D7ZE', scraped_at: '2026-10-12T07:38:46+07:00',
    }
    const staged = stageMioto(r, { ...deps, sharedSha1: new Set(), sha1Of: () => [] })
    expect(staged.ok).toBe(true)
    expect(miotoVerdicts([r], [], Date.parse(r.scraped_at)).verdicts.has(staged.ok ? staged.row.externalId : '')).toBe(true)
  })

  it('BonbonCar: stageBonbon’s externalId is the verdict key', () => {
    const r = {
      sku: 'ACCENT_039', name: 'Hyundai Accent 2024', city: 'Hồ Chí Minh', status: 'Onboard', detail_ok: true, is_b2b: false, rating: 5,
      price_per_day_vnd: 850000, photos: photos(3, 'https://objects.bonboncar.vn/p'), local_images: locals('ACCENT_039', 3),
      image_meta: [{ width: 1280, height: 960 }, { width: 1280, height: 960 }, { width: 1280, height: 960 }],
      source_url: 'https://www.bonboncar.vn/detail/ACCENT_039', scraped_at: '2026-10-12T07:40:03+07:00',
    }
    const staged = stageBonbon(r, deps)
    expect(staged.ok).toBe(true)
    expect(bonbonVerdicts([r]).has(staged.ok ? staged.row.externalId : '')).toBe(true)
  })

  it('shops: stageShopBike’s externalId is the presence key', () => {
    const r = {
      shop: 'janmotorbike', city: 'Ho Chi Minh City', external_id: ' 17459 ', name: 'Honda Airblade 125cc Rental', type: 'automatic scooter',
      availability: 'in stock', prices: [{ amount: 2500000, currency: 'VND', unit: 'month', label: 'listed price' }],
      photos: photos(2, 'https://janmotorbike.com/p'), local_images: locals('17459', 2), photo_flags: [[], []], image_meta: [{ width: 800 }, { width: 800 }],
      source_url: 'https://janmotorbike.com/honda-airblade-125cc-rental-in-hcmc-2/', scraped_at: '2026-10-12T00:59:13Z',
    }
    const staged = stageShopBike(r, { ...deps, fx: null })
    expect(staged.ok).toBe(true)
    expect(bikePresence([r], 0).janmotorbike.present.has(staged.ok ? staged.row.externalId : '')).toBe(true)
  })
})
