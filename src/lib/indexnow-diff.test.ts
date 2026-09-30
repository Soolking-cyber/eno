import { describe, expect, it } from 'vitest'
import {
  BATCH_MAX, GUARD_MAX_REMOVALS, asSnapshot, batches, diffSnapshots, guardTrip, isEligibleUrl, isFrozen,
  nextHold, parseSitemapIndex, parseUrlset, planRun, shouldRebaseline, type Hold, type RunPlan, type Snapshot,
} from './indexnow-diff'

const U = (p: string) => `https://eno.vn${p}`
const H = 60 * 60 * 1000
const T0 = new Date('2026-10-01T01:30:00Z')
const at = (hours: number) => new Date(T0.getTime() + hours * H)

/** A site of `n` listing URLs plus the rent index, as loc → lastmod. */
function site(n: number, over: Record<string, string> = {}): Map<string, string> {
  const m = new Map<string, string>()
  for (let i = 0; i < n; i++) m.set(U(`/listings/l${String(i).padStart(4, '0')}`), '2026-09-01T00:00:00.000Z')
  m.set(U('/hcmc-rent-index'), '2026-09-30T00:00:00.000Z')
  m.set(U('/about'), '')
  for (const [k, v] of Object.entries(over)) m.set(U(k), v)
  return m
}
const snap = (m: Map<string, string>, savedAt = T0): Snapshot => ({ v: 1, savedAt: savedAt.toISOString(), urls: Object.fromEntries(m) })
const without = (m: Map<string, string>, locs: string[]) => {
  const out = new Map(m)
  for (const l of locs) out.delete(l)
  return out
}
const listing = (i: number) => U(`/listings/l${String(i).padStart(4, '0')}`)
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => listing(from + i))

/** Every URL a plan would send is in the current sitemaps or the previous snapshot, and never frozen. */
function assertEligible(plan: RunPlan, prev: Snapshot | null, curr: Map<string, string>, frozen: string[] = []) {
  const list = 'urlList' in plan ? plan.urlList : []
  for (const u of list) {
    expect(curr.has(u) || (prev ? u in prev.urls : false)).toBe(true)
    expect(isFrozen(u, frozen)).toBe(false)
    expect(isEligibleUrl(u)).toBe(true)
  }
}

describe('parsing', () => {
  it('keeps only https://eno.vn locs: www, subdomains, eno.forum and http are dropped', () => {
    const xml = `<?xml version="1.0"?><urlset>
  <url><loc>https://eno.vn/a</loc><lastmod>2026-09-01</lastmod></url>
  <url><loc>https://www.eno.vn/b</loc></url>
  <url><loc>https://shop.eno.vn/</loc></url>
  <url><loc>https://www.eno.forum/c</loc></url>
  <url><loc>http://eno.vn/d</loc></url>
  <url><loc>https://eno.vn/e?x=1&amp;y=2</loc></url>
</urlset>`
    const { urls, rawCount } = parseUrlset(xml)
    expect(rawCount).toBe(6)
    expect([...urls]).toEqual([[U('/a'), '2026-09-01'], [U('/e?x=1&y=2'), '']])
  })

  it('reads a sitemap index', () => {
    expect(parseSitemapIndex('<sitemapindex>\n  <sitemap><loc>https://eno.vn/sitemaps/pages.xml</loc></sitemap>\n  <sitemap><loc>https://eno.vn/sitemaps/listings-0.xml</loc></sitemap>\n</sitemapindex>'))
      .toEqual([U('/sitemaps/pages.xml'), U('/sitemaps/listings-0.xml')])
  })

  it('a frozen entry ending in / is a prefix; any other is exact', () => {
    const f = ['/c/rentals/', '/hcmc-rent-index']
    expect(isFrozen(U('/c/rentals/d1'), f)).toBe(true)
    expect(isFrozen(U('/hcmc-rent-index'), f)).toBe(true)
    expect(isFrozen(U('/c/rentals'), f)).toBe(false)
    expect(isFrozen(U('/hcmc-rent-index.csv'), f)).toBe(false)
    expect(isFrozen(U('/c/electronics/d1'), f)).toBe(false)
  })

  it('a stored value that is not a v1 snapshot is no snapshot', () => {
    expect(asSnapshot(null)).toBeNull()
    expect(asSnapshot({ v: 2, urls: {} })).toBeNull()
    expect(asSnapshot({ v: 1, savedAt: 'x', urls: {} })).not.toBeNull()
  })
})

describe('the diff', () => {
  it('finds added, changed (lastmod moved) and removed URLs', () => {
    const prev = site(3)
    const curr = without(site(3, { '/new': '2026-10-01' }), [listing(2)])
    curr.set(listing(0), '2026-10-01T00:00:00.000Z')
    const d = diffSnapshots(Object.fromEntries(prev), curr)
    expect(d.added).toEqual([U('/new')])
    expect(d.changed).toEqual([listing(0)])
    expect(d.removed).toEqual([listing(2)])
  })

  it('a URL without a lastmod is sent only when added or removed, and one that loses its lastmod keeps the stored one', () => {
    const prev = { [U('/about')]: '', [U('/x')]: '2026-09-01' }
    const curr = new Map([[U('/about'), ''], [U('/x'), '']])
    const d = diffSnapshots(prev, curr)
    expect(d.changed).toEqual([])
    expect(d.next[U('/x')]).toBe('2026-09-01')
    // The date comes back unchanged: not a change. Moved: a change.
    expect(diffSnapshots(d.next, new Map([[U('/about'), ''], [U('/x'), '2026-09-01']])).changed).toEqual([])
    expect(diffSnapshots(d.next, new Map([[U('/about'), ''], [U('/x'), '2026-09-02']])).changed).toEqual([U('/x')])
  })

  it('batches at 10,000', () => {
    const list = Array.from({ length: 2 * BATCH_MAX + 1 }, (_, i) => U(`/l${i}`))
    expect(batches(list).map((b) => b.length)).toEqual([BATCH_MAX, BATCH_MAX, 1])
  })

  it('the guard trips on more than 50 removals, or a drop of more than 30%', () => {
    expect(guardTrip({ removed: range(0, GUARD_MAX_REMOVALS), prevCount: 1000, currCount: 950 })).toBeNull()
    expect(guardTrip({ removed: range(0, GUARD_MAX_REMOVALS + 1), prevCount: 1000, currCount: 949 })).toMatch(/removed 51/)
    expect(guardTrip({ removed: range(0, 31), prevCount: 100, currCount: 69 })).toMatch(/fell from 100 to 69/)
    expect(guardTrip({ removed: range(0, 30), prevCount: 100, currCount: 70 })).toBeNull()
  })
})

describe('a run', () => {
  it('the first run records a baseline and sends nothing', () => {
    const curr = site(5)
    const plan = planRun({ prev: null, curr, hold: null, now: T0 })
    expect(plan.kind).toBe('baseline')
    if (plan.kind !== 'baseline') return
    expect(plan.count).toBe(curr.size)
    expect(plan.next.urls).toEqual(Object.fromEntries(curr))
  })

  it('under the thresholds it sends added + changed + removed, and nothing when nothing moved', () => {
    const prev = snap(site(100))
    const curr = without(site(100, { '/new': '2026-10-01' }), range(0, 3))
    const plan = planRun({ prev, curr, hold: null, now: T0 })
    expect(plan.kind).toBe('send')
    if (plan.kind !== 'send') return
    expect(plan.urlList).toEqual([U('/new'), ...range(0, 3)])
    assertEligible(plan, prev, curr)
    const still = planRun({ prev: plan.next, curr, hold: null, now: at(12) })
    expect(still.kind === 'send' && still.urlList).toEqual([])
  })

  it('?rebaseline=1 accepts the current state and sends nothing', () => {
    const prev = snap(site(200))
    const curr = without(site(200), range(0, 150))
    const plan = planRun({ prev, curr, hold: null, now: T0, rebaseline: true })
    expect(plan.kind).toBe('manual-rebaseline')
    expect('urlList' in plan).toBe(false)
  })

  it('a trip whose removed set overlaps the held set by only 80% starts a NEW hold at count 1', () => {
    const held: Hold = nextHold(null, range(0, 60), T0, 'r')
    // 48 of the 60 (80%) plus 12 others.
    const r = [...range(0, 48), ...range(100, 112)]
    const h2 = nextHold(held, r, at(12), 'r')
    expect(h2.count).toBe(1)
    expect(h2.firstAt).toBe(at(12).toISOString())
    expect(h2.removed).toEqual([...r].sort())
  })

  it('new URLs never reset the hold: only removals are compared', () => {
    const prev = snap(site(300))
    const tripped = planRun({ prev, curr: without(site(300), range(0, 60)), hold: null, now: T0 })
    expect(tripped.kind).toBe('trip')
    if (tripped.kind !== 'trip') return
    const extra: Record<string, string> = {}
    for (let i = 0; i < 40; i++) extra[`/fresh-${i}`] = '2026-10-01'
    const again = planRun({ prev, curr: without(site(300, extra), range(0, 60)), hold: tripped.hold, now: at(12) })
    expect(again.kind).toBe('trip')
    expect(again.kind === 'trip' && again.hold.count).toBe(2)
  })

  it('an automatic re-baseline sends EVERY added and changed URL, never a truncated list (the snapshot records them all)', () => {
    const prev = snap(site(100))
    const extra: Record<string, string> = {}
    for (let i = 0; i < BATCH_MAX + 5; i++) extra[`/new-${i}`] = '2026-10-01'
    const held: Hold = { reason: 'r', removed: range(0, 60), count: 2, firstAt: T0.toISOString(), lastAt: T0.toISOString(), overlap: 1 }
    const plan = planRun({ prev, curr: without(site(100, extra), range(0, 60)), hold: held, now: at(24) })
    expect(plan.kind).toBe('auto-rebaseline')
    expect(plan.kind === 'auto-rebaseline' && plan.urlList.length).toBe(BATCH_MAX + 5)
    expect(plan.kind === 'auto-rebaseline' && batches(plan.urlList).length).toBe(2)
  })

  it('re-baselines automatically only at count 3 AND 20 hours', () => {
    const h: Hold = { reason: 'r', removed: range(0, 60), count: 3, firstAt: T0.toISOString(), lastAt: T0.toISOString(), overlap: 1 }
    expect(shouldRebaseline(h, at(19.9))).toBe(false)
    expect(shouldRebaseline(h, at(20))).toBe(true)
    expect(shouldRebaseline({ ...h, count: 2 }, at(48))).toBe(false)
  })

  /**
   * ⛔ THE CHURN TEST (round-2 review, A2/O1): a legitimate mass removal, with normal churn on every
   * later run, must still re-baseline on the third trip — never wedge.
   */
  it('a mass removal under churn: hold, hold, auto re-baseline with zero removals, then normal diffs', () => {
    const base = site(300)
    const prev = snap(base)
    const gone60 = range(0, 60)

    // Run 1 (T0): 60 removals — trips; the hold starts at count 1.
    const c1 = without(base, gone60)
    const p1 = planRun({ prev, curr: c1, hold: null, now: T0 })
    expect(p1.kind).toBe('trip')
    if (p1.kind !== 'trip') return
    expect(p1.hold).toMatchObject({ count: 1, firstAt: T0.toISOString() })
    expect(p1.hold.removed).toEqual([...gone60].sort())

    // Run 2 (+12 h): the same 60, plus 3 new removals and 5 new URLs — count 2, still a 409.
    const fresh5: Record<string, string> = {}
    for (let i = 0; i < 5; i++) fresh5[`/fresh-a${i}`] = '2026-10-01T12:00:00.000Z'
    const c2 = without(site(300, fresh5), [...gone60, ...range(200, 203)])
    const p2 = planRun({ prev, curr: c2, hold: p1.hold, now: at(12) })
    expect(p2.kind).toBe('trip')
    if (p2.kind !== 'trip') return
    expect(p2.hold).toMatchObject({ count: 2, firstAt: T0.toISOString() })
    expect(p2.hold.removed).toEqual(p1.hold.removed) // O is the ORIGINAL set, never replaced by R

    // Run 3 (+24 h): 58 of the original 60 (2 came back), the 3 from run 2, 4 more new removals, and a
    // changed lastmod. Overlap 58/60 = 96.7% ≥ 90%, count 3 at 24 h: an automatic re-baseline.
    const c3 = without(site(300, fresh5), [...range(2, 60), ...range(200, 203), ...range(250, 254)])
    c3.set(listing(100), '2026-10-02T00:00:00.000Z')
    const p3 = planRun({ prev, curr: c3, hold: p2.hold, now: at(24) })
    expect(p3.kind).toBe('auto-rebaseline')
    if (p3.kind !== 'auto-rebaseline') return
    expect(p3.hold.count).toBe(3)
    expect(p3.hold.overlap).toBeCloseTo(58 / 60, 5)
    // Pings added and changed only: ZERO removals on a re-baseline (decision I-f).
    expect(p3.urlList).toEqual([...Object.keys(fresh5).map(U).sort(), listing(100)])
    for (const u of p3.diff.removed) expect(p3.urlList).not.toContain(u)
    assertEligible(p3, prev, c3)

    // Run 4 (+36 h): diffs normally against the new baseline — one removal, one addition.
    const c4 = without(c3, [listing(299)])
    c4.set(U('/fresh-b'), '2026-10-02T12:00:00.000Z')
    const p4 = planRun({ prev: p3.next, curr: c4, hold: null, now: at(36) })
    expect(p4.kind).toBe('send')
    expect(p4.kind === 'send' && p4.urlList).toEqual([U('/fresh-b'), listing(299)])
  })

  it('a run under the thresholds after a trip sends normally (the route then deletes the hold)', () => {
    const prev = snap(site(300))
    const p1 = planRun({ prev, curr: without(site(300), range(0, 60)), hold: null, now: T0 })
    expect(p1.kind).toBe('trip')
    // 55 of them came back: 5 removals, under the guard.
    const p2 = planRun({ prev, curr: without(site(300), range(0, 5)), hold: p1.kind === 'trip' ? p1.hold : null, now: at(12) })
    expect(p2.kind).toBe('send')
    expect(p2.kind === 'send' && p2.urlList).toEqual(range(0, 5))
  })

  /**
   * ⛔ FROZEN PREFIXES: an unknown rent snapshot must cost the rentals URLs' pings and nothing else —
   * never their removal pings, never a trip, never the rest of the site's pings (round-2 review, O7).
   */
  it('frozen rentals URLs are not removed, pinged or counted, keep their old lastmods, and the rest diffs normally', () => {
    const frozen = ['/c/rentals/', '/hcmc-rent-index']
    const districts: Record<string, string> = {}
    for (let i = 0; i < 22; i++) districts[`/c/rentals/d${i}`] = ''
    const base = site(40, districts)
    const prev = snap(base)
    // The builder omitted every frozen URL; elsewhere one listing changed and one was removed.
    const curr = without(base, [...Object.keys(districts).map(U), U('/hcmc-rent-index'), listing(39)])
    curr.set(listing(0), '2026-10-01T00:00:00.000Z')
    const plan = planRun({ prev, curr, frozen, hold: null, now: T0 })
    expect(plan.kind).toBe('send')
    if (plan.kind !== 'send') return
    expect(plan.urlList).toEqual([listing(0), listing(39)])
    expect(plan.diff.frozenKept).toBe(23)
    // 23 missing URLs out of ~65 would be a >30% drop — frozen ones are not counted.
    expect(plan.diff.prevCount).toBe(prev.urls ? Object.keys(prev.urls).length - 23 : 0)
    for (const f of [...Object.keys(districts), '/hcmc-rent-index']) expect(plan.next.urls[U(f)]).toBe(prev.urls[U(f)])
    assertEligible(plan, prev, curr, frozen)
  })

  it('a frozen URL present in the current sitemap is ignored, not diffed', () => {
    const prev = snap(site(10))
    const curr = site(10, { '/hcmc-rent-index': '2026-10-05T00:00:00.000Z' })
    const plan = planRun({ prev, curr, frozen: ['/hcmc-rent-index'], hold: null, now: T0 })
    expect(plan.kind === 'send' && plan.urlList).toEqual([])
    expect(plan.kind === 'send' && plan.next.urls[U('/hcmc-rent-index')]).toBe('2026-09-30T00:00:00.000Z')
  })
})
