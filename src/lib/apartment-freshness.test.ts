import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BACKSTOP_MISSED_DAYS, BACKSTOP_SLACK_DAYS, BASELINE_RUNS, CARRY_MIN_DATED, EXTERNAL_ID_PREFIX, FRESH_DAYS, MIN_SHARE, SHARE_FLOOR, WINDOW_DAYS_BY_SELLER,
  backstopDaysFor, backstopDaysProblem, baselineOf, freshSetProblem, isInWindow, isRollingWindow, makeFreshSet, planBackstop, planExpiry,
  rollingWindowFrom, windowDaysFor,
} from './apartment-freshness'
import { RENTAL_IMPORT_SELLERS } from './import-sellers'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const DAY = 86_400_000
const SELLER = 'nhatot-import-seller-0001'
const set = (over: Record<string, unknown> = {}, items = [{ externalId: 'nhatot:1000001', sourceDate: new Date(NOW - DAY).toISOString(), dateKind: 'list-time' }]) => ({
  ...makeFreshSet(SELLER, new Date(NOW - 3_600_000), 'read 107 pages; last page older than the window', items as never),
  ...over,
})

describe('isInWindow', () => {
  it('admits today and the 7th day, refuses the 8th and the future', () => {
    expect(isInWindow(new Date(NOW), NOW)).toBe(true)
    expect(isInWindow(new Date(NOW - FRESH_DAYS * DAY), NOW)).toBe(true)
    expect(isInWindow(new Date(NOW - FRESH_DAYS * DAY - 1), NOW)).toBe(false)
    expect(isInWindow(new Date(NOW + 3_600_000), NOW)).toBe(false)
    expect(isInWindow(new Date(NaN), NOW)).toBe(false)
  })
})

describe('freshSetProblem', () => {
  it('accepts a well-formed recent complete set, and an EMPTY one', () => {
    expect(freshSetProblem(set(), NOW)).toBeNull()
    expect(freshSetProblem(set({}, []), NOW, SELLER)).toBeNull()
  })
  it('refuses a set that is old, future, partial or unproven', () => {
    expect(freshSetProblem(set({ fetchedAt: new Date(NOW - 25 * 3_600_000).toISOString() }), NOW)).toMatch(/over 24 h old/)
    expect(freshSetProblem(set({ fetchedAt: new Date(NOW + 3_600_000).toISOString() }), NOW)).toMatch(/future/)
    expect(freshSetProblem(set({ complete: false }), NOW)).toMatch(/partial/)
    expect(freshSetProblem(set({ coverage: ' ' }), NOW)).toMatch(/coverage/)
    expect(freshSetProblem(set({ windowDays: 14 }), NOW)).toMatch(/windowDays/)
  })
  it('refuses another seller, a non-rental seller and the wrong expected seller', () => {
    expect(freshSetProblem(set({ sellerId: 'careerlink-vn-import-seller-0001' }), NOW)).toMatch(/not a rental import seller/)
    expect(freshSetProblem(set(), NOW, 'muaban-net-import-seller-0001')).toMatch(/not muaban/)
  })
  it("refuses an item of another source's id space, a duplicate, an old or future date, a bad kind", () => {
    const ok = { externalId: 'nhatot:1000001', sourceDate: new Date(NOW - DAY).toISOString(), dateKind: 'list-time' }
    expect(freshSetProblem(set({}, [{ ...ok, externalId: 'bds:pr1' }]), NOW)).toMatch(/not a nhatot:/)
    expect(freshSetProblem(set({}, [{ ...ok, externalId: 'nhatot:' }]), NOW)).toMatch(/not a nhatot:/)
    // Right prefix, wrong shape — a source that changed its id scheme.
    expect(freshSetProblem(set({}, [{ ...ok, externalId: 'nhatot:abc-123' }]), NOW)).toMatch(/shape/)
    expect(freshSetProblem(set({}, [ok, ok]), NOW)).toMatch(/twice/)
    expect(freshSetProblem(set({}, [{ ...ok, sourceDate: new Date(NOW - 10 * DAY).toISOString() }]), NOW)).toMatch(/outside/)
    expect(freshSetProblem(set({}, [{ ...ok, sourceDate: new Date(NOW + DAY).toISOString() }]), NOW)).toMatch(/outside/)
    expect(freshSetProblem(set({}, [{ ...ok, dateKind: 'posted' }]), NOW)).toMatch(/dateKind/)
  })
  it('judges the window strictly — no day of slack for any source', () => {
    const fetchedAt = NOW - 3_600_000
    const at = (ms: number) => [{ externalId: 'nhatot:1000001', sourceDate: new Date(ms).toISOString(), dateKind: 'list-time' }]
    expect(freshSetProblem(set({}, at(fetchedAt - FRESH_DAYS * DAY)), NOW)).toBeNull()
    expect(freshSetProblem(set({}, at(fetchedAt - FRESH_DAYS * DAY - 60_000)), NOW)).toMatch(/outside/)
  })
  it('checks the undetermined list: id space, overlap with items, and its share', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ externalId: `nhatot:${1000000 + i}`, sourceDate: new Date(NOW - DAY).toISOString(), dateKind: 'list-time' }))
    expect(freshSetProblem(set({ unknown: ['nhatot:1000900', 'nhatot:1000901'] }, items), NOW)).toBeNull()
    expect(freshSetProblem(set({ unknown: ['bds:pr1'] }, items), NOW)).toMatch(/not a nhatot:/)
    expect(freshSetProblem(set({ unknown: ['nhatot:1000005'] }, items), NOW)).toMatch(/also an item/)
    expect(freshSetProblem(set({ unknown: 'x' }, items), NOW)).toMatch(/unknown is not an array/)
    const many = Array.from({ length: 6 }, (_, i) => `nhatot:${1000900 + i}`)
    expect(freshSetProblem(set({ unknown: many }, items), NOW)).toMatch(/undetermined/)
    // A tiny source may leave a handful undetermined without tripping the share.
    expect(freshSetProblem(set({ unknown: many.slice(0, 5) }, items.slice(0, 3)), NOW)).toBeNull()
  })
  it('refuses junk', () => {
    expect(freshSetProblem(null, NOW)).toMatch(/not a JSON object/)
    expect(freshSetProblem([], NOW)).toMatch(/not a JSON object/)
    expect(freshSetProblem(set({ kind: 'x' }), NOW)).toMatch(/kind/)
    expect(freshSetProblem(set({ items: {} }), NOW)).toMatch(/items/)
  })
})

describe('baselineOf', () => {
  it('is the largest of the last BASELINE_RUNS applied counts, or null with no history', () => {
    expect(baselineOf([])).toBeNull()
    expect(baselineOf([100, 61, 40])).toBe(100)
    expect(baselineOf([500, ...Array(BASELINE_RUNS).fill(10)])).toBe(10)
  })
})

describe('planExpiry', () => {
  it('keeps a row the step could not judge', () => {
    const p = planExpiry({ active: [{ id: 'A', externalId: 'nhatot:1' }, { id: 'B', externalId: 'nhatot:2' }], fresh: new Set(), unknown: new Set(['nhatot:2']), baseline: null })
    expect(p.expire).toEqual(['A'])
    expect(p.keep).toBe(1)
  })
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `L${i}`, externalId: `nhatot:${i}` }))
  it('expires exactly the live rows missing from the set, and never a row without an externalId', () => {
    const p = planExpiry({ active: [...rows(3), { id: 'X', externalId: null }], fresh: new Set(['nhatot:1']), baseline: null })
    expect(p.expire).toEqual(['L0', 'L2'])
    expect(p.keep).toBe(2)
    expect(p.noExternalId).toBe(1)
    expect(p.refusal).toBeNull()
  })
  it('refuses a set that shrank under MIN_SHARE of the last applied one', () => {
    const fresh = new Set(Array.from({ length: 50 }, (_, i) => `nhatot:${i}`))
    const p = planExpiry({ active: rows(100), fresh, baseline: Math.ceil(50 / MIN_SHARE) + 1 })
    expect(p.expire).toHaveLength(50)
    expect(p.refusal).toMatch(/blocked or partial/)
    expect(planExpiry({ active: rows(100), fresh, baseline: Math.floor(50 / MIN_SHARE) }).refusal).toBeNull()
    expect(planExpiry({ active: rows(100), fresh, baseline: 1000, force: true }).refusal).toBeNull()
  })
  it('refuses a set whose ids mostly do not exist in the database (an id-space mismatch)', () => {
    // 40 of the live rows plus 60 ids the database has never seen.
    const fresh = new Set([...Array.from({ length: 40 }, (_, i) => `nhatot:${i}`), ...Array.from({ length: 60 }, (_, i) => `nhatot:${5000 + i}`)])
    expect(planExpiry({ active: rows(100), fresh, baseline: 100, knownInDb: 1 }).refusal).toMatch(/disagree on ids/)
    expect(planExpiry({ active: rows(100), fresh, baseline: 100, knownInDb: 30 }).refusal).toBeNull()
    expect(planExpiry({ active: rows(100), fresh, baseline: 100, knownInDb: 1, force: true }).refusal).toBeNull()
    // A tiny set is not judged by share.
    expect(planExpiry({ active: rows(3), fresh: new Set(['nhatot:5000']), baseline: null, knownInDb: 0 }).refusal).toBeNull()
  })
  it('does not apply the share guard to a tiny source', () => {
    expect(planExpiry({ active: rows(3), fresh: new Set(), baseline: SHARE_FLOOR - 1 }).refusal).toBeNull()
  })
  it('with no history, refuses to take more than half of a source that is not tiny unless forced', () => {
    const keepOne = new Set(['nhatot:0'])
    expect(planExpiry({ active: rows(100), fresh: keepOne, baseline: null }).refusal).toMatch(/no applied history/)
    expect(planExpiry({ active: rows(100), fresh: keepOne, baseline: SHARE_FLOOR - 1 }).refusal).toMatch(/no applied history/)
    expect(planExpiry({ active: rows(100), fresh: keepOne, baseline: null, force: true }).refusal).toBeNull()
    const keepHalf = new Set(Array.from({ length: 50 }, (_, i) => `nhatot:${i}`))
    expect(planExpiry({ active: rows(100), fresh: keepHalf, baseline: null }).refusal).toBeNull()
  })
  it('refuses to empty a source that is not tiny unless forced', () => {
    expect(planExpiry({ active: rows(SHARE_FLOOR), fresh: new Set(), baseline: null }).refusal).toMatch(/ALL/)
    expect(planExpiry({ active: rows(SHARE_FLOOR - 1), fresh: new Set(), baseline: null }).refusal).toBeNull()
    expect(planExpiry({ active: rows(SHARE_FLOOR), fresh: new Set(), baseline: null, force: true }).refusal).toBeNull()
  })
})

const HONEYCOMB = 'honeycomb-import-seller-0001'
/** The four sources whose window stays FRESH_DAYS (7), and the id each one writes. */
const SEVEN_DAY: readonly [string, string, string][] = [
  ['nhatot-import-seller-0001', 'nhatot:1000001', 'list-time'],
  ['muaban-net-import-seller-0001', 'muaban:1000001', 'created'],
  ['cmub0wead0000zrq418bqq27m', 'rever:1700000000000_1', 'updated'],
  ['bds-vn-import-seller-0001', 'bds:pr1000001', 'renewal-label'],
]

describe('⛔ the window per source — one table, Honeycomb 30, every other source 7', () => {
  it('windowDaysFor: Honeycomb 30; Nhà Tốt, Muaban, Rever, Batdongsan — and any unlisted seller — FRESH_DAYS (7)', () => {
    expect(FRESH_DAYS).toBe(7)
    expect(windowDaysFor(HONEYCOMB)).toBe(30)
    for (const [seller] of SEVEN_DAY) expect(windowDaysFor(seller), seller).toBe(7)
    expect(windowDaysFor('careerlink-vn-import-seller-0001')).toBe(7)
    expect(windowDaysFor('')).toBe(7)
  })
  it('the table lists Honeycomb ONLY, and every rental seller is covered by it or the default', () => {
    expect(WINDOW_DAYS_BY_SELLER).toEqual({ [HONEYCOMB]: 30 })
    expect(Object.isFrozen(WINDOW_DAYS_BY_SELLER)).toBe(true)
    expect(new Set([...SEVEN_DAY.map(([s]) => s), HONEYCOMB])).toEqual(new Set(RENTAL_IMPORT_SELLERS))
    for (const seller of RENTAL_IMPORT_SELLERS) expect(Number.isInteger(windowDaysFor(seller)) && windowDaysFor(seller) >= FRESH_DAYS, seller).toBe(true)
  })
  it("makeFreshSet records the window its STEP judged by — FRESH_DAYS unless the step passes its own, never the table's", () => {
    const at = new Date(NOW - 3_600_000)
    expect(makeFreshSet('nhatot-import-seller-0001', at, 'c', []).windowDays).toBe(7)
    // A step that did not pass its window records 7 even for Honeycomb — and freshSetProblem then refuses it.
    expect(makeFreshSet(HONEYCOMB, at, 'c', []).windowDays).toBe(7)
    expect(makeFreshSet(HONEYCOMB, at, 'c', [], [], 30).windowDays).toBe(30)
  })
  it('isInWindow takes the window: 30 days admits day 30, refuses 30 d + 1 ms', () => {
    expect(isInWindow(new Date(NOW - 20 * DAY), NOW, 30)).toBe(true)
    expect(isInWindow(new Date(NOW - 20 * DAY), NOW)).toBe(false)
    expect(isInWindow(new Date(NOW - 30 * DAY), NOW, 30)).toBe(true)
    expect(isInWindow(new Date(NOW - 30 * DAY - 1), NOW, 30)).toBe(false)
  })
})

describe('⛔ freshSetProblem judges a set by its SELLER\'s window — a mismatched window is refused', () => {
  const fetched = NOW - 3_600_000
  const hc = (windowDays: number, ages: number[]) => makeFreshSet(HONEYCOMB, new Date(fetched), 'all 7 sitemaps read',
    ages.map((d, i) => ({ externalId: `honeycomb:${100 + i}`, sourceDate: new Date(fetched - d).toISOString(), dateKind: 'modified' as const })), [], windowDays)
  it('a Honeycomb 30-day set is accepted, with items 20 days and exactly 30 days old', () => {
    expect(freshSetProblem(hc(30, [DAY, 20 * DAY, 30 * DAY]), NOW, HONEYCOMB)).toBeNull()
    expect(freshSetProblem(JSON.parse(JSON.stringify(hc(30, []))), NOW, HONEYCOMB)).toBeNull()
  })
  it('a Honeycomb item past 30 days is outside its window', () => {
    expect(freshSetProblem(hc(30, [31 * DAY]), NOW, HONEYCOMB)).toMatch(/outside the 30-day window/)
    expect(freshSetProblem(hc(30, [30 * DAY + 60_000]), NOW, HONEYCOMB)).toMatch(/outside the 30-day window/)
  })
  it('⛔ a 7-day set can never drive Honeycomb\'s expiry (it would expire every 8–30-day-old flat)', () => {
    expect(freshSetProblem(hc(7, [DAY]), NOW, HONEYCOMB)).toMatch(/windowDays 7, expected 30 for honeycomb-import-seller-0001/)
    expect(freshSetProblem(hc(7, []), NOW)).toMatch(/windowDays 7, expected 30/)
    // Nor any other window, nor a missing one.
    expect(freshSetProblem(hc(31, []), NOW)).toMatch(/windowDays 31, expected 30/)
    expect(freshSetProblem({ ...hc(30, []), windowDays: undefined }, NOW)).toMatch(/windowDays undefined, expected 30/)
    expect(freshSetProblem({ ...hc(30, []), windowDays: '30' }, NOW)).toMatch(/windowDays "30", expected 30/)
  })
  it.each(SEVEN_DAY)('⛔ %s keeps the 7-day window: its 7-day set passes, a 30-day set is refused, an 8-day item is outside', (seller, id, dateKind) => {
    const mk = (windowDays: number, age: number) => makeFreshSet(seller, new Date(fetched), 'whole read', [{ externalId: id, sourceDate: new Date(fetched - age).toISOString(), dateKind: dateKind as never }], [], windowDays)
    expect(EXTERNAL_ID_PREFIX[seller as keyof typeof EXTERNAL_ID_PREFIX]).toBe(id.slice(0, id.indexOf(':') + 1))
    expect(freshSetProblem(mk(7, DAY), NOW, seller)).toBeNull()
    expect(freshSetProblem(mk(7, 7 * DAY), NOW, seller)).toBeNull()
    // The step's own default (no window passed) is still 7 — unchanged for these sources.
    expect(freshSetProblem(makeFreshSet(seller, new Date(fetched), 'whole read', []), NOW, seller)).toBeNull()
    expect(freshSetProblem(mk(30, DAY), NOW, seller)).toMatch(/windowDays 30, expected 7/)
    expect(freshSetProblem(mk(7, 8 * DAY), NOW, seller)).toMatch(/outside the 7-day window/)
    expect(freshSetProblem(mk(7, 20 * DAY), NOW, seller)).toMatch(/outside the 7-day window/)
  })
})

describe('⛔ the backstop, per source: the seller\'s window + the same slack', () => {
  it('backstopDaysFor: 7-day sources 14 (as before), Honeycomb 37 — never 8', () => {
    expect(BACKSTOP_SLACK_DAYS).toBe(7)
    expect(BACKSTOP_MISSED_DAYS).toBe(8)
    for (const [seller] of SEVEN_DAY) expect(backstopDaysFor(seller), seller).toBe(14)
    expect(backstopDaysFor(HONEYCOMB)).toBe(37)
  })
  it('backstopDaysProblem: at least the window + 1 day, a whole number', () => {
    for (const [seller] of SEVEN_DAY) {
      expect(backstopDaysProblem(seller, 8), seller).toBeNull()
      expect(backstopDaysProblem(seller, 14), seller).toBeNull()
      expect(backstopDaysProblem(seller, 7), seller).toMatch(/≥ 8 \(its 7-day window plus at least a day\)/)
    }
    expect(backstopDaysProblem(HONEYCOMB, 31)).toBeNull()
    expect(backstopDaysProblem(HONEYCOMB, 37)).toBeNull()
    // ⛔ The old one-size 14 (and the old minimum 8) would expire flats inside Honeycomb's window.
    expect(backstopDaysProblem(HONEYCOMB, 14)).toMatch(/≥ 31 \(its 30-day window plus at least a day\)/)
    expect(backstopDaysProblem(HONEYCOMB, 30)).toMatch(/≥ 31/)
    for (const bad of [null, Number.NaN, 31.5, -1]) expect(backstopDaysProblem(HONEYCOMB, bad), String(bad)).toMatch(/integer/)
    for (const seller of RENTAL_IMPORT_SELLERS) expect(backstopDaysProblem(seller, backstopDaysFor(seller)), seller).toBeNull()
  })
  const rowsAged = (ages: number[]) => ages.map((d) => ({ id: `L${d}`, postedAt: new Date(NOW - d * DAY) }))
  it('acts only when the last applied fresh set is over BACKSTOP_MISSED_DAYS old (or there never was one)', () => {
    const active = rowsAged([1, 20, 40])
    expect(planBackstop({ active, lastFreshAt: new Date(NOW - 8 * DAY).toISOString(), now: NOW, days: 14 })).toEqual({ act: false, missedDays: 8 })
    expect(planBackstop({ active, lastFreshAt: new Date(NOW - 9 * DAY).toISOString(), now: NOW, days: 14 })).toMatchObject({ act: true, missedDays: 9 })
    expect(planBackstop({ active, lastFreshAt: null, now: NOW, days: 14 })).toMatchObject({ act: true, missedDays: Infinity })
  })
  it('⛔ a stopped Honeycomb (37 days) keeps rows 20 and 31 days old — inside its window — and expires only past 37; a 7-day source expires past 14', () => {
    const active = rowsAged([1, 13, 15, 20, 31, 36, 38, 60])
    const missed = new Date(NOW - 10 * DAY).toISOString()
    const hc = planBackstop({ active, lastFreshAt: missed, now: NOW, days: backstopDaysFor(HONEYCOMB) })
    expect(hc).toMatchObject({ act: true, cutoff: new Date(NOW - 37 * DAY) })
    expect(hc.act && hc.expire).toEqual(['L38', 'L60'])
    const nt = planBackstop({ active, lastFreshAt: missed, now: NOW, days: backstopDaysFor('nhatot-import-seller-0001') })
    expect(nt).toMatchObject({ act: true, cutoff: new Date(NOW - 14 * DAY) })
    expect(nt.act && nt.expire).toEqual(['L15', 'L20', 'L31', 'L36', 'L38', 'L60'])
  })
})

describe('⛔ a ROLLING window (Honeycomb) is guarded by carry-over, never by the count guards', () => {
  it('isRollingWindow / rollingWindowFrom: Honeycomb only — its window start at the fetch; null for every 7-day source', () => {
    expect(isRollingWindow(HONEYCOMB)).toBe(true)
    const fetchedAt = '2026-10-04T23:00:00.000Z'
    expect(rollingWindowFrom(HONEYCOMB, fetchedAt)).toBe(Date.parse(fetchedAt) - 30 * DAY)
    for (const [seller] of SEVEN_DAY) {
      expect(isRollingWindow(seller)).toBe(false)
      expect(rollingWindowFrom(seller, fetchedAt)).toBeNull()
    }
    expect(() => rollingWindowFrom(HONEYCOMB, 'not a date')).toThrow(/not a date/)
  })

  /**
   * ⛔ THE REGRESSION (review of 2026-10-02): Honeycomb's REAL staged lastmods — the 31 apartment posts of
   * ~/eno-import-journals/honeycomb-vn/comvn-30d-stage.json (fetched 2026-10-02), 09-08…09-18, nothing since —
   * run through the weekly job's loop (Mondays 06:00 ICT). The count guards took 31 as the baseline on the
   * first apply, refused the set of 6 a week later as "a blocked or partial crawl", and refused every week
   * after (a refusal records no new baseline), so the 30-day rule never ran and the backstop took the flats
   * down at 38–41 days with a FAILED alert each week.
   */
  const LASTMODS = [
    '2026-09-08T14:11:33+07:00', '2026-09-08T14:37:29+07:00', '2026-09-08T14:55:03+07:00', '2026-09-08T16:05:03+07:00',
    '2026-09-08T16:26:55+07:00', '2026-09-08T16:38:07+07:00', '2026-09-08T16:53:13+07:00', '2026-09-10T09:19:12+07:00',
    '2026-09-10T09:31:49+07:00', '2026-09-10T09:39:35+07:00', '2026-09-10T10:01:05+07:00', '2026-09-10T10:25:05+07:00',
    '2026-09-10T10:34:01+07:00', '2026-09-10T10:48:10+07:00', '2026-09-10T10:55:10+07:00', '2026-09-10T11:03:30+07:00',
    '2026-09-10T11:45:49+07:00', '2026-09-10T13:36:29+07:00', '2026-09-10T13:47:39+07:00', '2026-09-10T14:25:31+07:00',
    '2026-09-10T14:37:31+07:00', '2026-09-10T14:45:29+07:00', '2026-09-10T15:30:16+07:00', '2026-09-11T11:16:33+07:00',
    '2026-09-11T14:18:11+07:00', '2026-09-16T15:54:56+07:00', '2026-09-17T13:44:34+07:00', '2026-09-17T14:41:55+07:00',
    '2026-09-17T16:24:25+07:00', '2026-09-17T16:51:36+07:00', '2026-09-18T10:45:45+07:00',
  ]
  /** The staged posts as the apply leaves them: live, postedAt = the lastmod (revival / create). */
  const staged = LASTMODS.map((lm, i) => ({ id: `H${i}`, externalId: `honeycomb:${9000 + i}`, postedAt: new Date(lm) }))
  const MONDAYS = ['2026-10-04T23:00:00.000Z', '2026-10-11T23:00:00.000Z', '2026-10-18T23:00:00.000Z', '2026-10-25T23:00:00.000Z']
  /** One weekly job: fresh set → expiry (planExpiry, as scripts/expire-apartment-rentals.ts calls it) → backstop. */
  function weeks(rolling: boolean) {
    // The state as it stands: the forced 2026-10-01 cleanup, one fresh run of 0.
    const runs: { at: string; freshCount: number; mode: 'fresh' | 'backstop' }[] = [{ at: '2026-10-01T15:27:28.778Z', freshCount: 0, mode: 'fresh' }]
    let active = [...staged]
    return MONDAYS.map((at) => {
      const t = Date.parse(at)
      const fresh = new Set(staged.filter((r) => isInWindow(r.postedAt, t, windowDaysFor(HONEYCOMB))).map((r) => r.externalId))
      const plan = planExpiry({
        active, fresh, knownInDb: fresh.size,
        baseline: baselineOf(runs.filter((r) => r.mode === 'fresh').map((r) => r.freshCount)),
        rollingFrom: rolling ? rollingWindowFrom(HONEYCOMB, at) : null,
      })
      const expiredAges: number[] = []
      if (!plan.refusal) {
        for (const r of active) if (plan.expire.includes(r.id)) expiredAges.push((t - r.postedAt.getTime()) / DAY)
        active = active.filter((r) => !plan.expire.includes(r.id))
        runs.push({ at, freshCount: fresh.size, mode: 'fresh' })
      }
      const lastFreshAt = runs.filter((r) => r.mode === 'fresh').at(-1)!.at
      const bp = planBackstop({ active, lastFreshAt, now: t + 3_600_000, days: backstopDaysFor(HONEYCOMB) })
      if (bp.act) active = active.filter((r) => !bp.expire.includes(r.id))
      return { set: fresh.size, refusal: plan.refusal, expired: plan.refusal ? 0 : plan.expire.length, expiredAges, backstop: bp.act ? bp.expire.length : 0, live: active.length }
    })
  }
  it('the count guards (the bug): week 2 refused as a "blocked or partial crawl", every week after too; the backstop takes the flats at 37+ days', () => {
    const w = weeks(false)
    expect(w.map((x) => x.set)).toEqual([31, 6, 0, 0])
    expect(w[0].refusal).toBeNull()
    expect(w[1].refusal).toMatch(/6 items, under 60% of the last applied 31/)
    expect(w[2].refusal).toMatch(/0 items, under 60% of the last applied 31/)
    expect(w[3].refusal).toMatch(/under 60% of the last applied 31/)
    expect(w.map((x) => x.backstop)).toEqual([0, 0, 25, 6])
  })
  it('⛔ carry-over: every week applies, each flat leaves at the first weekly run past its 30 days, and the backstop never acts', () => {
    const w = weeks(true)
    expect(w.map((x) => x.refusal)).toEqual([null, null, null, null])
    expect(w.map((x) => x.expired)).toEqual([0, 25, 6, 0])
    expect(w.map((x) => x.live)).toEqual([31, 6, 0, 0])
    expect(w.map((x) => x.backstop)).toEqual([0, 0, 0, 0])
    // Taken down past 30 days and inside one weekly cadence after it — never at the backstop's 37.
    const ages = w.flatMap((x) => x.expiredAges)
    expect(ages).toHaveLength(31)
    for (const a of ages) { expect(a).toBeGreaterThan(30); expect(a).toBeLessThan(37) }
  })

  const FROM = NOW - 30 * DAY
  /** `n` live Honeycomb rows dated `ageDays` before NOW (postedAt), ids offset by `at`. */
  const hc = (n: number, ageDays: number, at = 0) => Array.from({ length: n }, (_, i) => ({ id: `R${at + i}`, externalId: `honeycomb:${at + i}`, postedAt: new Date(NOW - ageDays * DAY) }))
  const ids = (rows: { externalId: string }[]) => new Set(rows.map((r) => r.externalId))
  it('refuses a set missing over 1 − MIN_SHARE of the live rows still dated inside the window — a short crawl', () => {
    const inside = hc(25, 10)
    const listed = Math.ceil(MIN_SHARE * 25) // 15
    const short = planExpiry({ active: inside, fresh: ids(inside.slice(0, listed - 1)), baseline: null, rollingFrom: FROM })
    expect(short.carry).toEqual({ dated: 25, missing: 25 - listed + 1 })
    expect(short.refusal).toMatch(/missing from the set — under 60% of them listed again reads as a blocked or partial crawl/)
    expect(planExpiry({ active: inside, fresh: ids(inside.slice(0, listed)), baseline: null, rollingFrom: FROM }).refusal).toBeNull()
    // An undetermined row is listed (kept), not missing.
    expect(planExpiry({ active: inside, fresh: ids(inside.slice(0, 5)), unknown: ids(inside.slice(5, listed)), baseline: null, rollingFrom: FROM }).refusal).toBeNull()
    expect(planExpiry({ active: inside, fresh: new Set(), baseline: null, rollingFrom: FROM, force: true }).refusal).toBeNull()
  })
  it('⛔ an EMPTY set: refused while ≥ SHARE_FLOOR rows are dated inside the window, applied when they all aged out', () => {
    const inside = hc(SHARE_FLOOR, 29)
    expect(planExpiry({ active: inside, fresh: new Set(), baseline: null, rollingFrom: FROM }).refusal).toMatch(/blocked or partial crawl/)
    // A row exactly at the window's start is still inside it (isInWindow admits day 30).
    expect(planExpiry({ active: hc(SHARE_FLOOR, 30), fresh: new Set(), baseline: null, rollingFrom: FROM }).carry).toEqual({ dated: SHARE_FLOOR, missing: SHARE_FLOOR })
    const agedOut = hc(40, 31)
    const all = planExpiry({ active: agedOut, fresh: new Set(), baseline: 40, rollingFrom: FROM })
    expect(all.refusal).toBeNull()
    expect(all.expire).toHaveLength(40)
    expect(all.carry).toEqual({ dated: 0, missing: 0 })
    // The same rows under the count guards: "ALL live rows" / under 60% of the baseline.
    expect(planExpiry({ active: agedOut, fresh: new Set(), baseline: 40 }).refusal).toMatch(/under 60% of the last applied 40/)
    expect(planExpiry({ active: agedOut, fresh: new Set(), baseline: null }).refusal).toMatch(/ALL 40 live rows/)
  })
  it('counts only rows dated inside the window: aged-out rows leave freely', () => {
    const aged = hc(30, 35)
    const inside = hc(10, 5, 100)
    const p = planExpiry({ active: [...aged, ...inside], fresh: ids(inside), baseline: 100, rollingFrom: FROM })
    expect(p).toMatchObject({ refusal: null, carry: { dated: 10, missing: 0 } })
    expect(p.expire).toHaveLength(30)
  })

  /**
   * ⛔ THE REGRESSION (review of 2026-10-02, rated High): under SHARE_FLOOR rows dated inside the window the
   * carry-over guard judged nothing, and the count guards' expire-ALL no longer applied to a rolling seller.
   * Reproduced: 24 live Honeycomb rows, 6 of them dated inside the window, every in-window /property/ page
   * answering 404 (a WordPress rewrite fault — wp-sitemap still lists them) → a set of 0 items and 0
   * undetermined → carry { dated 6, missing 6 }, no refusal, all 24 expired, the 6 fresh flats included.
   */
  describe('⛔ below SHARE_FLOOR, and expire-ALL — the 404-fault regression', () => {
    /** Live rows at these ages (days before NOW), ids offset by `at`. */
    const aged = (ages: number[], at: number) => ages.map((d, i) => ({ id: `R${at + i}`, externalId: `honeycomb:${at + i}`, postedAt: new Date(NOW - d * DAY) }))
    const inWindow = aged([2, 5, 9, 14, 20, 29], 100)
    const agedOut = aged(Array.from({ length: 18 }, (_, i) => 31 + 2 * i), 0)
    const live = [...agedOut, ...inWindow]

    it('the reproduced case is REFUSED: 24 live, 6 dated inside the window, a set of 0 items / 0 undetermined', () => {
      expect(live).toHaveLength(24)
      const p = planExpiry({ active: live, fresh: new Set(), unknown: new Set(), baseline: 31, knownInDb: 0, rollingFrom: FROM })
      expect(p.carry).toEqual({ dated: 6, missing: 6 })
      expect(p.expire).toHaveLength(24)
      expect(p.refusal).toMatch(/^6 of the 6 live rows last seen dated inside the window \(postedAt ≥ .*\) are missing from the set — 60% or more of them gone in one read reads as a source fault/)
      // An operator with independent evidence still can.
      expect(planExpiry({ active: live, fresh: new Set(), baseline: 31, rollingFrom: FROM, force: true })).toMatchObject({ refusal: null, expire: expect.any(Array) })
      // The count guards the rolling seller left behind refused the same input — the guard is back, not new.
      expect(planExpiry({ active: live, fresh: new Set(), baseline: null }).refusal).toMatch(/ALL 24 live rows/)
    })

    it('normal aging-out still applies below the floor: rows past 30 days leave, the in-window rows in the set stay', () => {
      const p = planExpiry({ active: live, fresh: ids(inWindow), baseline: 31, knownInDb: 6, rollingFrom: FROM })
      expect(p).toMatchObject({ refusal: null, carry: { dated: 6, missing: 0 }, keep: 6 })
      expect(p.expire).toEqual(agedOut.map((r) => r.id))
      // A flat or two let in a week is the market: under 60% of the dated rows missing is applied.
      for (const missing of [1, 2, 3]) {
        const q = planExpiry({ active: live, fresh: ids(inWindow.slice(missing)), baseline: 31, rollingFrom: FROM })
        expect(q.refusal, `${missing} of 6 missing`).toBeNull()
        expect(q.expire).toHaveLength(18 + missing)
      }
      expect(planExpiry({ active: live, fresh: ids(inWindow.slice(4)), baseline: 31, rollingFrom: FROM }).refusal).toMatch(/4 of the 6 live rows/)
      // An undetermined row is listed (kept), not missing.
      expect(planExpiry({ active: live, fresh: new Set(), unknown: ids(inWindow), baseline: 31, rollingFrom: FROM })).toMatchObject({ refusal: null, carry: { dated: 6, missing: 0 } })
    })

    it(`from CARRY_MIN_DATED (${CARRY_MIN_DATED}) dated rows, MIN_SHARE or more missing is refused — and the threshold meets the share rule at SHARE_FLOOR without a cliff`, () => {
      expect(CARRY_MIN_DATED).toBe(3)
      /** `dated` live rows all inside the window, the first `missing` of them absent from the set. */
      const judge = (dated: number, missing: number) => {
        const rows = hc(dated, 10)
        return planExpiry({ active: rows, fresh: ids(rows.slice(missing)), baseline: null, rollingFrom: FROM }).refusal
      }
      // [dated, the fewest missing that is refused] — ≥ 60% missing below the floor, over 40% from it.
      const cases: [number, number][] = [[3, 2], [4, 3], [5, 3], [10, 6], [19, 12], [SHARE_FLOOR, 9], [25, 11]]
      for (const [dated, refusedFrom] of cases) {
        expect(judge(dated, refusedFrom), `${refusedFrom} of ${dated}`).toMatch(/missing from the set/)
        expect(judge(dated, refusedFrom - 1), `${refusedFrom - 1} of ${dated}`).toBeNull()
      }
      // Under CARRY_MIN_DATED a share is noise: one or two rows gone (a tiny source) are applied.
      expect(judge(2, 2)).toBeNull()
      expect(judge(1, 1)).toBeNull()
    })

    it('⛔ expire-ALL is restored for a rolling seller: every live row of a source that is not tiny, while any is dated inside the window', () => {
      const twoInside = [...aged(Array.from({ length: 22 }, (_, i) => 31 + i), 0), ...aged([3, 25], 100)]
      const p = planExpiry({ active: twoInside, fresh: new Set(), baseline: 31, rollingFrom: FROM })
      // Under CARRY_MIN_DATED, so only the expire-ALL guard can see it.
      expect(p.carry).toEqual({ dated: 2, missing: 2 })
      expect(p.refusal).toMatch(/this would mark ALL 24 live rows expired while 2 of them were last seen dated inside the window/)
      expect(planExpiry({ active: twoInside.slice(1), fresh: new Set(), baseline: 31, rollingFrom: FROM }).refusal).toMatch(/ALL 23 live rows/)
      expect(planExpiry({ active: twoInside, fresh: new Set(), baseline: 31, rollingFrom: FROM, force: true }).refusal).toBeNull()
      // One dated row in the set: not every row, applied.
      expect(planExpiry({ active: twoInside, fresh: ids(twoInside.slice(-1)), baseline: 31, rollingFrom: FROM })).toMatchObject({ refusal: null, carry: { dated: 2, missing: 1 } })
      // ⛔ Every live row aged out: emptying the source is the rule working (the simulation's third week).
      const allAged = aged(Array.from({ length: 24 }, (_, i) => 31 + i), 0)
      expect(planExpiry({ active: allAged, fresh: new Set(), baseline: 31, rollingFrom: FROM })).toMatchObject({ refusal: null, carry: { dated: 0, missing: 0 } })
      // A tiny source (under SHARE_FLOOR live rows) may be emptied, as under the count guards.
      expect(planExpiry({ active: twoInside.slice(-SHARE_FLOOR + 1), fresh: new Set(), baseline: 31, rollingFrom: FROM }).refusal).toBeNull()
    })
  })
  it('keeps the id-space guard; needs every live row\'s postedAt; reports no carry for a cadence-window seller', () => {
    const inside = hc(30, 3)
    expect(planExpiry({ active: inside, fresh: ids(inside), baseline: null, knownInDb: 1, rollingFrom: FROM }).refusal).toMatch(/disagree on ids/)
    expect(() => planExpiry({ active: [{ id: 'X', externalId: 'honeycomb:1' }], fresh: new Set(), baseline: null, rollingFrom: FROM })).toThrow(/no postedAt/)
    expect(() => planExpiry({ active: [], fresh: new Set(), baseline: null, rollingFrom: NaN })).toThrow(/not a time/)
    expect(planExpiry({ active: [{ id: 'A', externalId: 'nhatot:1' }], fresh: new Set(), baseline: null }).carry).toBeNull()
  })
})

describe('⛔ the weekly job and the expiry read the window from this table, never a copy', () => {
  const sh = readFileSync(join(process.cwd(), 'scripts/apartments-weekly.sh'), 'utf8')
  const shCode = sh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const expire = readFileSync(join(process.cwd(), 'scripts/expire-apartment-rentals.ts'), 'utf8')
  const expireCode = expire.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  it('the backstop passes --backstop (the seller\'s own cutoff), never one --backstop-days for every source', () => {
    expect(shCode).toMatch(/npx tsx scripts\/expire-apartment-rentals\.ts --seller "\$seller" --backstop --state-dir "\$STATE"/)
    expect(shCode).not.toMatch(/--backstop-days|BACKSTOP_DAYS/)
  })
  it("Honeycomb's stage reads its --since-days from windowDaysFor; the 7-day sources keep their 7", () => {
    expect(shCode).toMatch(/days="\$\(npx tsx -e "import \{ windowDaysFor \} from '\.\/src\/lib\/apartment-freshness'; console\.log\(windowDaysFor\('\$S'\)\)"/)
    expect(shCode).toMatch(/npx tsx scripts\/import-honeycomb-com-vn\.ts --since-days "\$days" --save "\$STAGE" --fresh-out "\$FRESH"/)
    expect(shCode).not.toMatch(/import-honeycomb-com-vn\.ts --since-days 7/)
    expect(shCode).toMatch(/import-nhatot-com\.ts --cg 1010 --max-age-days 7 --save/)
    expect(shCode).toMatch(/import-nhatot-com\.ts --src "\$STAGE" --max-age-days 7/)
    expect(shCode).toMatch(/import-batdongsan-rentals\.ts --src "\$BDS\/all_rentals\.json" --previous "\$PREV" --max-age-days 7/)
  })
  it('the expiry: --backstop is backstopDaysFor(seller), --backstop-days N is checked against the seller\'s window, a set by freshSetProblem', () => {
    expect(expireCode).toMatch(/const BACKSTOP_DAYS = BACKSTOP_DEFAULT \? backstopDaysFor\(SELLER\) : BACKSTOP_DAYS_ARG/)
    expect(expireCode).toMatch(/const backstopProblem = backstop \? backstopDaysProblem\(SELLER, BACKSTOP_DAYS\) : null\s+if \(backstopProblem\) throw new Error\(backstopProblem\)/)
    expect(expireCode).toMatch(/const problem = freshSetProblem\(raw, now, SELLER\)\s+if \(problem\) throw new Error/)
    expect(expireCode).toMatch(/planBackstop\(\{ active, lastFreshAt: lastFresh\?\.at \?\? null, now, days: BACKSTOP_DAYS! \}\)/)
    expect(expireCode).not.toMatch(/BACKSTOP_MISSED_DAYS\s*=|86_400_000/)
  })
  it('⛔ the expiry hands planExpiry the seller\'s rolling window start (carry-over for Honeycomb), read from the table', () => {
    expect(expireCode).toMatch(/const rollingFrom = rollingWindowFrom\(SELLER, set\.fetchedAt\)/)
    expect(expireCode).toMatch(/const plan = planExpiry\(\{[^}]*\brollingFrom,\s*\}\)/)
    // The rows handed in carry postedAt — the date the carry-over guard reads.
    expect(expireCode).toMatch(/select: \{ id: true, externalId: true, postedAt: true \}/)
  })
})
