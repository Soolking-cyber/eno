import { describe, expect, it } from 'vitest'
import { BASELINE_RUNS, FRESH_DAYS, MIN_SHARE, SHARE_FLOOR, baselineOf, freshSetProblem, isInWindow, makeFreshSet, planExpiry } from './apartment-freshness'

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
