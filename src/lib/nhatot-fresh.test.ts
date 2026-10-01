import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { APARTMENT_SUBCAT, FRESH_DAYS, freshSetProblem } from './apartment-freshness'
import { NHATOT_CATEGORIES, stageNhatotAd, type NhatotStagedAd } from './nhatot-listing'
import {
  NHATOT_APARTMENT_CG, NHATOT_WINDOW_MARGIN_MS, nhatotAnchors, nhatotBuildFreshSet, nhatotEndProblem, nhatotExistingRowPlan, nhatotFreshCoverage,
  nhatotFreshDecision, nhatotFreshOutProblem, nhatotIsBoundaryPage, nhatotLastTime, nhatotNewest, nhatotOrderProblem, nhatotRepostRollbackSql, nhatotRevivalRollbackSql,
  nhatotSamePage, nhatotSqlLit, nhatotTombstoneSql, nhatotWindowCutoff, nhatotWindowRow,
  nhatotWindowStep, readNhatotWindowSlice, type NhatotWindowRow, type NhatotWindowSlice,
} from './nhatot-fresh'

const NOW = Date.parse('2026-10-01T05:00:00Z')
const HOUR = 3_600_000
const DAY = 86_400_000

describe('the apartment category', () => {
  it('cg 1010 is the 7-day rule’s subcategory', () => {
    expect(NHATOT_APARTMENT_CG).toBe(1010)
    expect(NHATOT_CATEGORIES[NHATOT_APARTMENT_CG].subcat).toBe(APARTMENT_SUBCAT)
  })
})

describe('nhatotWindowRow', () => {
  it('reads list_id, list_time and the two sticky flags; everything published still goes through the whitelist', () => {
    const r = nhatotWindowRow({ list_id: 134931296, list_time: 1790869458604, is_sticky: false, sticky_ad_platinum: 0, category: 1010, account_name: 'Nguyễn A', phone: '0901234567', body: 'gọi 0901234567' })
    expect(r).toMatchObject({ list_id: 134931296, list_time: 1790869458604, pinned: false })
    expect(JSON.stringify(r.ad)).not.toMatch(/Nguyễn A|0901234567/)
    expect(nhatotWindowRow({ list_id: 1, list_time: 1, is_sticky: true }).pinned).toBe(true)
    expect(nhatotWindowRow({ list_id: 1, list_time: 1, sticky_ad_platinum: 2 }).pinned).toBe(true)
  })
  it('an unusable id or time is null, never a guess; a row with no category is not staged', () => {
    expect(nhatotWindowRow({ list_id: '134', list_time: 'x' })).toMatchObject({ list_id: null, list_time: null, ad: null })
    expect(nhatotWindowRow({ list_id: 1e13, list_time: -5 })).toMatchObject({ list_id: null, list_time: null })
    expect(nhatotWindowRow({ list_id: 134000001, list_time: NOW })).toMatchObject({ list_id: 134000001, ad: null })
    expect(nhatotWindowRow(null)).toMatchObject({ list_id: null, list_time: null, pinned: false, ad: null })
  })
})

const pos = (list_id: number | null, list_time: number | null, pinned = false) => ({ list_id, list_time, pinned })

describe('nhatotIsBoundaryPage / nhatotNewest / nhatotAnchors', () => {
  const cutoff = NOW - 7 * DAY
  it('every non-pinned ad before the cutoff, and at least one of them', () => {
    expect(nhatotIsBoundaryPage([pos(1, cutoff - 1), pos(2, cutoff - 5)], cutoff)).toBe(true)
    expect(nhatotIsBoundaryPage([pos(1, cutoff - 1), pos(2, cutoff)], cutoff)).toBe(false)
  })
  it('a pinned ad can neither end a slice early nor keep it going', () => {
    // an OLD pinned ad among fresh ones does not end the slice…
    expect(nhatotIsBoundaryPage([pos(9, cutoff - 30 * DAY, true), pos(1, NOW)], cutoff)).toBe(false)
    // …and a FRESH pinned ad on a page of old ones does not prevent the boundary.
    expect(nhatotIsBoundaryPage([pos(9, NOW, true), pos(1, cutoff - 1)], cutoff)).toBe(true)
    // a page of nothing but pins proves nothing
    expect(nhatotIsBoundaryPage([pos(9, cutoff - 1, true)], cutoff)).toBe(false)
    expect(nhatotIsBoundaryPage([], cutoff)).toBe(false)
  })
  it('an ad whose date cannot be read blocks the boundary', () => {
    expect(nhatotIsBoundaryPage([pos(1, cutoff - 1), pos(2, null)], cutoff)).toBe(false)
  })
  it('newest and anchors ignore pins and undated rows', () => {
    expect(nhatotNewest([pos(9, NOW + DAY, true), pos(1, NOW - 5), pos(2, null), pos(3, NOW - 1)])).toBe(NOW - 1)
    expect(nhatotNewest([pos(9, NOW, true)])).toBeNull()
    expect(nhatotAnchors([pos(9, NOW, true), pos(1, 10), pos(null, 11), pos(2, null)])).toEqual(['1@10'])
  })
  it('the last non-pinned, dated row of a page (in page order) is what the next page is held to', () => {
    expect(nhatotLastTime([pos(1, 10), pos(2, 9), pos(3, 100, true), pos(4, null)])).toBe(9)
    expect(nhatotLastTime([pos(3, 100, true)])).toBeNull()
    expect(nhatotLastTime([])).toBeNull()
  })
})

describe('nhatotOrderProblem — newest-first is checked on every page, never assumed', () => {
  const o = (rows: ReturnType<typeof pos>[], prevLast: number | null = null, seen: ReadonlySet<string> | null = null) => nhatotOrderProblem({ offset: 70, rows, prevLast, seen })
  it('within a page, non-pinned list_time never increases (equal is fine)', () => {
    expect(o([pos(1, 10), pos(2, 9), pos(3, 9), pos(4, 8)])).toBeNull()
    expect(o([pos(1, 10), pos(2, 8), pos(3, 9)])).toMatch(/the page at o=70 is not newest-first: ad 3 .* sits below ad 2/)
  })
  it('a pinned row and an undated row are skipped, not compared', () => {
    expect(o([pos(1, 10), pos(9, 99, true), pos(2, 9)])).toBeNull()
    expect(o([pos(1, 10), pos(2, null), pos(3, 9)])).toBeNull()
    expect(o([pos(9, 1, true), pos(1, 10)])).toBeNull()
  })
  it('against the previous page: an ad NOT read before may be no newer than its last non-pinned ad', () => {
    const seen = new Set(['1@10', '2@9'])
    // the overlap's repeats are newer than prevLast and exempt; the new ads are older
    expect(o([pos(1, 10), pos(2, 9), pos(3, 7), pos(4, 6)], 8, seen)).toBeNull()
    expect(o([pos(3, 8)], 8, seen)).toBeNull()
    // an ad that was not on the pages before, newer than where the previous page ended
    expect(o([pos(1, 10), pos(5, 9), pos(2, 9), pos(3, 7)], 8, seen)).toMatch(/ad 5 .* was not read before and is newer than the previous page's last ad/)
    // a repeat of an id under a NEW list_time is not a repeat
    expect(o([pos(1, 11), pos(3, 7)], 8, seen)).toMatch(/ad 1 .* was not read before/)
    // an id-less row cannot be shown to be a repeat
    expect(o([pos(null, 9)], 8, seen)).toMatch(/was not read before/)
    // on a first page there is no previous page
    expect(o([pos(5, 99)], null, null)).toBeNull()
  })
})

describe('nhatotWindowStep', () => {
  const cutoff = NOW - 7 * DAY
  const base = { offset: 0, limit: 3, seen: null, cutoff, overlap: 1, cap: 100 }
  const fresh = [pos(1, NOW), pos(2, NOW - 1), pos(3, NOW - 2)]
  it('overlapping next page', () => {
    expect(nhatotWindowStep({ ...base, rows: fresh })).toEqual({ kind: 'next', offset: 2 })
  })
  it('a page that shares no ad (same id AND same list_time) with the pages read before is a GAP — even if it looks like the boundary', () => {
    const seen = new Set([`3@${NOW - 2}`])
    const old = [pos(4, cutoff - 1), pos(5, cutoff - 2), pos(6, cutoff - 3)]
    expect(nhatotWindowStep({ ...base, offset: 2, seen, rows: old }).kind).toBe('gap')
    // the shared id was re-listed in between (new list_time) — not an anchor
    expect(nhatotWindowStep({ ...base, offset: 2, seen, rows: [pos(3, NOW + 5), pos(4, NOW - 3), pos(5, NOW - 4)] }).kind).toBe('gap')
    // an empty page after a full one: rows vanished under the read
    expect(nhatotWindowStep({ ...base, offset: 2, seen, rows: [] }).kind).toBe('gap')
    // anchored → judged normally
    expect(nhatotWindowStep({ ...base, offset: 2, seen, rows: [pos(3, NOW - 2), pos(4, cutoff - 1), pos(5, cutoff - 2)] }).kind).toBe('next')
  })
  it('a pinned row is not an anchor', () => {
    const seen = new Set([`3@${NOW - 2}`])
    expect(nhatotWindowStep({ ...base, offset: 2, seen, rows: [pos(3, NOW - 2, true), pos(4, NOW - 3), pos(5, NOW - 4)] }).kind).toBe('gap')
  })
  it('a page out of newest-first order is UNORDERED — even if it looks like the boundary or the end', () => {
    expect(nhatotWindowStep({ ...base, rows: [pos(1, cutoff - 3), pos(2, cutoff - 1), pos(3, cutoff - 2)] })).toMatchObject({ kind: 'unordered', why: expect.stringMatching(/not newest-first/) })
    expect(nhatotWindowStep({ ...base, rows: [pos(1, NOW - 2), pos(2, NOW)] }).kind).toBe('unordered')
    const seen = new Set([`3@${NOW - 2}`])
    // anchored, in order within, but a NEW ad newer than the previous page's last one
    expect(nhatotWindowStep({ ...base, offset: 2, seen, prevLast: NOW - 2, rows: [pos(4, NOW - 1), pos(3, NOW - 2), pos(5, NOW - 4)] })).toMatchObject({ kind: 'unordered', why: expect.stringMatching(/ad 4 .* was not read before/) })
    expect(nhatotWindowStep({ ...base, offset: 2, seen, prevLast: NOW - 2, rows: [pos(3, NOW - 2), pos(4, NOW - 3), pos(5, NOW - 4)] }).kind).toBe('next')
    // a gap is still a gap first
    expect(nhatotWindowStep({ ...base, offset: 2, seen, prevLast: NOW - 2, rows: [pos(7, NOW - 9), pos(8, NOW)] }).kind).toBe('gap')
  })
  it('boundary, then the cap, then a CLAIMED end (empty first page, short page — never `total`)', () => {
    expect(nhatotWindowStep({ ...base, rows: [pos(1, cutoff - 1), pos(2, cutoff - 2), pos(3, cutoff - 3)] }).kind).toBe('boundary')
    expect(nhatotWindowStep({ ...base, rows: [] }).kind).toBe('end')
    expect(nhatotWindowStep({ ...base, rows: fresh.slice(0, 2) }).kind).toBe('end')
    expect(nhatotWindowStep({ ...base, offset: 97, rows: fresh }).kind).toBe('capped')
    expect(nhatotWindowStep({ ...base, offset: 50, rows: fresh }).kind).toBe('next')
  })
  it('a SHORT page that reaches the cap is the cap (the gateway serves nothing past it), not the end of the list', () => {
    expect(nhatotWindowStep({ ...base, offset: 98, rows: fresh.slice(0, 2) }).kind).toBe('capped')
    expect(nhatotWindowStep({ ...base, offset: 96, rows: fresh.slice(0, 2) }).kind).toBe('end')
  })
})

describe('nhatotSamePage / nhatotEndProblem — an end of results must be corroborated', () => {
  it('the same rows, in the same order, with the same list_time and pin', () => {
    expect(nhatotSamePage([pos(1, 10), pos(2, 9)], [pos(1, 10), pos(2, 9)])).toBe(true)
    expect(nhatotSamePage([], [])).toBe(true)
    expect(nhatotSamePage([pos(1, 10)], [pos(1, 10), pos(2, 9)])).toBe(false)
    expect(nhatotSamePage([pos(1, 10), pos(2, 9)], [pos(2, 9), pos(1, 10)])).toBe(false)
    expect(nhatotSamePage([pos(1, 10)], [pos(1, 11)])).toBe(false)
    expect(nhatotSamePage([pos(1, 10)], [pos(1, 10, true)])).toBe(false)
  })
  it('no total and no rows → an empty list, nothing to contradict; under the cap the list must have shown at least its own total', () => {
    expect(nhatotEndProblem({ total: null, rowsRead: 0, distinct: 0, endAt: 0 })).toBeNull()
    expect(nhatotEndProblem({ total: 17, rowsRead: 34, distinct: 17, endAt: 17 })).toBeNull()
    expect(nhatotEndProblem({ total: 17, rowsRead: 80, distinct: 40, endAt: 40 })).toBeNull()   // a lagging total never refuses a longer list
    expect(nhatotEndProblem({ total: 300, rowsRead: 42, distinct: 21, endAt: 21 })).toEqual({ outcome: 'endContradicted', why: expect.stringMatching(/21 distinct ads read, short of the gateway's own total 300/) })
    expect(nhatotEndProblem({ total: 0, rowsRead: 0, distinct: 0, endAt: 0 })).toBeNull()
  })
  it('rows read but NO numeric total ever seen → endUnconfirmed: an end with no count to hold it to', () => {
    expect(nhatotEndProblem({ total: null, rowsRead: 12, distinct: 6, endAt: 6 })).toEqual({ outcome: 'endUnconfirmed', why: expect.stringMatching(/after 12 rows read, and no answer carried a numeric `total`/) })
    expect(nhatotEndProblem({ total: null, rowsRead: 1, distinct: 0, endAt: 0 })).toMatchObject({ outcome: 'endUnconfirmed' })
  })
  it('a total AT the cap ("10,000 or more") contradicts any end below it', () => {
    expect(nhatotEndProblem({ total: 10_000, rowsRead: 9_000, distinct: 4_521, endAt: 4_521 })).toEqual({ outcome: 'endContradicted', why: expect.stringMatching(/counts 10000 \(its cap/) })
    expect(nhatotEndProblem({ total: 100, rowsRead: 100, distinct: 100, endAt: 60, cap: 100 })).toMatchObject({ outcome: 'endContradicted', why: expect.stringMatching(/its cap/) })
  })
})

// ─── a simulated gateway list: newest first by list_time, mutable between requests ───────────────
type Ad = { id: number; t: number; pinned?: boolean }
function gateway(initial: Ad[], opts: {
  before?: (call: number, list: Ad[]) => void; total?: (list: Ad[]) => number | null; failOn?: number
  /** A backend hiccup: this call answers only the first N rows of what it should. */
  truncate?: (call: number, o: number) => number | null
} = {}) {
  const list = [...initial]
  let calls = 0
  const fetchPage = async (o: number, limit: number): Promise<{ rows: NhatotWindowRow[]; total: number | null }> => {
    calls++
    if (opts.failOn === calls) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    opts.before?.(calls, list)
    const cut = opts.truncate?.(calls, o) ?? null
    const slice = list.slice(o, o + limit)
    return {
      rows: (cut === null ? slice : slice.slice(0, cut)).map((a) => ({ list_id: a.id, list_time: a.t, pinned: !!a.pinned, ad: null })),
      // measured 2026-10-02: an empty page past the end carries no `total`
      total: opts.total && slice.length ? opts.total(list) : null,
    }
  }
  return { fetchPage, list, calls: () => calls }
}
/** 300 ads, one an hour back from NOW: ids 1000 (newest) … 1299. */
const hourly = (n = 300): Ad[] => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, t: NOW - i * HOUR }))
const CUT = NOW - 168 * HOUR
const OPTS = { cutoff: CUT, pageMax: 10, overlap: 3, cap: 1000, headMaxPages: 3 }
const ids = (rows: NhatotWindowRow[]) => new Set(rows.map((r) => r.list_id))
const freshIds = (list: Ad[]) => list.filter((a) => a.t >= CUT).map((a) => a.id)

describe('readNhatotWindowSlice', () => {
  it('reads to the first page that is wholly before the cutoff, and sees every ad at or after it', async () => {
    const g = gateway(hourly())
    const res = await readNhatotWindowSlice(g.fetchPage, OPTS)
    expect(res.outcome).toBe('boundary')
    expect(res.covered).toBe(true)
    const seen = ids(res.rows)
    for (const id of freshIds(hourly())) expect(seen.has(id)).toBe(true)
    // pages advance by pageMax - overlap; the boundary page starts past the cutoff, not at the end of the list
    expect(res.lastOffset % 7).toBe(0)
    expect(res.lastOffset).toBeGreaterThan(160)
    expect(res.lastOffset).toBeLessThan(180)
    expect(res.headPages).toBe(1)
    expect(res.why).toMatch(/boundary at o=\d+: every non-pinned ad on it listed before .*each anchored to the ones before; head re-read 1 page/)
  })

  it('a DELETION above the read point (fewer than the overlap) shifts rows up and loses none', async () => {
    const g = gateway(hourly(), { before: (call, list) => { if (call === 6) list.splice(3, 2) } })   // 2 < overlap 3
    const res = await readNhatotWindowSlice(g.fetchPage, OPTS)
    expect(res.covered).toBe(true)
    const seen = ids(res.rows)
    for (const id of freshIds(g.list)) expect(seen.has(id)).toBe(true)
  })

  it('deletions that outrun the overlap are a GAP — refused, never guessed', async () => {
    const g = gateway(hourly(), { before: (call, list) => { if (call === 6) list.splice(3, 4) } })
    const res = await readNhatotWindowSlice(g.fetchPage, OPTS)
    expect(res.outcome).toBe('gap')
    expect(res.covered).toBe(false)
  })

  it('an ad RE-LISTED during the read (moved from below the read point to the top) is caught by the head re-read', async () => {
    let bumped: Ad | null = null
    const g = gateway(hourly(), {
      before: (call, list) => {
        if (call !== 4) return
        const i = list.findIndex((a) => a.id === 1120)   // fresh, far below the read point at call 4
        bumped = { ...list.splice(i, 1)[0], t: NOW + 10 * 60_000 }
        list.unshift(bumped)
      },
    })
    const res = await readNhatotWindowSlice(g.fetchPage, OPTS)
    expect(res.covered).toBe(true)
    const last = res.rows.filter((r) => r.list_id === 1120).at(-1)
    expect(last?.list_time).toBe(bumped!.t)   // its LATEST observation is the re-listed one
    const seen = ids(res.rows)
    for (const id of freshIds(g.list)) expect(seen.has(id)).toBe(true)
  })

  it('without the head re-read that ad would have been missed (the main pages never saw it)', async () => {
    const g = gateway(hourly(), { before: (call, list) => { if (call === 4) { const i = list.findIndex((a) => a.id === 1120); list.unshift({ ...list.splice(i, 1)[0], t: NOW + 1 }) } } })
    const res = await readNhatotWindowSlice(g.fetchPage, { ...OPTS, headMaxPages: 3 })
    const mainRows = res.rows.slice(0, res.rows.length - 10)   // the head re-read is the last page
    expect(mainRows.some((r) => r.list_id === 1120)).toBe(false)
    expect(res.rows.slice(-10).some((r) => r.list_id === 1120)).toBe(true)
  })

  it('a burst of NEW ads mid-read pushes rows down — repeats, not a gap — and the head re-read picks them up', async () => {
    const g = gateway(hourly(), { before: (call, list) => { if (call === 5) for (let k = 0; k < 25; k++) list.unshift({ id: 5000 + k, t: NOW + (k + 1) * 1000 }) } })
    const res = await readNhatotWindowSlice(g.fetchPage, { ...OPTS, headMaxPages: 5 })
    expect(res.covered).toBe(true)
    expect(res.headPages).toBe(4)
    const seen = ids(res.rows)
    for (const id of freshIds(g.list)) expect(seen.has(id)).toBe(true)
  })

  it('more new ads during the read than the head re-read can reach → not covered', async () => {
    // deep in the read (o=77), so the main pages still anchor; the head needs 3+ pages to get past 40 new ads
    const g = gateway(hourly(), { before: (call, list) => { if (call === 12) for (let k = 0; k < 40; k++) list.unshift({ id: 5000 + k, t: NOW + (k + 1) * 1000 }) } })
    const res = await readNhatotWindowSlice(g.fetchPage, { ...OPTS, headMaxPages: 2 })
    expect(res.outcome).toBe('headUnresolved')
    expect(res.covered).toBe(false)
  })

  it('an OLD pinned ad on top does not end the slice early; a FRESH pinned ad deep down does not keep it going', async () => {
    const list = hourly()
    list.unshift({ id: 999, t: NOW - 40 * DAY, pinned: true })
    list.splice(200, 0, { id: 998, t: NOW, pinned: true })
    const res = await readNhatotWindowSlice(gateway(list).fetchPage, OPTS)
    expect(res.outcome).toBe('boundary')
    expect(res.lastOffset).toBeLessThan(200)
    const seen = ids(res.rows)
    for (const id of freshIds(hourly())) expect(seen.has(id)).toBe(true)
  })

  it('a list that ends inside the window is covered by its end — a short page, repeated, never the total', async () => {
    const short = hourly(20)
    const a = await readNhatotWindowSlice(gateway(short, { total: (l) => l.length }).fetchPage, OPTS)
    expect(a.outcome).toBe('end')
    expect(a.covered).toBe(true)
    expect(a.confirmPages).toBe(1)
    expect(ids(a.rows).size).toBe(20)
    const b = await readNhatotWindowSlice(gateway(hourly(17), { total: (l) => l.length }).fetchPage, OPTS)
    expect(b.outcome).toBe('end')
    expect(b.why).toMatch(/end of results at o=14\+3, repeated by a re-request, 17 distinct ads read ≥ total 17/)
    // a total that lags the list does not end the read early
    const c = await readNhatotWindowSlice(gateway(hourly(40), { total: () => 17 }).fetchPage, OPTS)
    expect(c.outcome).toBe('end')
    expect(ids(c.rows).size).toBe(40)
    // a single page (re-requested, repeated) is one snapshot: no head re-read
    const one = await readNhatotWindowSlice(gateway(hourly(6), { total: (l) => l.length }).fetchPage, OPTS)
    expect(one).toMatchObject({ outcome: 'end', covered: true, pages: 1, headPages: 0, confirmPages: 1 })
    expect(one.why).toMatch(/single page/)
    // an empty district is covered, and says so — the coverage refuses it for a whole CITY (below)
    const empty = await readNhatotWindowSlice(gateway([]).fetchPage, OPTS)
    expect(empty).toMatchObject({ outcome: 'end', covered: true, headPages: 0, rowsRead: 0, inWindow: 0 })
    expect(empty.why).toMatch(/^empty list, repeated by a re-request, in a single page/)
  })

  it('an end that read rows but never saw a numeric total is UNCONFIRMED — repeated or not, one page or many', async () => {
    const many = await readNhatotWindowSlice(gateway(hourly(20)).fetchPage, OPTS)
    expect(many).toMatchObject({ outcome: 'endUnconfirmed', covered: false, confirmPages: 1 })
    expect(many.why).toMatch(/ended at o=20 after \d+ rows read, and no answer carried a numeric `total`/)
    const one = await readNhatotWindowSlice(gateway(hourly(6)).fetchPage, OPTS)
    expect(one).toMatchObject({ outcome: 'endUnconfirmed', covered: false, pages: 1 })
    // a total seen on ANY page of the slice is enough to hold the end to it
    const late = await readNhatotWindowSlice(gateway(hourly(20), { total: (l) => l.length }).fetchPage, OPTS)
    expect(late).toMatchObject({ outcome: 'end', covered: true })
  })

  it('UNORDERED: a page whose list_time goes UP is refused, never covered', async () => {
    const list = hourly()
    ;[list[52], list[53]] = [list[53], list[52]]   // deep inside the window, read by a main page
    const res = await readNhatotWindowSlice(gateway(list).fetchPage, OPTS)
    expect(res).toMatchObject({ outcome: 'unordered', covered: false })
    expect(res.why).toMatch(/is not newest-first: ad 1052 .* sits below ad 1053/)
  })

  it('UNORDERED: an ad that appears INSIDE the read (the list only grows at the top) is refused — in order within its page, out of order across pages', async () => {
    // between the 2nd and 3rd request an ad dated between rows 15 and 16 appears among the overlap's repeats
    const g = gateway(hourly(), { before: (call, list) => { if (call === 3) list.splice(16, 0, { id: 7777, t: NOW - 15.5 * HOUR }) } })
    const res = await readNhatotWindowSlice(g.fetchPage, OPTS)
    expect(res).toMatchObject({ outcome: 'unordered', covered: false, lastOffset: 14 })
    expect(res.why).toMatch(/the page at o=14: ad 7777 .* was not read before and is newer than the previous page's last ad/)
  })

  it('UNORDERED in the head re-read is refused too — "caught up" means nothing on a page out of order', async () => {
    const g = gateway(hourly())
    let n = 0
    const res = await readNhatotWindowSlice(async (o, limit) => {
      const p = await g.fetchPage(o, limit)
      if (o === 0 && ++n > 1) { const r = [...p.rows]; [r[1], r[2]] = [r[2], r[1]]; return { ...p, rows: r } }
      return p
    }, OPTS)
    expect(res).toMatchObject({ outcome: 'unordered', covered: false, headPages: 1 })
    expect(res.why).toMatch(/^head re-read: the page at o=0 is not newest-first/)
  })

  it('counts what it read: rows, distinct ids, and distinct non-pinned ads at or after the cutoff', async () => {
    const res = await readNhatotWindowSlice(gateway(hourly()).fetchPage, OPTS)
    expect(res.distinct).toBe(ids(res.rows).size)
    expect(res.inWindow).toBe(freshIds(hourly()).length)
    expect(res.rowsRead).toBe(res.rows.length)
  })

  it('VERIFIER CASE 1: an EMPTY first page while the gateway counts ads is a truncated answer, not an empty list', async () => {
    // a backend hiccup: every answer is empty, but carries the list's count
    const g = gateway(hourly(), { truncate: () => 0 })
    const res = await readNhatotWindowSlice(async (o, limit) => ({ rows: (await g.fetchPage(o, limit)).rows, total: 300 }), OPTS)
    expect(res).toMatchObject({ outcome: 'endContradicted', covered: false, confirmPages: 1 })
    expect(res.why).toMatch(/0 distinct ads read, short of the gateway's own total 300/)
    // with no count at all it is "covered" at the slice — and nhatotFreshCoverage refuses it for a city (below)
    const bare = await readNhatotWindowSlice(gateway(hourly(), { truncate: () => 0 }).fetchPage, OPTS)
    expect(bare).toMatchObject({ outcome: 'end', covered: true, rowsRead: 0 })
  })

  it('an empty page after a full one is a gap — rows vanished under the read', async () => {
    const g = gateway(hourly(), { truncate: (call) => (call === 2 ? 0 : null) })
    expect(await readNhatotWindowSlice(g.fetchPage, OPTS)).toMatchObject({ outcome: 'gap', covered: false })
  })

  it('VERIFIER CASE 2: a SHORT page mid-list (total 300) is refused — repeated, it contradicts the total; not repeated, it is unconfirmed', async () => {
    // the 3rd page (o=14) answers 7 of its 10 rows, every time
    const persistent = gateway(hourly(), { total: (l) => l.length, truncate: (_c, o) => (o === 14 ? 7 : null) })
    const a = await readNhatotWindowSlice(persistent.fetchPage, OPTS)
    expect(a).toMatchObject({ outcome: 'endContradicted', covered: false })
    expect(a.why).toMatch(/ended at o=21 with \d+ distinct ads read, short of the gateway's own total 300/)
    // …once only (a hiccup): the re-request answers 10 rows — not the same page
    const once = gateway(hourly(), { total: (l) => l.length, truncate: (call, o) => (o === 14 && call === 3 ? 7 : null) })
    const b = await readNhatotWindowSlice(once.fetchPage, OPTS)
    expect(b).toMatchObject({ outcome: 'endUnconfirmed', covered: false })
    expect(b.why).toMatch(/claimed the end \(7 rows\) and a re-request answered 10 different rows/)
  })

  it('a short page with NO total from the gateway still has to repeat', async () => {
    const once = gateway(hourly(), { truncate: (call, o) => (o === 14 && call === 3 ? 7 : null) })
    expect((await readNhatotWindowSlice(once.fetchPage, OPTS)).outcome).toBe('endUnconfirmed')
  })

  it('a total AT the cap with a short page below it is refused', async () => {
    const g = gateway(hourly(), { total: () => 1000, truncate: (_c, o) => (o === 21 ? 4 : null) })
    expect(await readNhatotWindowSlice(g.fetchPage, OPTS)).toMatchObject({ outcome: 'endContradicted', covered: false })
  })

  it('a SHORT head re-read page that has not reached the mark is a truncated answer, not "caught up"', async () => {
    // 25 new ads at the top mid-read; the head re-read's first answer is cut to 5 rows (all newer than the mark)
    const g = gateway(hourly(), {
      before: (call, list) => { if (call === 5) for (let k = 0; k < 25; k++) list.unshift({ id: 5000 + k, t: NOW + (k + 1) * 1000 }) },
      truncate: (call, o) => (o === 0 && call > 5 ? 5 : null),
    })
    const res = await readNhatotWindowSlice(g.fetchPage, { ...OPTS, headMaxPages: 5 })
    expect(res).toMatchObject({ outcome: 'headUnresolved', covered: false })
    expect(res.why).toMatch(/answered 5 rows without reaching/)
  })

  it('a window that outruns the cap is CAPPED, not covered', async () => {
    const res = await readNhatotWindowSlice(gateway(hourly()).fetchPage, { ...OPTS, cutoff: NOW - 400 * HOUR, cap: 50 })
    expect(res.outcome).toBe('capped')
    expect(res.covered).toBe(false)
    expect(res.why).toMatch(/reached the 50 cap/)
  })

  it('a failed request ends the slice as stopped, keeps what was read, and returns the error', async () => {
    const res = await readNhatotWindowSlice(gateway(hourly(), { failOn: 3 }).fetchPage, OPTS)
    expect(res.outcome).toBe('stopped')
    expect(res.covered).toBe(false)
    expect(res.rows.length).toBe(20)
    expect((res.error as Error).name).toBe('TimeoutError')
  })

  it('refuses an overlap that could not make progress', async () => {
    await expect(readNhatotWindowSlice(gateway(hourly()).fetchPage, { ...OPTS, overlap: 10 })).rejects.toThrow(/overlap/)
    await expect(readNhatotWindowSlice(gateway(hourly()).fetchPage, { ...OPTS, overlap: 0 })).rejects.toThrow(/overlap/)
  })
})

describe('nhatotWindowCutoff', () => {
  it('the read start, minus the window, minus the margin', () => {
    expect(nhatotWindowCutoff(NOW, 7)).toBe(NOW - 7 * DAY - NHATOT_WINDOW_MARGIN_MS)
  })
})

describe('nhatotFreshOutProblem — refused before any request', () => {
  const ok = { src: false, apply: false, retire: false, limit: 0, caps: false, maxAgeDaysGiven: true, maxAgeDays: 7, cities: ['hcm', 'hn', 'dn'] as const, cgs: [1010] }
  it('accepts an unsampled time-bounded read of every city with apartments', () => {
    expect(nhatotFreshOutProblem({ ...ok, cities: [...ok.cities] })).toBeNull()
    expect(nhatotFreshOutProblem({ ...ok, cities: [...ok.cities], maxAgeDays: 30, cgs: [1010, 1020] })).toBeNull()
  })
  it('refuses a replay, an apply, --retire, a sample, an unbounded or too-short read, a missing city or cg 1010', () => {
    const c = [...ok.cities]
    expect(nhatotFreshOutProblem({ ...ok, cities: c, src: true })).toMatch(/READS the source/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, apply: true })).toMatch(/READS the source/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, retire: true })).toMatch(/not --retire/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, limit: 30 })).toMatch(/--limit/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, caps: true })).toMatch(/--cap/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, maxAgeDaysGiven: false })).toMatch(/--max-age-days 7/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, maxAgeDays: 6 })).toMatch(/less than the 7-day/)
    expect(nhatotFreshOutProblem({ ...ok, cities: ['hcm'] })).toMatch(/leaves out hn, dn/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, cgs: [1020] })).toMatch(/leaves out 1010/)
  })
  it('refuses a --fresh-out that is the --save file (the caller canonicalises both)', () => {
    const c = [...ok.cities]
    expect(nhatotFreshOutProblem({ ...ok, cities: c, freshOut: '/run/x.json', save: '/run/x.json' })).toMatch(/same file/)
    expect(nhatotFreshOutProblem({ ...ok, cities: c, freshOut: '/run/fresh.json', save: '/run/stage.json' })).toBeNull()
    expect(nhatotFreshOutProblem({ ...ok, cities: c, freshOut: '/run/fresh.json', save: null })).toBeNull()
  })
})

/** The read started at NOW — and the set's fetchedAt is that start (item 1), not the read's end. */
const WINDOW = { maxAgeDays: 7, readStartedAt: new Date(NOW).toISOString(), cutoff: new Date(nhatotWindowCutoff(NOW, 7)).toISOString(), overlap: 10 }
const win = (outcome: 'boundary' | 'end' | 'capped' | 'gap' | 'unordered', extra: Partial<NhatotWindowSlice['window'] & object> = {}) => ({
  outcome, covered: outcome === 'boundary' || outcome === 'end', pages: 3, headPages: 1, lastOffset: 100, why: `${outcome} evidence`, rowsRead: 140, inWindow: 90, ...extra,
})
const region = (city: 'hcm' | 'hn' | 'dn', outcome: 'boundary' | 'end' | 'capped' | 'gap' | 'unordered' = 'boundary', extra: Partial<NhatotWindowSlice> = {}): NhatotWindowSlice =>
  ({ city, cg: 1010, area: null, window: win(outcome), areasSeen: [], arealess: 0, ...extra })
const covInput = (slices: NhatotWindowSlice[], over: Partial<Parameters<typeof nhatotFreshCoverage>[0]> = {}) => ({
  slices, cities: ['hcm', 'hn', 'dn'] as ('hcm' | 'hn' | 'dn')[], cgs: [1010], limit: 0, caps: false, window: WINDOW, fetchedAt: NOW, ...over,
})

describe('nhatotFreshCoverage — the proof the set carries', () => {
  it('every city’s apartment region reached its boundary or end → covered, with the evidence', () => {
    const r = nhatotFreshCoverage(covInput([region('hcm'), region('hn', 'end'), region('dn', 'end')]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.coverage).toMatch(/cg 1010 \(apartments\) in hcm, hn, dn.*hcm: boundary evidence; hn: end evidence; dn: end evidence/)
  })
  it('refuses a missing city, a missing or uncovered slice, an unbounded or sampled read, and a cutoff after the window start', () => {
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/dn\/1010: no time-bounded region slice/) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn', 'gap')]))).toMatchObject({ ok: false, why: expect.stringMatching(/dn\/1010: gap/) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { cities: ['hcm', 'hn'] }))).toMatchObject({ ok: false })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { window: null }))).toMatchObject({ ok: false, why: expect.stringMatching(/not time-bounded/) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { limit: 30 }))).toMatchObject({ ok: false })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { cgs: [1020] }))).toMatchObject({ ok: false })
    const late = { ...WINDOW, cutoff: new Date(NOW - 6 * DAY).toISOString() }
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { window: late }))).toMatchObject({ ok: false, why: expect.stringMatching(/after the window's start/) })
  })
  it('an UNORDERED region (or district) is never covered', () => {
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn', 'unordered'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/hn\/1010: unordered/) })
    const capped = region('hcm', 'capped', { districts: [13096], areasSeen: [13096] })
    const d: NhatotWindowSlice = { city: 'hcm', cg: 1010, area: 13096, window: win('unordered') }
    expect(nhatotFreshCoverage(covInput([capped, d, region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/area 13096: unordered/) })
  })
  it('ITEM 1: the set is judged at the read\'s START — a fetchedAt that is not it (the end, say) is refused', () => {
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { fetchedAt: NOW + 20 * 60_000 }))).toMatchObject({ ok: false, why: expect.stringMatching(/is not the read's start/) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')], { window: { ...WINDOW, readStartedAt: 'soon' } }))).toMatchObject({ ok: false, why: expect.stringMatching(/is not the read's start/) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), region('dn')])).ok).toBe(true)
  })
  it('a CAPPED region counts only when every district reached its boundary or end AND every area seen is one of them', () => {
    const capped = region('hcm', 'capped', { districts: [13096, 13111], areasSeen: [13096, 13111] })
    const d = (area: number, outcome: 'boundary' | 'end' | 'gap' = 'boundary'): NhatotWindowSlice => ({ city: 'hcm', cg: 1010, area, window: win(outcome) })
    const ok = nhatotFreshCoverage(covInput([capped, d(13096), d(13111, 'end'), region('hn'), region('dn')]))
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.coverage).toMatch(/re-read by its 2 districts, every one to its boundary or end \(8 pages incl\. head re-reads\), and all 2 area_v2 values seen/)
    expect(nhatotFreshCoverage(covInput([capped, d(13096), region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/district 13111 was not read/) })
    expect(nhatotFreshCoverage(covInput([capped, d(13096), d(13111, 'gap'), region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/area 13111: gap/) })
    expect(nhatotFreshCoverage(covInput([{ ...capped, areasSeen: [13096, 13111, 13200] }, d(13096), d(13111), region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/13200 seen in the region is not in the district list/) })
    expect(nhatotFreshCoverage(covInput([{ ...capped, arealess: 2 }, d(13096), d(13111), region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/2 rows carried no area_v2/) })
    expect(nhatotFreshCoverage(covInput([{ ...capped, districts: null }, region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/no district list/) })
  })
  it('VERIFIER CASE 1: a city whose apartment region read nothing, or nothing inside the window, is refused — even as an "end"', () => {
    const emptyHn = region('hn', 'end', { window: win('end', { rowsRead: 0, inWindow: 0, why: 'empty list, repeated by a re-request, in a single page' }) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), emptyHn, region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/hn\/1010: the region read 0 rows/) })
    const oldDn = region('dn', 'boundary', { window: win('boundary', { rowsRead: 50, inWindow: 0 }) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), oldDn]))).toMatchObject({ ok: false, why: expect.stringMatching(/dn\/1010: the region read no non-pinned ad inside the window/) })
    // a slice from before these counts existed proves nothing either
    const legacy = { ...region('hn'), window: { ...win('boundary'), rowsRead: undefined, inWindow: undefined } } as unknown as NhatotWindowSlice
    expect(nhatotFreshCoverage(covInput([region('hcm'), legacy, region('dn')]))).toMatchObject({ ok: false })
  })
  it('an end that did not repeat, or fell short of the total, is not covered', () => {
    const r = (outcome: string) => ({ city: 'dn' as const, cg: 1010, area: null, window: { ...win('end'), outcome, covered: false } } as unknown as NhatotWindowSlice)
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), r('endUnconfirmed')]))).toMatchObject({ ok: false, why: expect.stringMatching(/dn\/1010: endUnconfirmed/) })
    expect(nhatotFreshCoverage(covInput([region('hcm'), region('hn'), r('endContradicted')]))).toMatchObject({ ok: false, why: expect.stringMatching(/dn\/1010: endContradicted/) })
  })
  it('a district that read 0 rows counts only when the region read saw none of its ads', () => {
    const capped = region('hcm', 'capped', { districts: [13096, 13111, 13120], areasSeen: [13096, 13111] })
    const d = (area: number, extra: Partial<NhatotWindowSlice['window'] & object> = {}): NhatotWindowSlice => ({ city: 'hcm', cg: 1010, area, window: win('end', extra) })
    const empty = { rowsRead: 0, inWindow: 0 }
    expect(nhatotFreshCoverage(covInput([capped, d(13096), d(13111), d(13120, empty), region('hn'), region('dn')])).ok).toBe(true)
    expect(nhatotFreshCoverage(covInput([capped, d(13096), d(13111, empty), d(13120), region('hn'), region('dn')]))).toMatchObject({ ok: false, why: expect.stringMatching(/area 13111: read 0 rows, but the region read saw its ads/) })
  })
})

const ad = (id: number, list_time: number | null, category = 1010, extra: Record<string, unknown> = {}): NhatotStagedAd =>
  stageNhatotAd({ list_id: id, category, list_time, type: 'u', status: 'active', region_v2: 13000, ...extra })!

describe('nhatotBuildFreshSet', () => {
  const build = (ads: NhatotStagedAd[], unjudged: number[] = []) => nhatotBuildFreshSet({ ads, unjudged, fetchedAt: new Date(NOW), coverage: 'proof' }).set
  it('apartments dated inside the window at fetch — the 7th day in, a millisecond past it out; other categories never', () => {
    const s = build([ad(134000001, NOW - HOUR), ad(134000002, NOW - FRESH_DAYS * DAY), ad(134000003, NOW - FRESH_DAYS * DAY - 1), ad(134000004, NOW, 1020)])
    expect(s.items.map((i) => i.externalId)).toEqual(['nhatot:134000001', 'nhatot:134000002'])
    expect(s.items[0]).toEqual({ externalId: 'nhatot:134000001', sourceDate: new Date(NOW - HOUR).toISOString(), dateKind: 'list-time' })
    expect(s.unknown).toEqual([])
    expect(s).toMatchObject({ sellerId: 'nhatot-import-seller-0001', fetchedAt: new Date(NOW).toISOString(), windowDays: FRESH_DAYS, complete: true, coverage: 'proof' })
  })
  it('includes ads the mapper would refuse for a non-age reason (a per-m² price, no photos)', () => {
    const s = build([ad(134000005, NOW - DAY, 1010, { is_price_not_valid: true, price_string: '50 tr/m²', images: [] })])
    expect(s.items.map((i) => i.externalId)).toEqual(['nhatot:134000005'])
  })
  it('no date, a date past the clock-skew allowance, and an unstageable row are UNKNOWN (kept live) — never items, never dropped', () => {
    const s = build([ad(134000006, null), ad(134000007, NOW + HOUR), ad(134000008, NOW + 60_000)], [134000009, 134000001])
    expect(s.items.map((i) => i.externalId)).toEqual(['nhatot:134000008'])   // within the 5-minute skew: judged
    expect(s.unknown).toEqual(['nhatot:134000001', 'nhatot:134000006', 'nhatot:134000007', 'nhatot:134000009'])
  })
  it('an id that is both judged and unjudged is an item only; an id outside the source’s shape is left out and counted', () => {
    const r = nhatotBuildFreshSet({ ads: [ad(134000010, NOW - DAY), ad(12345, NOW - DAY)], unjudged: [134000010], fetchedAt: new Date(NOW), coverage: 'p' })
    expect(r.set.items.map((i) => i.externalId)).toEqual(['nhatot:134000010'])
    expect(r.set.unknown).toEqual([])
    expect(r.skipped).toBe(1)
  })
})

describe('nhatotFreshDecision — coverage, set, and the expiry’s own check', () => {
  const staged = (over: Record<string, unknown> = {}) => ({
    fetchedAt: new Date(NOW).toISOString(),
    params: { cities: ['hcm', 'hn', 'dn'] as ('hcm' | 'hn' | 'dn')[], cgs: [1010], limit: 0, window: WINDOW },
    slices: [region('hcm'), region('hn', 'end'), region('dn', 'end')],
    ads: Array.from({ length: 30 }, (_, i) => ad(134100000 + i, NOW - i * 6 * HOUR)),
    unjudged: [] as number[],
    ...over,
  })
  it('a covered read gives a set that passes freshSetProblem as written', () => {
    const d = nhatotFreshDecision(staged(), NOW + 60_000)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.set.items).toHaveLength(29)   // i = 29 is 174 h old
    expect(freshSetProblem(JSON.parse(JSON.stringify(d.set)), NOW + 60_000, 'nhatot-import-seller-0001')).toBeNull()
  })
  it('ITEM 1: an ad listed after the read\'s start (+5 min skew) is UNKNOWN — kept live, never claimed; within the skew it is an item', () => {
    const d = nhatotFreshDecision(staged({ ads: [...staged().ads, ad(134200001, NOW + 2 * 60_000), ad(134200002, NOW + 10 * 60_000), ad(134200003, NOW + 45 * 60_000)] }), NOW + 60 * 60_000)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.set.fetchedAt).toBe(WINDOW.readStartedAt)
    expect(d.set.items.map((i) => i.externalId)).toContain('nhatot:134200001')
    expect(d.set.unknown).toEqual(['nhatot:134200002', 'nhatot:134200003'])
    expect(d.set.items.map((i) => i.externalId)).not.toContain('nhatot:134200002')
  })
  it('refuses when the read did not cover the window, when the set would fail its check, and on a bad fetchedAt', () => {
    expect(nhatotFreshDecision(staged({ slices: [region('hcm', 'gap'), region('hn'), region('dn')] }), NOW + 60_000)).toMatchObject({ ok: false, why: expect.stringMatching(/hcm\/1010: gap/) })
    expect(nhatotFreshDecision(staged({ unjudged: [134900001, 134900002, 134900003, 134900004, 134900005, 134900006] }), NOW + 60_000)).toMatchObject({ ok: false, why: expect.stringMatching(/fails its own check: 6 of 35 undetermined/) })
    expect(nhatotFreshDecision(staged(), NOW + 25 * HOUR)).toMatchObject({ ok: false, why: expect.stringMatching(/over 24 h old/) })
    expect(nhatotFreshDecision(staged({ fetchedAt: 'yesterday' }), NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/not a date/) })
  })
})

describe('nhatotExistingRowPlan — what --apply does to an existing row', () => {
  const at = NOW
  const src = { postedAt: new Date(NOW - 2 * DAY), subcategorySlug: APARTMENT_SUBCAT }
  const stored = new Date(NOW - 20 * DAY)
  it('REVIVES an expired or stale apartment the source shows inside the window, with postedAt = the source date', () => {
    expect(nhatotExistingRowPlan({ status: 'expired', postedAt: stored }, src, at)).toEqual({ revive: true, postedAt: src.postedAt })
    expect(nhatotExistingRowPlan({ status: 'stale', postedAt: stored }, src, at)).toEqual({ revive: true, postedAt: src.postedAt })
    // even when the stored date is LATER (a row created before postedAt was the source date)
    expect(nhatotExistingRowPlan({ status: 'expired', postedAt: new Date(NOW) }, src, at)).toEqual({ revive: true, postedAt: src.postedAt })
  })
  it('never revives a hidden, sold, active or removed row, a non-apartment, or one outside the window at the stage’s fetch', () => {
    for (const status of ['hidden', 'sold', 'active', 'removed']) expect(nhatotExistingRowPlan({ status, postedAt: stored }, src, at).revive).toBe(false)
    expect(nhatotExistingRowPlan({ status: 'expired', postedAt: stored }, { ...src, subcategorySlug: 'house-rental' }, at).revive).toBe(false)
    expect(nhatotExistingRowPlan({ status: 'expired', postedAt: stored }, { ...src, postedAt: new Date(NOW - 8 * DAY) }, at).revive).toBe(false)
    // judged at the STAGE's fetch time, not the apply's clock
    expect(nhatotExistingRowPlan({ status: 'expired', postedAt: stored }, { ...src, postedAt: new Date(NOW - 6 * DAY) }, NOW + 2 * DAY).revive).toBe(false)
  })
  it('moves postedAt only FORWARD on an update (a re-list), whatever the status or category', () => {
    expect(nhatotExistingRowPlan({ status: 'active', postedAt: stored }, src, at)).toEqual({ revive: false, postedAt: src.postedAt })
    expect(nhatotExistingRowPlan({ status: 'hidden', postedAt: stored }, { ...src, subcategorySlug: 'room-rental' }, at)).toEqual({ revive: false, postedAt: src.postedAt })
    expect(nhatotExistingRowPlan({ status: 'active', postedAt: src.postedAt }, src, at).postedAt).toBeNull()
    expect(nhatotExistingRowPlan({ status: 'active', postedAt: new Date(NOW - DAY) }, src, at).postedAt).toBeNull()
  })
})

describe('the rollback lines --apply writes AFTER a write moved a row', () => {
  const OLD = new Date('2026-09-01T03:04:05.678Z'), NEW = new Date('2026-09-30T10:00:00.000Z')
  it('quotes literals (a quote is doubled)', () => {
    expect(nhatotSqlLit("a'b")).toBe("'a''b'")
  })
  it('a tombstone INSERT for both language pages of the id, newest stamp wins', () => {
    const t = nhatotTombstoneSql("cm'x")
    expect(t).toContain("ARRAY['eno:isrtag:_N_T_/en/listings/cm''x','eno:isrtag:_N_T_/vi/listings/cm''x']")
    expect(t).toMatch(/^INSERT INTO next_cache_tag \(tag, stamp, expires_at\) SELECT t, \(extract\(epoch from clock_timestamp\(\)\)\*1000\)::bigint, now\(\) \+ interval '40 days'/)
    expect(t).toMatch(/ON CONFLICT \(tag\) DO UPDATE SET stamp = greatest\(next_cache_tag\.stamp, excluded\.stamp\), expires_at = greatest\(next_cache_tag\.expires_at, excluded\.expires_at\);$/)
  })
  it('a revival: back to its OWN old status and dates, only while it is still active with the postedAt this run set — and re-tombstoned', () => {
    const sql = nhatotRevivalRollbackSql({ id: 'cmabc', oldStatus: 'expired', oldPostedAt: OLD, oldRankScore: 0.000123, newPostedAt: NEW })
    const [update, tomb] = sql.split('\n')
    expect(update).toBe(`UPDATE "Listing" SET status = 'expired', "postedAt" = '2026-09-01T03:04:05.678Z', "rankScore" = 0.000123 WHERE id = 'cmabc' AND "sellerId" = 'nhatot-import-seller-0001' AND status = 'active' AND "postedAt" = '2026-09-30T10:00:00.000Z';`)
    expect(tomb).toBe(nhatotTombstoneSql('cmabc'))
    expect(nhatotRevivalRollbackSql({ id: 'x', oldStatus: 'stale', oldPostedAt: OLD, oldRankScore: 1e-9, newPostedAt: NEW })).toContain('"rankScore" = 1e-9 ')
  })
  it('refuses to write a rollback into a status a revival never comes from, or a non-number rank', () => {
    for (const oldStatus of ['active', 'hidden', 'removed', 'sold']) expect(() => nhatotRevivalRollbackSql({ id: 'x', oldStatus, oldPostedAt: OLD, oldRankScore: 1, newPostedAt: NEW })).toThrow(/not a status a revival comes from/)
    expect(() => nhatotRevivalRollbackSql({ id: 'x', oldStatus: 'expired', oldPostedAt: OLD, oldRankScore: NaN, newPostedAt: NEW })).toThrow(/not a finite number/)
  })
  it('a moved postedAt: the old pair, only while the row still carries the date this run set, never a removed row', () => {
    const [update, tomb] = nhatotRepostRollbackSql({ id: 'cmabc', oldPostedAt: OLD, oldRankScore: 0.5, newPostedAt: NEW }).split('\n')
    expect(update).toBe(`UPDATE "Listing" SET "postedAt" = '2026-09-01T03:04:05.678Z', "rankScore" = 0.5 WHERE id = 'cmabc' AND "sellerId" = 'nhatot-import-seller-0001' AND "postedAt" = '2026-09-30T10:00:00.000Z' AND status <> 'removed';`)
    expect(update).not.toMatch(/SET status/)
    expect(tomb).toBe(nhatotTombstoneSql('cmabc'))
  })
})

/**
 * scripts/import-nhatot-com.ts opens the network and a database on import, so where it CALLS the pieces
 * above is pinned at the source level (same approach as nhatot-importer-wiring.test.ts).
 */
describe('scripts/import-nhatot-com.ts — the 7-day rule wiring', () => {
  const src = readFileSync('scripts/import-nhatot-com.ts', 'utf8')
  const main = src.slice(src.indexOf('async function importMain('), src.indexOf('// ─── retire'))
  it('refuses --fresh-out and clears a previous set BEFORE any request', () => {
    const check = main.indexOf('const freshOutProblem = FRESH_OUT === null ? null : nhatotFreshOutProblem(')
    const clear = main.indexOf('if (FRESH_OUT !== null) clearPreviousFreshSet(FRESH_OUT)')
    expect(check).toBeGreaterThan(0)
    expect(clear).toBeGreaterThan(check)
    expect(clear).toBeLessThan(main.indexOf('await sitePolicy()'))
  })
  it('writes the set from THIS read, only through nhatotFreshDecision, atomically', () => {
    expect(main).toMatch(/if \(FRESH_OUT !== null\) writeFreshOut\(FRESH_OUT, staged\)/)
    const w = src.slice(src.indexOf('function writeFreshOut('), src.indexOf('function writeFreshOut(') + 900)
    expect(w.indexOf('const d = nhatotFreshDecision(staged, Date.now())')).toBeGreaterThan(0)
    expect(w.indexOf('if (!d.ok) {')).toBeLessThan(w.indexOf('process.exitCode = 3'))
    expect(w.indexOf('process.exitCode = 3')).toBeLessThan(w.indexOf('writeFileAtomic(path,'))
    const a = src.slice(src.indexOf('function writeFileAtomic('), src.indexOf('function writeFreshOut('))
    expect(a.indexOf('fsyncSync(fd)')).toBeLessThan(a.indexOf('renameSync(tmp, path)'))
  })
  it('a revival: the PLAN is journalled before the write, the status re-checked IN the write, the rollback written only after it moved the row, and the page tombstoned at once', () => {
    const plan = main.indexOf('recordDurably(REVIVED,')
    const write = main.indexOf('where: { id: cur.id, sellerId: NHATOT_SELLER_ID, status: { in: [...REVIVABLE_STATUSES] } }')
    const moved = main.indexOf('if (back.count !== 1) { stat.raced++; continue }')
    const rollback = main.indexOf('recordDurably(DATES_ROLLBACK, nhatotRevivalRollbackSql(')
    const tomb = main.indexOf('if (!(await tombstoneNow(db, [cur.id]))) tombstoneFailed = true')
    expect(plan).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(plan)
    expect(moved).toBeGreaterThan(write)
    expect(rollback).toBeGreaterThan(moved)
    expect(tomb).toBeGreaterThan(rollback)
    // the id is owed a tombstone BEFORE the write: a write that commits and then loses its reply throws,
    // and the finally must still tombstone that page
    const owed = main.indexOf('revivedIds.push(cur.id)')
    expect(owed).toBeGreaterThan(plan)
    expect(owed).toBeLessThan(write)
  })
  it('the write loop sits in try/finally, and the finally tombstones every revived page again', () => {
    const loop = main.indexOf('  try {\n    for (const r of batch) {')
    const fin = main.indexOf('  } finally {\n')
    expect(loop).toBeGreaterThan(0)
    expect(fin).toBeGreaterThan(loop)
    expect(main.slice(fin, fin + 600)).toMatch(/if \(await tombstoneNow\(db, revivedIds\)\) tombstoneFailed = false/)
    expect(main).toMatch(/if \(tombstoneFailed && !process\.exitCode\) process\.exitCode = 1/)
  })
  it('refuses before the FIRST status write (the screen\'s hides included) when there is no next_cache_tag table', () => {
    const check = main.indexOf("if (!isrTable && !ALLOW_NO_ISR) throw new Error('no next_cache_tag table")
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(main.indexOf('await screen.applyHides()'))
    expect(check).toBeLessThan(main.indexOf('await db.listing.updateMany('))
    expect(check).toBeLessThan(main.indexOf('await db.listing.create('))
    const present = src.slice(src.indexOf('async function isrTagTablePresent('), src.indexOf('async function tombstoneNow('))
    expect(present).toMatch(/select to_regclass\('public\.next_cache_tag'\)::text as t/)
  })
  it('a refresh / moved postedAt is an updateMany that can never touch a removed row; the date moves only from the one read; the rollback only after it moved', () => {
    expect(main).not.toMatch(/db\.listing\.update\(/)
    const plan = main.indexOf('recordDurably(REPOSTED,')
    const write = main.indexOf("where: { id: cur.id, sellerId: NHATOT_SELLER_ID, status: { not: 'removed' }, ...(plan.postedAt ? { postedAt: cur.postedAt } : {}) },")
    const moved = main.indexOf('if (w.count !== 1) { stat.raced++; continue }')
    const rollback = main.indexOf('recordDurably(DATES_ROLLBACK, nhatotRepostRollbackSql(')
    expect(plan).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(plan)
    expect(moved).toBeGreaterThan(write)
    expect(rollback).toBeGreaterThan(moved)
    expect(main).toMatch(/const dates = plan\.postedAt \? \{ postedAt: plan\.postedAt, rankScore: rankAt\(plan\.postedAt\) \} : \{\}/)
    expect(main).toMatch(/const rankOf = \(r: NhatotMapped\) => rankAt\(r\.postedAt\)/)
  })
  it('the create age limit is judged at the STAGE\'s fetch time — the instant the set is judged at', () => {
    expect(main).toMatch(/const stagedAt = Date\.parse\(staged\.fetchedAt\)/)
    expect(main).toMatch(/mapNhatotAd\(ad, \{ now, ageAt: stagedAt, maxAgeDays: MAX_AGE_DAYS, maxPhotos: MAX_PHOTOS \}\)/)
    expect(main.indexOf('const stagedAt = Date.parse(staged.fetchedAt)')).toBeLessThan(main.indexOf('mapNhatotAd(ad,'))
  })
  it('the time-bounded read is the --fresh-out run\'s read — never switched on by --max-age-days alone', () => {
    expect(src).toMatch(/const TIME_BOUNDED = FRESH_OUT !== null && !SRC && !RETIRE && !LIMIT && !HAS_CAPS/)
    expect(src).not.toMatch(/TIME_BOUNDED = [^\n]*MAX_AGE_GIVEN/)
  })
  it('refuses a --fresh-out that is the --save file, canonicalised, before any request', () => {
    expect(main).toMatch(/freshOut: canonicalPath\(FRESH_OUT\), save: SAVE === null \? null : canonicalPath\(SAVE\)/)
  })
  it('a 200 list answer with no `ads` array is an error, never an empty page', () => {
    const lp = src.slice(src.indexOf('async function listPage('), src.indexOf('// ─── the live read'))
    expect(lp).toMatch(/if \(!Array\.isArray\(d\.ads\)\) throw new BadListBody\(/)
    expect(lp).not.toMatch(/Array\.isArray\(d\.ads\) \? d\.ads : \[\]/)
    // and the time-bounded read retries it once like a timeout (it is not a StopRead)
    expect(src).toMatch(/class BadListBody extends Error \{\}/)
  })
  it('every file a later step reads is written atomically: fsync, rename, fsync of the directory', () => {
    const a = src.slice(src.indexOf('function writeFileAtomic('), src.indexOf('function canonicalPath('))
    expect(a.indexOf('fsyncSync(fd)')).toBeLessThan(a.indexOf('renameSync(tmp, path)'))
    expect(a.indexOf('renameSync(tmp, path)')).toBeLessThan(a.indexOf('fsyncDir(dirname(resolve(path)))'))
    expect(src).toMatch(/if \(SAVE\) writeFileAtomic\(SAVE, JSON\.stringify\(staged, null, 1\)\)/)
    expect(src).toMatch(/if \(SAVE\) writeFileAtomic\(SAVE, JSON\.stringify\(file, null, 1\)\)/)
    expect(src).not.toMatch(/writeFileSync/)
  })
  it('--retire --apply: ISR check before the first hide; plan before the write; rollback + tombstone only after it moved; try/finally', () => {
    const retire = src.slice(src.indexOf('async function retireMain('), src.indexOf('// DRY: the live check.'))
    const check = retire.indexOf("if (!isrTable && !ALLOW_NO_ISR) throw new Error('no next_cache_tag table")
    const plan = retire.indexOf('recordDurably(RETIRED,')
    const write = retire.indexOf("data: { status: 'hidden' }")
    const moved = retire.indexOf('if (n.count !== 1) { stat.raced++; continue }')
    const rollback = retire.indexOf('recordDurably(ROLLBACK,')
    const after = retire.indexOf('if (!(await tombstoneNow(db, [row.id]))) tombstoneFailed = true')
    expect(check).toBeGreaterThan(0)
    expect(plan).toBeGreaterThan(check)
    expect(write).toBeGreaterThan(plan)
    expect(moved).toBeGreaterThan(write)
    expect(rollback).toBeGreaterThan(moved)
    expect(after).toBeGreaterThan(rollback)
    expect(retire).toMatch(/\} finally \{\n\s+if \(hiddenIds\.length\) \{\n\s+if \(await tombstoneNow\(db, hiddenIds\)\)/)
    // the rollback line is guarded on the state the hide created and carries its page's tombstone
    expect(retire).toMatch(/AND status = 'hidden';\\n\$\{nhatotTombstoneSql\(row\.id\)\}/)
  })
  it('ITEM 1: the staged fetchedAt is the read\'s START, in both read paths — never the instant the read ended', () => {
    const fl = src.slice(src.indexOf('async function fetchLive('), src.indexOf('function readStaged('))
    expect(fl).toMatch(/const readStartedAt = Date\.now\(\)\n[\s\S]*?const fetchedAt = new Date\(readStartedAt\)\.toISOString\(\)/)
    expect(fl.indexOf('const fetchedAt = new Date(readStartedAt).toISOString()')).toBeLessThan(fl.indexOf('await fetchWindowed('))
    expect(fl.match(/^\s+fetchedAt,$/gm)?.length).toBe(2)
    expect(fl).not.toMatch(/fetchedAt: new Date\(\)/)
  })
  it('ITEM 4: in the plain read a malformed answer ends only ITS slice (failed, read incomplete); `stopped` is a StopRead only', () => {
    const rs = src.slice(src.indexOf('async function readSlice('), src.indexOf('/** District ids for a region'))
    expect(rs).toMatch(/if \(e instanceof StopRead\) \{ rep\.note = e\.message; rep\.stopped = true \}/)
    expect(rs).toMatch(/else if \(e instanceof BadListBody\) \{ rep\.note = [^\n]*; rep\.failed = true \}\n\s+else throw e/)
    expect(rs.match(/rep\.stopped = true/g)?.length).toBe(1)
    const fl = src.slice(src.indexOf('async function fetchLive('), src.indexOf('function readStaged('))
    expect(fl).toMatch(/if \(rep\.stopped\) \{ truncated = true; break \}[^\n]*\n\s+if \(rep\.failed\) truncated = true/)
    expect(fl).toMatch(/if \(sub\.stopped\) \{ truncated = true; break \}\n\s+if \(sub\.failed\) truncated = true/)
    // the --cap merge: only a StopRead ends the whole read
    expect(fl).toMatch(/const stop = r\.error instanceof StopRead\n[\s\S]*?truncated = true\n\s+if \(stop\) stoppedAll = true/)
    expect(fl).not.toMatch(/truncated = true; stoppedAll = true/)
  })
  it('ITEM 5: --apply prints APPLY COMPLETED as its LAST line, only when the row loop reached the end of the batch; the exit code is unchanged', () => {
    const tail = main.slice(main.indexOf('process.exitCode = nhatotApplyExitCode(stat, stopped)'))
    expect(tail).toMatch(/^process\.exitCode = nhatotApplyExitCode\(stat, stopped\)\n\s+if \(tombstoneFailed && !process\.exitCode\) process\.exitCode = 1\n[\s\S]*?\n\s+if \(stopped === null\) console\.log\('APPLY COMPLETED'\)\n\}\n/)
    expect(src.match(/APPLY COMPLETED'\)/g)?.length).toBe(1)
    expect(main.indexOf("console.log('APPLY COMPLETED')")).toBeGreaterThan(main.lastIndexOf('await db.$disconnect()'))
    // the row loop's one early exit is a StopRead, and it sets `stopped`; every other row error is counted, not thrown
    expect(main).toMatch(/if \(e instanceof StopRead\) \{ stopped = e\.message; break \}\n\s+if \(\(e as \{ code\?: string \}\)\.code === 'P2002'\) stat\.raced\+\+\n\s+else \{ stat\.errored\+\+;/)
  })
  it('--retire checks every id through detailChecked (a timeout is unknown, not a crash)', () => {
    const retire = src.slice(src.indexOf('async function retireMain('))
    expect(retire).toMatch(/results\.push\(await detailChecked\(id\)\)/)
    expect(retire).not.toMatch(/await detail\(/)
  })
})
