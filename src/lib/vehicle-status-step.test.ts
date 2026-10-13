import { describe, expect, it } from 'vitest'
import { runStatusStep, type StatusStepDeps, type StatusStepInput } from './vehicle-status-step'
import { PRESENCE_KIND, type DbRow, type PresenceEntry } from './vehicle-status-plan'
import type { Verdict } from './vehicle-reliability'

const DAY = 86_400_000
const AT = Date.parse('2026-10-16T01:00:00Z')
const keep: Verdict = { kind: 'keep', detail: 'ok' }
const fewTrips: Verdict = { kind: 'drop', reason: 'fewTrips', detail: '3 trips < 10' }
const noDetail: Verdict = { kind: 'unknown', reason: 'noDetail', detail: 'detail page not read this run' }
let n = 0
const row = (externalId: string, status: string, seller: DbRow['seller'] = 'mioto'): DbRow & { updatedAt: string } => ({
  id: `cmstep${String(++n).padStart(20, '0')}`, externalId, status, seller,
  subcat: seller === 'mioto' || seller === 'bonboncar' ? 'car-rental' : 'motorbike-rental', updatedAt: '2026-10-15 01:00:00.000',
})
const entry = (recordedAt: string, sources: PresenceEntry['sources']): PresenceEntry => ({ kind: PRESENCE_KIND, version: 1, recordedAt, sources })

/** Fake I/O that records the ORDER of every call. */
function fakes(rows: (DbRow & { updatedAt: string })[], moved?: (ids: string[]) => string[]) {
  const calls: string[] = [], written: PresenceEntry[] = [], applied: string[][] = [], log: string[] = []
  const deps: StatusStepDeps = {
    readRows: async () => { calls.push('read'); return rows },
    applyMoves: async (moves) => { calls.push('apply'); applied.push(moves.map((m) => m.id)); return { moved: moved ? moved(moves.map((m) => m.id)) : moves.map((m) => m.id) } },
    writeEntry: (e) => { calls.push('record'); written.push(e); return '/x/entry.json' },
    log: (l) => log.push(l),
  }
  return { deps, calls, written, applied, log }
}
const input = (over: Partial<StatusStepInput>): StatusStepInput => ({
  apply: true, cars: {}, bikes: null, tripsHealthy: true, entries: [], fallback: {}, accept: new Set(), ready: new Set(), now: AT + 3_600_000, recordedAt: '2026-10-16T05:00:00.000Z', ...over,
})

describe('runStatusStep — what it writes, and in which order', () => {
  const rows = [row('mioto:KEEP01', 'active'), row('mioto:DROP01', 'active'), row('mioto:BACK01', 'expired')]
  const verdicts = new Map<string, Verdict>([['mioto:KEEP01', keep], ['mioto:DROP01', fewTrips], ['mioto:BACK01', keep]])
  const history = [entry('2026-10-13T05:00:00Z', { mioto: { scrapedAt: '2026-10-13T01:00:00Z', count: 3, accepted: true, present: ['mioto:KEEP01', 'mioto:DROP01', 'mioto:BACK01'] } })]

  it('⛔ a dry run plans and writes NOTHING — no move, no run record', async () => {
    const f = fakes(rows)
    const out = await runStatusStep(f.deps, input({ apply: false, cars: { mioto: { verdicts, scrapedAt: AT } }, entries: history, ready: new Set(['mioto:BACK01']) }))
    expect(f.calls).toEqual(['read'])
    expect(out).toEqual({ refusals: [], warnings: [] })
    expect(f.log.some((l) => /→ expire 1/.test(l))).toBe(true)
    expect(f.log.some((l) => /→ revive 1/.test(l))).toBe(true)
  })

  it('⛔ applies the moves FIRST and records the run only after them', async () => {
    const f = fakes(rows)
    await runStatusStep(f.deps, input({ cars: { mioto: { verdicts, scrapedAt: AT } }, entries: history, ready: new Set(['mioto:BACK01']) }))
    expect(f.calls).toEqual(['read', 'apply', 'record'])
    expect(f.applied[0]).toEqual([rows[1].id, rows[2].id]) // the expiry, then the revival
    expect(f.written[0]).toMatchObject({ recordedAt: '2026-10-16T05:00:00.000Z', sources: { mioto: { accepted: true, count: 3, scrapedAt: new Date(AT).toISOString() } } })
  })

  it('a step that dies in its writes records NO run (the scrape never counts as a check)', async () => {
    const f = fakes(rows)
    f.deps.applyMoves = async () => { f.calls.push('apply'); throw new Error('connection lost') }
    await expect(runStatusStep(f.deps, input({ cars: { mioto: { verdicts, scrapedAt: AT } }, entries: history }))).rejects.toThrow('connection lost')
    expect(f.calls).toEqual(['read', 'apply'])
  })

  it('a row changed between the read and the write is left alone, with a warning — and the run is still recorded', async () => {
    const f = fakes(rows, (ids) => ids.slice(1))
    const out = await runStatusStep(f.deps, input({ cars: { mioto: { verdicts, scrapedAt: AT } }, entries: history, ready: new Set(['mioto:BACK01']) }))
    expect(out.warnings).toEqual(['1 row(s) changed between the read and the write — left as they are; the next run re-plans them'])
    expect(f.calls).toEqual(['read', 'apply', 'record'])
  })

  it('records an --accept run as forced, and the override reaches the shrink guard', async () => {
    const live = Array.from({ length: 6 }, (_, i) => row(`mioto:L${i}`, 'active'))
    const v = new Map<string, Verdict>(live.map((r) => [r.externalId!, fewTrips]))
    const refused = await runStatusStep(fakes(live).deps, input({ cars: { mioto: { verdicts: v, scrapedAt: AT } }, fallback: { mioto: 6 } }))
    expect(refused.refusals.join()).toMatch(/would expire 6 of 6/)
    const f = fakes(live)
    const out = await runStatusStep(f.deps, input({ cars: { mioto: { verdicts: v, scrapedAt: AT } }, fallback: { mioto: 6 }, accept: new Set(['mioto']) }))
    expect(out.refusals).toEqual([])
    expect(f.applied[0]).toHaveLength(6)
    expect(f.written[0].sources.mioto).toMatchObject({ accepted: true, forced: true })
  })

  it('⛔ records a source refused by a guard — or held upstream — as NO check (never a reference later)', async () => {
    const live = Array.from({ length: 6 }, (_, i) => row(`mioto:L${i}`, 'active'))
    const v = new Map<string, Verdict>(live.map((r) => [r.externalId!, fewTrips]))
    const f = fakes(live)
    const out = await runStatusStep(f.deps, input({ cars: { mioto: { verdicts: v, scrapedAt: AT } }, fallback: { mioto: 6 } }))
    expect(out.refusals.join()).toMatch(/would expire 6 of 6/)
    expect(f.written[0].sources.mioto).toMatchObject({ accepted: false, forced: false })
    // the importer held this source's creations: nothing moves, recorded as no check, no second message
    const g = fakes(rows)
    const held = await runStatusStep(g.deps, input({ cars: { mioto: { verdicts, scrapedAt: AT } }, entries: history, ready: new Set(['mioto:BACK01']), held: new Set(['mioto']) }))
    expect(held.refusals).toEqual([])
    expect(g.applied[0]).toEqual([])
    expect(g.written[0].sources.mioto).toMatchObject({ accepted: false })
  })

  it('refuses a short scrape ONLY where it leaves live rows unjudged — and records it as not accepted', async () => {
    const shop = [row('janmotorbike:a', 'active', 'janmotorbike')]
    const bikes = { janmotorbike: { count: 10, present: new Set<string>(), scrapedAt: AT }, tuanmotorbike: { count: 1, present: new Set<string>(), scrapedAt: AT } }
    const fallback = { janmotorbike: 100, tuanmotorbike: 14 }
    const f = fakes(shop)
    const out = await runStatusStep(f.deps, input({ bikes, fallback }))
    expect(out.refusals).toEqual(['janmotorbike: scrape not accepted (see its guard line)']) // tuan has no live row
    expect(f.written[0].sources).toMatchObject({ janmotorbike: { accepted: false }, tuanmotorbike: { accepted: false } })
  })

  it('combines this run with the recorded runs: a bike seen only in an earlier SHORT run is not three checks missing', async () => {
    const shop = [row('janmotorbike:a', 'active', 'janmotorbike'), row('janmotorbike:b', 'active', 'janmotorbike')]
    const src = (d: number, present: string[], accepted = true) => ({ scrapedAt: new Date(AT - d * DAY).toISOString(), count: 100, accepted, present })
    const entries = [
      entry('2026-10-01T05:00:00Z', { janmotorbike: src(12, ['janmotorbike:a', 'janmotorbike:b']) }),
      entry('2026-10-04T05:00:00Z', { janmotorbike: src(9, []) }),
      entry('2026-10-07T05:00:00Z', { janmotorbike: src(6, ['janmotorbike:a'], false) }), // a short scrape that listed a
      entry('2026-10-10T05:00:00Z', { janmotorbike: src(3, []) }),
    ]
    const f = fakes(shop)
    await runStatusStep(f.deps, input({ bikes: { janmotorbike: { count: 100, present: new Set(), scrapedAt: AT } }, entries }))
    expect(f.applied[0]).toEqual([shop[1].id]) // b: missing 3 accepted checks over 9 days; a: seen 6 days ago
  })

  it('warns — without refusing — on a trips history that cannot judge, a source mostly not judged, and the importer\'s own warnings', async () => {
    const v = new Map<string, Verdict>([['mioto:KEEP01', noDetail], ['mioto:DROP01', noDetail], ['mioto:BACK01', keep]])
    const out = await runStatusStep(fakes(rows).deps, input({ cars: { mioto: { verdicts: v, scrapedAt: AT } }, tripsHealthy: false, warnings: ['mioto: trips snapshot refused'] }))
    expect(out.refusals).toEqual([])
    expect(out.warnings).toEqual([
      'mioto: trips snapshot refused',
      expect.stringMatching(/^mioto: the trips history cannot judge most cars/),
      'mioto: 2 of 3 HCMC cars could not be judged this run — neither updated, expired nor revived',
    ])
  })

  it('a source this run did not load is not guarded, planned or recorded', async () => {
    const f = fakes([...rows, row('bonboncar:B1', 'active', 'bonboncar')])
    await runStatusStep(f.deps, input({ cars: { mioto: { verdicts, scrapedAt: AT } }, entries: history }))
    expect(Object.keys(f.written[0].sources)).toEqual(['mioto'])
    expect(f.log.some((l) => l.includes('bonboncar'))).toBe(false)
  })
})
