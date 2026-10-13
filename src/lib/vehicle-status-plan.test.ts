import { describe, expect, it } from 'vitest'
import {
  BIKE_MISS_MIN_SPAN_DAYS, BIKE_MISS_RUNS, CAR_ABSENT_RUNS, EXPIRE_ALLOWANCE, GROWTH_ALLOWANCE, MAX_SCRAPE_AGE_DAYS, PRESENCE_ABS_SLACK, PRESENCE_KIND,
  PRESENCE_MIN_SHARE,
  baselineCountsFrom, bikePresence, growthBaseline, growthRefusal, guardFor, guardRefusals, heldCreations, latestScrapedAt, missStreak, parsePresenceEntry,
  planVehicleStatus, presenceGuard, recordedRuns, shrinkRefusal, statusInputs, statusJournalProblem,
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

  it('refuses a scrape stamped in the future (a skewed clock) — and a refused run never blocks the next real one', () => {
    const at = Date.parse('2026-10-13T01:00:00Z')
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at + DAY, count: 100 }, null, true, at).guard).toMatchObject({ judged: false, accepted: false })
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at + 5 * 60_000, count: 100 }, null, false, at).guard).toMatchObject({ judged: true })
    // that skewed run was recorded as refused: it must not make the next real scrape "older than the last"
    const skewed = entry('2026-10-13T02:00:00Z', { janmotorbike: src('2026-10-20T01:00:00Z', 100, [], false) })
    expect(guardFor('janmotorbike', [e1, skewed], { scrapedAt: at, count: 100 }, null, false, at + DAY).guard).toMatchObject({ judged: true })
    // …while a REAL newer run, even a refused one, still forbids going back in time
    const shortNewer = entry('2026-10-14T02:00:00Z', { janmotorbike: src('2026-10-14T01:00:00Z', 40, [], false) })
    expect(guardFor('janmotorbike', [e1, shortNewer], { scrapedAt: at, count: 100 }, null, false, at + DAY).guard).toMatchObject({ judged: false })
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

  it('guardFor hands missStreak EVERY run — this one first, refused ones too — and never a run stamped in the future', () => {
    const at = Date.parse('2026-10-16T01:00:00Z')
    const skewed = entry('2026-10-14T02:00:00Z', { janmotorbike: src('2026-10-25T01:00:00Z', 100, ['janmotorbike:a'], false) })
    const { runs } = guardFor('janmotorbike', [e1, e2, skewed], { scrapedAt: at, count: 90, present: new Set(['janmotorbike:z']) }, null, false, at + 3_600_000)
    expect(runs.map((r) => [new Date(r.scrapedAt).toISOString().slice(0, 10), r.accepted])).toEqual([['2026-10-16', true], ['2026-10-13', false], ['2026-10-10', true]])
    expect([...runs[0].present]).toEqual(['janmotorbike:z'])
  })

  it('a re-record of an accepted scrape that is refused (stale by then) does not un-accept the check it was', () => {
    const late = entry('2026-10-20T09:00:00Z', { janmotorbike: src('2026-10-10T01:00:00Z', 100, ['janmotorbike:a'], false) })
    expect(recordedRuns('janmotorbike', [e1, late])).toMatchObject([{ accepted: true }])
    // …while an operator's later accepted record of a refused scrape does replace it
    const accepted = entry('2026-10-13T12:00:00Z', { janmotorbike: { ...src('2026-10-13T01:00:00Z', 60, ['janmotorbike:b']), forced: true } })
    expect(recordedRuns('janmotorbike', [e2, accepted])).toMatchObject([{ accepted: true, forced: true }])
  })

  it('fresh = this run\'s own evidence: a stale, future-stamped or older-than-recorded scrape is not', () => {
    const at = Date.parse('2026-10-13T01:00:00Z')
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at, count: 50 }, null, false, at).guard).toMatchObject({ judged: false, fresh: true }) // short, but fresh
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at, count: 100 }, null, false, at + 2.5 * DAY).guard.fresh).toBe(false)
    expect(guardFor('janmotorbike', [e1], { scrapedAt: at + DAY, count: 100 }, null, false, at).guard.fresh).toBe(false)
    expect(guardFor('janmotorbike', [e1], { scrapedAt: Date.parse('2026-10-09T01:00:00Z'), count: 100 }, null, false).guard.fresh).toBe(false)
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

  it('⛔ a SHORT (refused) run is no missed check — but a bike it lists was SEEN there, which ends the streak', () => {
    // absent, seen in a refused run, absent, absent: last seen 6 days ago — not three misses over 9 days
    const runs = [run(0, []), run(3, []), run(6, ['b'], { accepted: false }), run(9, []), run(12, ['b'])]
    expect(missStreak('b', runs)).toEqual({ streak: 2, spanDays: 3 })
    // a refused run that does not list it is skipped, not counted, and does not break the streak either
    const skipped = [run(0, []), run(3, [], { accepted: false }), run(6, []), run(9, []), run(12, ['b'])]
    expect(missStreak('b', skipped)).toEqual({ streak: 3, spanDays: 9 })
    // the span runs between ACCEPTED misses — a refused newest run does not stretch it
    expect(missStreak('b', [run(0, [], { accepted: false }), run(3, []), run(6, []), run(9, ['b'])])).toEqual({ streak: 2, spanDays: 3 })
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
    // the shop's EARLIEST listing time (one fresh listing never makes an old dataset fresh)
    expect(p.janmotorbike.scrapedAt).toBe(Date.parse('2026-10-16T01:00:00Z'))
    expect([...p.dungmotorbikes.present]).toEqual(['dungmotorbikes:d'])
    // listings with no scrape time at all: stale (0) — never "now"; a shop listing nothing: this run's empty scrape
    expect(p.dungmotorbikes.scrapedAt).toBe(0)
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
    const rows = [car('mioto:GONE01'), car('mioto:KEEP01')] // (a second live row: a source never loses its whole list at once)
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

  // A second bike listed in every check: a shop never loses its whole list at once (the shrink guard), so these
  // tests of the miss rule keep one row that stays.
  const stay = (rs: SourceRun[]) => rs.map((r) => ({ ...r, present: new Set([...r.present, 'janmotorbike:stay']) }))
  const twoBikes = () => [bike('janmotorbike:a'), bike('janmotorbike:stay')]

  it('does not expire on three checks squeezed into a few days (failed-run retries)', () => {
    const runs = stay([run(0, []), run(1, []), run(2, []), run(5, ['janmotorbike:a'])])
    const p = plan({ rows: twoBikes(), bikes: { janmotorbike: { judged: true, runs, present: runs[0].present } } })
    expect(p.expire).toEqual([])
    // …and does once the misses span the minimum
    const later = stay([run(0, []), run(1, []), run(2, []), run(6, []), run(9, ['janmotorbike:a'])])
    expect(plan({ rows: twoBikes(), bikes: { janmotorbike: { judged: true, runs: later, present: later[0].present } } }).expire).toHaveLength(1)
  })

  it('a span a few minutes short of 6 days still counts — scrape timing jitters from run to run', () => {
    const jitter = stay([run(0, []), run(3, []), run(5.99, []), run(9, ['janmotorbike:a'])])
    expect(BIKE_MISS_MIN_SPAN_DAYS).toBeLessThan(5.99)
    expect(plan({ rows: twoBikes(), bikes: { janmotorbike: { judged: true, runs: jitter, present: jitter[0].present } } }).expire).toHaveLength(1)
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

  it('refuses a source\'s expiries when they exceed half its live rows', () => {
    const rows = many(40)
    const verdicts = new Map(rows.map((r, i) => [r.externalId!, i < 21 ? fewTrips : keep] as [string, Verdict]))
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs: [] } } })
    expect(p.expire).toEqual([])
    expect(p.refused.mioto).toMatch(/would expire 21 of 40 live rows/)
    expect(p.tally.mioto['held: expire-share guard (fewTrips)']).toBe(21)
  })

  it('lets exactly half through', () => {
    const rows = many(40)
    const half = new Map(rows.map((r, i) => [r.externalId!, i < 20 ? fewTrips : keep] as [string, Verdict]))
    expect(plan({ rows, cars: { mioto: { judged: true, verdicts: half, runs: [] } } }).expire).toHaveLength(20)
  })

  it(`⛔ caps a SMALL source too — half its rows, or ${EXPIRE_ALLOWANCE} — and never its whole list in one run`, () => {
    const absentTwice = [run(0, []), run(3, [])]
    const small = many(5)
    const p = plan({ rows: small, cars: { mioto: { judged: true, verdicts: new Map(), runs: absentTwice } } })
    expect(p.expire).toEqual([])
    expect(p.refused.mioto).toMatch(/would expire 5 of 5 live rows/)
    // 3 of 4 may go; all 4 may not — nor the only row of a 1-row source
    const four = many(4)
    const threeGone = new Map<string, Verdict>([[four[3].externalId!, keep]])
    expect(plan({ rows: four, cars: { mioto: { judged: true, verdicts: threeGone, runs: [run(0, [four[3].externalId!]), run(3, [four[3].externalId!])] } } }).expire).toHaveLength(EXPIRE_ALLOWANCE)
    expect(plan({ rows: many(4), cars: { mioto: { judged: true, verdicts: new Map(), runs: absentTwice } } }).expire).toEqual([])
    expect(plan({ rows: many(1), cars: { mioto: { judged: true, verdicts: new Map(), runs: absentTwice } } }).expire).toEqual([])
    // a 14-bike shop whose every bike missed three checks: refused (alert), not emptied
    const shop = Array.from({ length: 14 }, (_, i) => bike(`janmotorbike:b${i}`))
    const runs = [run(0, []), run(3, []), run(6, [])]
    const s = plan({ rows: shop, bikes: { janmotorbike: { judged: true, runs, present: new Set() } } })
    expect(s.expire).toEqual([])
    expect(s.refused.janmotorbike).toMatch(/would expire 14 of 14/)
    expect(shrinkRefusal(7, 14)).toBeNull()
    expect(shrinkRefusal(8, 14)).toMatch(/would expire 8 of 14/)
    expect(shrinkRefusal(1, 2)).toBeNull()
    expect(shrinkRefusal(2, 2)).toMatch(/never all/)
    expect(shrinkRefusal(1, 1)).toMatch(/would expire 1 of 1/)
  })

  it('⛔ a source the guard refuses moves NOTHING this run — its revivals are held too; --accept <source> overrides', () => {
    const rows = [...many(40), car('mioto:BACK01', 'expired')]
    const verdicts = new Map<string, Verdict>([['mioto:BACK01', keep]])
    const runs = [run(0, ['mioto:BACK01']), run(3, ['mioto:BACK01'])]
    const p = plan({ rows, cars: { mioto: { judged: true, verdicts, runs } }, ready: new Set(['mioto:BACK01']) })
    expect(p.expire).toEqual([])
    expect(p.revive).toEqual([])
    expect(p.tally.mioto).toMatchObject({ 'held: expire-share guard (absent)': 40, 'held: source refused this run (qualifies)': 1 })
    const forced = plan({ rows, cars: { mioto: { judged: true, verdicts, runs } }, ready: new Set(['mioto:BACK01']), force: new Set(['mioto']) })
    expect([forced.expire.length, forced.revive.length]).toEqual([40, 1])
  })

  it('a source whose revivals the growth guard holds expires nothing either, and one held upstream moves nothing', () => {
    const live = many(40), expired = Array.from({ length: 21 }, (_, i) => car(`mioto:X${String(i).padStart(5, '0')}`, 'expired'))
    const verdicts = new Map<string, Verdict>([...live.map((r, i) => [r.externalId!, i < 2 ? fewTrips : keep] as [string, Verdict]), ...expired.map((r) => [r.externalId!, keep] as [string, Verdict])])
    const input = { rows: [...live, ...expired], cars: { mioto: { judged: true, verdicts, runs: [] } }, ready: new Set(expired.map((r) => r.externalId!)) }
    const p = plan(input)
    expect([p.expire.length, p.revive.length]).toEqual([0, 0])
    expect(p.tally.mioto).toMatchObject({ 'held: source refused this run (fewTrips)': 2, 'held: growth guard (qualifies)': 21 })
    // the importer held its creations: no message here (the importer reports it), and nothing moves
    const few = { ...input, rows: [...live, ...expired.slice(0, 3)] }
    expect(plan(few).revive).toHaveLength(3)
    const held = plan({ ...few, held: new Set(['mioto']) })
    expect([held.expire.length, held.revive.length, held.refused]).toEqual([0, 0, {}])
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

describe('statusJournalProblem — a journal is replayed only if it is exactly what applyMoves wrote', () => {
  const sellers = { mioto: {}, janmotorbike: {} }
  const row = { id: 'cmv6bs8vi00kzn9q4a66uo07d', externalId: 'mioto:K24HK8', seller: 'mioto', from: 'active', to: 'expired', updatedAt: '2026-10-13 06:54:10.452', code: 'fewTrips', reason: 'x' }
  const journal = (over: Record<string, unknown> = {}, rows: unknown[] = [row]) => ({ kind: 'vehicle-status', version: 1, createdAt: '2026-10-13T06:55:46.739Z', stamp: '2026-10-13 06:55:46.738', rows, ...over })

  it('accepts what applyMoves writes (a timestamp with or without its fraction)', () => {
    expect(statusJournalProblem(journal(), sellers)).toBeNull()
    expect(statusJournalProblem(journal({}, [{ ...row, from: 'expired', to: 'active', updatedAt: '2026-10-13 06:54:10' }]), sellers)).toBeNull()
  })

  it('refuses the wrong kind, version or stamp', () => {
    expect(statusJournalProblem(journal({ version: 2 }), sellers)).toMatch(/v1/)
    expect(statusJournalProblem(journal({ kind: 'rental-expiry' }), sellers)).toMatch(/v1/)
    expect(statusJournalProblem(journal({ stamp: '2026-10-13T06:55:46Z' }), sellers)).toMatch(/stamp/)
    expect(statusJournalProblem(journal({ stamp: '2026-99-99 99:99:99' }), sellers)).toMatch(/stamp/)
    expect(statusJournalProblem(journal({ stamp: '2026-02-31 10:00:00' }), sellers)).toMatch(/stamp/) // not rolled into March
  })

  it('refuses any malformed row — whole file, before any database work', () => {
    const bad = (over: Record<string, unknown>) => statusJournalProblem(journal({}, [{ ...row, ...over }]), sellers)
    expect(bad({ id: 'x' })).toMatch(/bad id/)
    expect(bad({ from: 'hidden', to: 'active' })).toMatch(/not an expiry or a revival/)
    expect(bad({ updatedAt: 'yesterday' })).toMatch(/updatedAt/)
    expect(bad({ externalId: ' ' })).toMatch(/externalId/)
    expect(bad({ seller: 'someone' })).toMatch(/storefront/)
    expect(bad({ seller: 'constructor' })).toMatch(/storefront/) // own keys only, never the prototype's
    expect(statusJournalProblem(journal({}, [row, row]), sellers)).toMatch(/twice/)
    expect(statusJournalProblem(journal({}, [null]), sellers)).toMatch(/not an object/)
  })
})

describe('planVehicleStatus — the growth guard (revivals) and stale scrapes', () => {
  const many = (k: number, status = 'active', prefix = 'C') => Array.from({ length: k }, (_, i) => car(`mioto:${prefix}${String(i).padStart(5, '0')}`, status))

  it('⛔ holds a source\'s revivals when they exceed max(20, half its live rows) — a broken trips history passes cars in bulk', () => {
    const live = many(40), expired = many(21, 'expired', 'X')
    const verdicts = new Map<string, Verdict>([...live, ...expired].map((r) => [r.externalId!, keep]))
    const ready = new Set(expired.map((r) => r.externalId!))
    const p = plan({ rows: [...live, ...expired], cars: { mioto: { judged: true, verdicts, runs: [] } }, ready })
    expect(p.revive).toEqual([])
    expect(p.refused.mioto).toMatch(/would revive 21 rows against 40 live/)
    expect(p.tally.mioto['held: growth guard (qualifies)']).toBe(21)
    // exactly the cap goes through; --accept overrides
    const twenty = plan({ rows: [...live, ...expired.slice(0, 20)], cars: { mioto: { judged: true, verdicts, runs: [] } }, ready })
    expect(twenty.revive).toHaveLength(20)
    expect(plan({ rows: [...live, ...expired], cars: { mioto: { judged: true, verdicts, runs: [] } }, ready, force: new Set(['mioto']) }).revive).toHaveLength(21)
  })

  it(`lets a small or empty source come back by up to ${GROWTH_ALLOWANCE}`, () => {
    const expired = Array.from({ length: GROWTH_ALLOWANCE }, (_, i) => bike(`janmotorbike:e${i}`, 'expired'))
    const present = new Set(expired.map((r) => r.externalId!))
    const p = plan({ rows: expired, bikes: { janmotorbike: { judged: true, runs: [], present } }, ready: present })
    expect(p.revive).toHaveLength(GROWTH_ALLOWANCE)
    expect(growthRefusal('revive', GROWTH_ALLOWANCE + 1, 0)).toMatch(/would revive 21 rows against 0 live/)
    expect(growthRefusal('create', 50, 100)).toBeNull()
    expect(growthRefusal('create', 51, 100)).toMatch(/would create 51/)
  })

  it('⛔ ONE growth budget: the importer\'s creations this run count against the revivals', () => {
    const live = many(40), expired = many(6, 'expired', 'X')
    const verdicts = new Map<string, Verdict>([...live, ...expired].map((r) => [r.externalId!, keep]))
    const ready = new Set(expired.map((r) => r.externalId!))
    const input = { rows: [...live, ...expired], cars: { mioto: { judged: true, verdicts, runs: [] } }, ready }
    expect(plan(input).revive).toHaveLength(6) // 6 ≤ 20
    // 15 created already this run on 40 live before it: 15 + 6 > 20
    const p = plan({ ...input, growth: { mioto: { liveBefore: 40, created: 15 } } })
    expect(p.revive).toEqual([])
    expect(p.refused.mioto).toMatch(/would revive 6 rows \(\+ 15 created\) against 40 live/)
    expect(plan({ ...input, growth: { mioto: { liveBefore: 40, created: 14 } } }).revive).toHaveLength(6)
    expect(growthRefusal('revive', 380, 761, 1)).toMatch(/\+ 1 created/)
  })

  it('joins a shrink and a growth refusal of one source instead of losing one', () => {
    const live = many(40), expired = many(25, 'expired', 'X')
    const verdicts = new Map<string, Verdict>([...live.map((r) => [r.externalId!, fewTrips] as [string, Verdict]), ...expired.map((r) => [r.externalId!, keep] as [string, Verdict])])
    const p = plan({ rows: [...live, ...expired], cars: { mioto: { judged: true, verdicts, runs: [] } }, ready: new Set(expired.map((r) => r.externalId!)) })
    expect(p.refused.mioto).toMatch(/would expire 40 of 40 .*; would revive 25 rows/)
  })

  it('⛔ revives nothing from a STALE scrape (a re-imported old dataset is not this run\'s evidence)', () => {
    const rows = [car('mioto:KEEP01', 'expired'), bike('janmotorbike:a', 'expired')]
    const ready = new Set(['mioto:KEEP01', 'janmotorbike:a'])
    const p = plan({
      rows, ready,
      cars: { mioto: { judged: false, fresh: false, verdicts: new Map([['mioto:KEEP01', keep]]), runs: [] } },
      bikes: { janmotorbike: { judged: false, fresh: false, runs: [], present: new Set(['janmotorbike:a']) } },
    })
    expect(p.revive).toEqual([])
    expect(p.tally.mioto).toMatchObject({ 'stays expired: qualifies in a stale scrape': 1 })
    expect(p.tally.janmotorbike).toMatchObject({ 'stays expired: listed in a stale scrape': 1 })
  })

  it('heldCreations: per source, more new rows than the cap are held — unless accepted', () => {
    const planned = new Map([['mioto', 380], ['bonboncar', 5], ['janmotorbike', 30]])
    const live = new Map([['mioto', 761], ['bonboncar', 221]])
    expect(Object.keys(heldCreations(planned, live, new Set()))).toEqual(['janmotorbike']) // 30 new against 0 live
    expect(heldCreations(new Map([['mioto', 381]]), live, new Set())).toMatchObject({ mioto: expect.stringMatching(/would create 381 rows against 761 live/) })
    expect(heldCreations(new Map([['mioto', 381]]), live, new Set(['mioto']))).toEqual({})
  })
})

describe('statusInputs — this run + the recorded runs → the plan\'s input and this run\'s record', () => {
  const at = Date.parse('2026-10-16T01:00:00Z')
  const prior = entry('2026-10-13T05:00:00Z', {
    mioto: src('2026-10-13T01:00:00Z', 3, ['mioto:A', 'mioto:B']),
    janmotorbike: src('2026-10-13T01:00:00Z', 40, ['janmotorbike:x'], false),
  })

  it('guards each loaded source, combines this run with every recorded run, and records forced only when accepted', () => {
    const verdicts = new Map<string, Verdict>([['mioto:A', keep], ['mioto:C', keep], ['mioto:D', fewTrips]])
    const r = statusInputs({
      cars: { mioto: { verdicts, scrapedAt: at } },
      bikes: { janmotorbike: { count: 100, present: new Set(['janmotorbike:y']), scrapedAt: at } },
      entries: [prior], fallback: { janmotorbike: 100 }, accept: new Set(['mioto']), now: at + 3_600_000,
    })
    expect(Object.keys(r.guards)).toEqual(['mioto', 'janmotorbike'])
    expect(r.cars.mioto).toMatchObject({ judged: true, fresh: true })
    expect(r.cars.mioto!.runs.map((x) => [x.scrapedAt, x.accepted])).toEqual([[at, true], [Date.parse('2026-10-13T01:00:00Z'), true]])
    expect(r.current.mioto).toMatchObject({ count: 3, accepted: true, forced: true, present: ['mioto:A', 'mioto:C', 'mioto:D'] })
    // the shop's only recorded run was refused: no reference but the baseline (100) — judged; the refused run is in `runs`
    expect(r.guards.janmotorbike).toMatchObject({ judged: true, reference: 100 })
    expect(r.bikes.janmotorbike!.runs.map((x) => x.accepted)).toEqual([true, false])
    expect(r.current.janmotorbike).toMatchObject({ count: 100, accepted: true, forced: false, present: ['janmotorbike:y'] })
    // a source not loaded this run is neither guarded nor recorded
    expect(r.cars.bonboncar).toBeUndefined()
    expect(r.current.bonboncar).toBeUndefined()
  })

  it('a refused (short) scrape is recorded NOT accepted and never forced', () => {
    const r = statusInputs({ cars: {}, bikes: { janmotorbike: { count: 10, present: new Set(), scrapedAt: at } }, entries: [], fallback: { janmotorbike: 100 }, accept: new Set(), now: at })
    expect(r.current.janmotorbike).toMatchObject({ accepted: false, forced: false })
    expect(r.bikes.janmotorbike).toMatchObject({ judged: false, fresh: true })
  })

  it('guardRefusals: only a refused source that HAS live rows is a refusal', () => {
    const g = (accepted: boolean) => ({ judged: accepted, accepted, fresh: true, reference: 1, reason: '' })
    expect(guardRefusals({ mioto: g(false), tuanmotorbike: g(false), bonboncar: g(true) }, new Set(['mioto', 'bonboncar']))).toEqual(['mioto: scrape not accepted (see its guard line)'])
  })
})

describe('baselineCountsFrom — the first run\'s reference', () => {
  it('counts what the gone helper SAW last run, never the rows it carried forward unseen (_carried)', () => {
    const out = baselineCountsFrom({
      mioto: [{ id: 'A' }, { id: 'B', _carried: 1 }, { id: 'C' }],
      bonbon: 'not a list',
      bikes: [{ shop: 'janmotorbike' }, { shop: 'janmotorbike', _carried: 2 }, { shop: 'tuanmotorbike' }, { shop: 'someoneelse' }],
    })
    expect(out).toMatchObject({ mioto: 2, janmotorbike: 1, tuanmotorbike: 1, rentabikevn: 0 })
    expect(out.bonboncar).toBeUndefined()
    expect(baselineCountsFrom({})).toEqual({})
  })
})

describe('growthBaseline — the growth budget survives the job\'s one import retry', () => {
  const start = Date.parse('2026-10-16T21:30:00Z')
  it('rows created since the run began are this run\'s own creations, not live rows of before', () => {
    const rows = [
      { seller: 'mioto', status: 'active', createdAt: start - DAY },
      { seller: 'mioto', status: 'active', createdAt: start - DAY },
      { seller: 'mioto', status: 'expired', createdAt: start - DAY },
      { seller: 'mioto', status: 'active', createdAt: start + 3_600_000 }, // the first attempt created it
      { seller: undefined, status: 'active', createdAt: 0 },
    ]
    const b = growthBaseline(rows, start)
    expect(Object.fromEntries(b.liveBefore)).toEqual({ mioto: 2 })
    expect(Object.fromEntries(b.createdEarlier)).toEqual({ mioto: 1 })
    // no run start (a hand run without the job): every row is "before"
    expect(Object.fromEntries(growthBaseline(rows, NaN).liveBefore)).toEqual({ mioto: 3 })
    // and the earlier attempt's creations count against the same budget
    expect(heldCreations(new Map([['mioto', 20]]), new Map([['mioto', 2]]), new Set(), b.createdEarlier)).toMatchObject({ mioto: expect.stringMatching(/\(\+ 1 created\)/) })
    expect(heldCreations(new Map([['mioto', 19]]), new Map([['mioto', 2]]), new Set(), b.createdEarlier)).toEqual({})
  })
})
