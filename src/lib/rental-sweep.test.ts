import { describe, expect, it } from 'vitest'
import { FRESH_DAYS, SHARE_FLOOR } from './apartment-freshness'
import { RENTAL_IMPORT_SELLERS } from './import-sellers'
import {
  SOURCE_SELLERS, SWEEP_DAYS, SWEEP_MAX_SHARE, SWEEP_MIN_LIVE, SWEEP_REFUSED_EXIT, SWEEP_STALE_IMPORT_DAYS, lastImportByUnit, parseStamp, planSweep,
  sweepRefusal, unitOf,
} from './rental-sweep'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-14T06:30:00Z')
const NHATOT = 'nhatot-import-seller-0001'
const BDS = 'bds-vn-import-seller-0001'
const MUABAN = 'muaban-net-import-seller-0001'

describe('the daily sweep — constants are the 7-day rule\'s own', () => {
  it('sweeps at FRESH_DAYS, guards from the fresh-set floor, a 4-day stale import, exit 3', () => {
    expect(SWEEP_DAYS).toBe(FRESH_DAYS)
    expect(SWEEP_DAYS).toBe(7)
    expect(SWEEP_MIN_LIVE).toBe(SHARE_FLOOR)
    expect(SWEEP_MAX_SHARE).toBe(0.95)
    expect(SWEEP_STALE_IMPORT_DAYS).toBe(4)
    expect(SWEEP_REFUSED_EXIT).toBe(3)
  })
  it('every gate unit of the job names a rental import seller, and every seller has a unit', () => {
    for (const [unit, seller] of Object.entries(SOURCE_SELLERS)) expect((RENTAL_IMPORT_SELLERS as readonly string[]).includes(seller), unit).toBe(true)
    expect(new Set(Object.values(SOURCE_SELLERS))).toEqual(new Set(RENTAL_IMPORT_SELLERS))
    expect(Object.keys(SOURCE_SELLERS).sort()).toEqual(['batdongsan', 'honeycomb', 'muaban', 'muaban-places', 'nhatot', 'rever'])
    expect(Object.isFrozen(SOURCE_SELLERS)).toBe(true)
  })
})

describe('⛔ sweepRefusal — the unattended sweep\'s one refusal (for one seller\'s rows)', () => {
  const at = (days: number) => NOW - days * DAY
  const base = { live: 1000, expire: 960, lastImportAt: at(5), now: NOW, allowMass: false }

  it('refuses over 95% of the live rows at once while the last successful import is over 4 days old', () => {
    expect(sweepRefusal(base)).toMatch(/^this would expire 960 of its 1000 live rows \(96\.0%, over 95%\) at once while the last successful import was 5\.0 days ago \(2026-10-09T06:30:00\.000Z\) — over 4 days/)
    expect(sweepRefusal({ ...base, expire: 1000 })).toMatch(/1000 of its 1000 live rows \(100\.0%/)
    expect(sweepRefusal({ ...base, lastImportAt: at(4) - 1 })).toMatch(/broken refresh or broken postedAt/)
  })
  it('⛔ no known import counts as stale: the guard still stands', () => {
    expect(sweepRefusal({ ...base, lastImportAt: null })).toMatch(/while no successful import is known/)
  })
  it('applies a mass expiry while the imports are fresh — every row the source still shows was re-dated by them', () => {
    expect(sweepRefusal({ ...base, lastImportAt: at(0.1) })).toBeNull()
    expect(sweepRefusal({ ...base, lastImportAt: at(SWEEP_STALE_IMPORT_DAYS) })).toBeNull()   // exactly 4 days: not over
    expect(sweepRefusal({ ...base, expire: 1000, lastImportAt: at(3) })).toBeNull()
  })
  it('applies an ordinary day — up to 95% — however stale the imports', () => {
    expect(sweepRefusal({ ...base, expire: 950, lastImportAt: null })).toBeNull()             // exactly 95%: not over
    expect(sweepRefusal({ ...base, expire: 143, lastImportAt: at(30) })).toBeNull()           // a seventh: the normal day
    expect(sweepRefusal({ ...base, expire: 0, lastImportAt: null })).toBeNull()
    expect(sweepRefusal({ ...base, live: 0, expire: 0, lastImportAt: null })).toBeNull()
  })
  it(`a seller under SWEEP_MIN_LIVE (${SWEEP_MIN_LIVE}) live rows is too small for a share — applied`, () => {
    expect(sweepRefusal({ ...base, live: SWEEP_MIN_LIVE - 1, expire: SWEEP_MIN_LIVE - 1, lastImportAt: null })).toBeNull()
    expect(sweepRefusal({ ...base, live: SWEEP_MIN_LIVE, expire: SWEEP_MIN_LIVE, lastImportAt: null })).toMatch(/20 of its 20 live rows/)
  })
  it('--allow-mass-expiry overrides it', () => {
    expect(sweepRefusal({ ...base, allowMass: true })).toBeNull()
    expect(sweepRefusal({ ...base, expire: 1000, lastImportAt: null, allowMass: true })).toBeNull()
  })
  it('refuses nonsense counts loudly — never a silent pass', () => {
    expect(() => sweepRefusal({ ...base, expire: 1001 })).toThrow(/not a count of live rows/)
    expect(() => sweepRefusal({ ...base, live: -1, expire: 0 })).toThrow(/not a count/)
    expect(() => sweepRefusal({ ...base, expire: 1.5 })).toThrow(/not a count/)
    expect(() => sweepRefusal({ ...base, live: NaN })).toThrow(/not a count/)
  })
})

describe('the job\'s success stamps, as the sweep reads them — per seller, never trusted from the future', () => {
  const sec = (t: number) => String(Math.floor(t / 1000))
  it('parseStamp reads "<epoch s> <ISO>" (the gate library\'s format) and a bare epoch', () => {
    expect(parseStamp(`${sec(NOW - DAY)} 2026-10-13T06:30:00Z\n`, NOW)).toBe(Math.floor((NOW - DAY) / 1000) * 1000)
    expect(parseStamp(sec(NOW - DAY), NOW)).toBe(Math.floor((NOW - DAY) / 1000) * 1000)
  })
  it('⛔ a future stamp (the clock moved back), junk, or an empty file is no time at all — never an error', () => {
    expect(parseStamp(sec(NOW + DAY), NOW)).toBeNull()
    expect(parseStamp(sec(NOW + 60_000), NOW)).not.toBeNull()                                  // within the 5-minute skew
    for (const bad of ['', 'garbage', '12345', '9999999999999', `-${sec(NOW)}`, '1.5e9']) expect(parseStamp(bad, NOW), JSON.stringify(bad)).toBeNull()
  })
  it('lastImportByUnit: each unit\'s own stamp — muaban\'s two units apart — ignoring unknown units and bad stamps', () => {
    const m = lastImportByUnit([
      { unit: 'nhatot', text: sec(NOW - 2 * DAY) },
      { unit: 'muaban', text: sec(NOW - 6 * DAY) },
      { unit: 'muaban-places', text: sec(NOW - DAY) },
      { unit: 'batdongsan', text: sec(NOW + 9 * DAY) },                                            // future: ignored
      { unit: 'vehicles', text: sec(NOW) },                                                         // not a property unit
    ], NOW)
    expect([...m.keys()].sort()).toEqual(['muaban', 'muaban-places', 'nhatot'])
    expect(m.get('muaban')).toBe(Math.floor((NOW - 6 * DAY) / 1000) * 1000)
    expect(m.get('muaban-places')).toBe(Math.floor((NOW - DAY) / 1000) * 1000)
    expect(m.has('batdongsan')).toBe(false)
  })
  it('unitOf: a seller\'s unit; Muaban\'s apartments ← muaban, its other place rows ← muaban-places', () => {
    expect(unitOf(NHATOT, 'house-rental')).toBe('nhatot')
    expect(unitOf(BDS, null)).toBe('batdongsan')
    expect(unitOf(MUABAN, 'apartment-rental')).toBe('muaban')
    for (const sub of ['house-rental', 'room-rental', 'office-rental', null]) expect(unitOf(MUABAN, sub), String(sub)).toBe('muaban-places')
    expect(unitOf('cmub0wead0000zrq418bqq27m', 'apartment-rental')).toBe('rever')
    expect(unitOf('some-other-seller', null)).toBeNull()
  })
})

describe('⛔ planSweep — one read, planned per gate unit: a stale unit is held back, the others still expire', () => {
  /** `n` live rows of a seller in `subcat`, the first `old` of them past the window. */
  const rows = (sellerId: string, n: number, old: number, subcat: string | null = 'apartment-rental') =>
    Array.from({ length: n }, (_, i) => ({ id: `${sellerId}-${subcat}-${i}`, sellerId, subcat, old: i < old }))
  it('expires every old row while each unit\'s refresh is fresh, with per-unit counts', () => {
    const p = planSweep({ rows: [...rows(NHATOT, 100, 14), ...rows(BDS, 50, 50)], lastImport: new Map([['nhatot', NOW - DAY], ['batdongsan', NOW - DAY]]), now: NOW, allowMass: false })
    expect(p.expire).toHaveLength(64)
    expect(p.groups).toEqual([
      { unit: 'batdongsan', sellerId: BDS, live: 50, expire: 50, lastImportAt: NOW - DAY, refusal: null },
      { unit: 'nhatot', sellerId: NHATOT, live: 100, expire: 14, lastImportAt: NOW - DAY, refusal: null },
    ])
  })
  it('⛔ one healthy refresh never vouches for another: Batdongsan dead for a week keeps its rows; Nhà Tốt\'s old ones still go', () => {
    const p = planSweep({ rows: [...rows(NHATOT, 100, 14), ...rows(BDS, 50, 50)], lastImport: new Map([['nhatot', NOW - DAY], ['batdongsan', NOW - 7 * DAY]]), now: NOW, allowMass: false })
    expect(p.expire).toEqual(rows(NHATOT, 100, 14).filter((r) => r.old).map((r) => r.id))
    expect(p.groups.find((x) => x.unit === 'batdongsan')!.refusal).toMatch(/50 of its 50 live rows .* 7\.0 days ago/)
    // a unit never refreshed (no stamp) is stale too; --allow-mass-expiry releases it
    expect(planSweep({ rows: rows(BDS, 50, 49), lastImport: new Map(), now: NOW, allowMass: false }).expire).toEqual([])
    expect(planSweep({ rows: rows(BDS, 50, 49), lastImport: new Map(), now: NOW, allowMass: true }).expire).toHaveLength(49)
  })
  it('⛔ Muaban\'s houses refreshing do not vouch for its apartments (and the reverse): the two are guarded apart', () => {
    const muaban = [...rows(MUABAN, 40, 40, 'apartment-rental'), ...rows(MUABAN, 30, 3, 'room-rental')]
    const p = planSweep({ rows: muaban, lastImport: new Map([['muaban-places', NOW - DAY], ['muaban', NOW - 8 * DAY]]), now: NOW, allowMass: false })
    expect(p.groups.map((g) => [g.unit, g.live, g.expire, g.refusal !== null])).toEqual([['muaban', 40, 40, true], ['muaban-places', 30, 3, false]])
    expect(p.expire).toHaveLength(3)                                                                 // the rooms' old ones only
  })
  it('an ordinary day for a stale unit (a seventh of its rows) is still swept — only a near-total one is held back', () => {
    expect(planSweep({ rows: rows(BDS, 70, 10), lastImport: new Map(), now: NOW, allowMass: false }).expire).toHaveLength(10)
  })
  it('nothing live: nothing planned', () => {
    expect(planSweep({ rows: [], lastImport: new Map(), now: NOW, allowMass: false })).toEqual({ groups: [], expire: [] })
  })
})
