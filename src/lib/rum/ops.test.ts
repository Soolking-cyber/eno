import { describe, expect, it } from 'vitest'
import { RUM_EDGES, RUM_MAX_NAVS, bucketOf, memoryTier, routeGroupOf } from './shared'
import { RUM_MAX_OPS, rumOps, type RumOp } from './ops'

const keys = (ops: RumOp[] | null) => (ops ?? []).map((o) => `${o.family} ${o.dims} ${o.bucket} ${o.delta > 0 ? '+' : '-'}`)
const C = 'browser.phone.vi'

describe('bucketOf — the largest edge ≤ the value', () => {
  it('lands on lower edges, at and between them, and clamps to the first and last', () => {
    expect(bucketOf('ttfb', 0)).toBe(0)
    expect(bucketOf('ttfb', 49.9)).toBe(0)
    expect(bucketOf('ttfb', 50)).toBe(50)
    expect(bucketOf('ttfb', 151)).toBe(150)
    expect(bucketOf('ms', 6_812)).toBe(6_000)
    expect(bucketOf('ms', 999_999)).toBe(30_000)
    expect(bucketOf('cls', 120)).toBe(100)
  })
  it('every scale starts at 0 and rises strictly (the report interpolates between neighbours)', () => {
    for (const edges of Object.values(RUM_EDGES)) {
      expect(edges[0]).toBe(0)
      for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1])
    }
  })
})

describe('memoryTier', () => {
  it('folds deviceMemory into 1/2/4/8 and refuses anything that is not a positive number', () => {
    expect([0.25, 0.5, 1, 2, 4, 8, 16].map(memoryTier)).toEqual([1, 1, 1, 2, 4, 8, 8])
    expect([0, -1, NaN, '4', null, undefined].map(memoryTier)).toEqual([null, null, null, null, null, null])
  })
})

describe('routeGroupOf — the kind of page, from the address the visitor sees', () => {
  const at = (path: string, { host = 'eno.vn', teacher = false, base = 'eno.vn' } = {}) => {
    const u = new URL(path, `https://${host}`)
    return routeGroupOf(u.host, u.pathname, u.search, teacher, base)
  }
  it('maps the site\'s page kinds', () => {
    expect(at('/')).toBe('home')
    expect(at('/?q=apartment')).toBe('search')
    expect(at('/?q=%20')).toBe('home')
    expect(at('/c/rentals')).toBe('category')
    expect(at('/c/rentals/district-1?q=studio')).toBe('search')
    expect(at('/listings/cmv8pygzw000074q47t6xzpq2')).toBe('listing')
    expect(at('/listings/cmv52mpiz001w01s3qfma57lo', { teacher: true })).toBe('teacher')
    expect(at('/listings/abc/edit')).toBe('account')
    expect(at('/s/apple')).toBe('store')
    expect(at('/sellers/s1')).toBe('store')
    expect(at('/messages/abc')).toBe('chat')
    expect(at('/dashboard/listings')).toBe('account')
    expect(at('/teachers/join')).toBe('account')
    // ⛔ no visa/itinerary kind (the licensing boundary — shared.ts ships in eno.vn's first JavaScript)
    expect(at('/vietnam-evisa')).toBe('content')
    expect(at('/itinerary')).toBe('other')
    expect(at('/privacy')).toBe('content')
    expect(at('/schools/rmit')).toBe('content')
    expect(at('/moving-to-vietnam')).toBe('content')
    expect(at('/rentals/check')).toBe('other')
  })
  it('hosts: teacher.<base> is a teacher page, any other subdomain but www a storefront — on both editions', () => {
    expect(at('/', { host: 'teacher.eno.vn' })).toBe('teacher')
    expect(at('/', { host: 'apple.eno.vn' })).toBe('store')
    expect(at('/listings/x', { host: 'apple.eno.vn' })).toBe('store')
    expect(at('/', { host: 'www.eno.vn' })).toBe('home')
    expect(at('/c/rentals', { host: 'www.eno.forum', base: 'eno.forum' })).toBe('category')
    expect(at('/', { host: 'apple.eno.forum', base: 'eno.forum' })).toBe('store')
    // A host that only ENDS in the base name is not a subdomain of it.
    expect(at('/', { host: 'evileno.vn' })).toBe('home')
  })
})

describe('rumOps — a beacon becomes bucket ops, and nothing it says is stored as said', () => {
  const hard = {
    v: 1, r: 'listing', c: C,
    m: { ttfb: 412, fcp: 1_712, lcp: 2_104, cls: 0.12, inp: 288, hyd: 6_400 },
    lk: 'img', dm: 4, o: 'HKG', e: 'ORIGIN', a: 87, nc: 'MISS',
  }

  it('a first beacon: one op per metric, the edge and app breakdowns, LCP kind and device tier', () => {
    expect(keys(rumOps(hard))).toEqual([
      `ttfb listing|${C} 400 +`, `fcp listing|${C} 1600 +`,
      `lcp listing|${C} 2000 +`, `cls listing|${C} 100 +`, `inp listing|${C} 250 +`, `hyd listing|${C} 6000 +`,
      'edge HKG|ORIGIN 400 +', 'app listing|MISS 80 +', 'lcpk listing|img 2000 +', 'dev lcp|4 2000 +', 'dev hyd|4 6000 +',
    ])
  })

  it('origin (the Worker\'s wait) counts only when this view waited for the box — never for an edge HIT or a replay', () => {
    expect(keys(rumOps({ ...hard, e: 'MISS', d: 140 }))).toContain('origin MISS 125 +')
    for (const e of ['HIT', 'STALE', 'BROWSER', 'NONE']) {
      const k = keys(rumOps({ ...hard, e, d: 140, a: 90 }))
      expect(k.some((x) => x.startsWith('origin ') || x.startsWith('app ')), e).toBe(false)
    }
    // A replay or no timing has no data centre either.
    expect(keys(rumOps({ ...hard, e: 'BROWSER' }))).toContain('edge none|BROWSER 400 +')
    expect(keys(rumOps({ ...hard, e: 'bogus', o: 'XXX' }))).toContain('edge none|NONE 400 +')
    expect(keys(rumOps({ ...hard, o: 'LAX' }))).toContain('edge other|ORIGIN 400 +')
  })

  it('⛔ labels outside the closed sets are dropped or folded, never stored as sent', () => {
    expect(rumOps({ ...hard, r: 'admin<script>' })).toBeNull()
    expect(rumOps({ ...hard, v: 2 })).toBeNull()
    expect(rumOps([hard])).toBeNull()
    const k = keys(rumOps({ ...hard, c: 'alice@example.com', lk: 'canvas', nc: 'a long; header' }))
    expect(k).toContain('ttfb listing|unknown 400 +')
    expect(k.some((x) => x.startsWith('lcpk'))).toBe(false)
    expect(k).toContain('app listing|none 80 +')
    expect(k.join(' ')).not.toMatch(/alice|canvas|header/)
  })

  it('numbers outside their range are dropped one by one; the rest of the beacon still counts', () => {
    const k = keys(rumOps({ ...hard, m: { ttfb: -1, fcp: Infinity, lcp: 2_104, cls: 99, inp: '288', hyd: 200_000 } }))
    expect(k.filter((x) => /^(ttfb|fcp|cls|inp|hyd) /.test(x))).toEqual([])
    expect(k).toContain(`lcp listing|${C} 2000 +`)
  })

  it('left before its links worked: hydx instead of hyd — and never both', () => {
    const { hyd: _hyd, ...m } = hard.m
    expect(keys(rumOps({ ...hard, m, hx: 3_250 }))).toContain(`hydx listing|${C} 3000 +`)
    expect(keys(rumOps({ ...hard, hx: 3_250 })).some((x) => x.startsWith('hydx'))).toBe(false)
  })

  it('a later beacon MOVES a CLS/INP that grew: −1 from the old bucket, +1 to the new — so a view counts once', () => {
    expect(keys(rumOps({ v: 1, r: 'home', c: C, u: { inp: [120, 320], cls: [0.02, 0.021] } }))).toEqual([
      `inp home|${C} 100 -`, `inp home|${C} 300 +`,
    ])
    // A move straddling Vietnamese midnight lands on its FIRST beacon's day (`ua` = ms since that beacon).
    const at = Date.parse('2026-10-16T17:00:30Z') // 00:00:30 on the 17th in Vietnam
    const late = rumOps({ v: 1, r: 'home', c: C, u: { inp: [120, 320] }, ua: 60_000 }, at)!
    expect(late.map((o) => o.day)).toEqual(['2026-10-16', '2026-10-16'])
    expect(rumOps({ v: 1, r: 'home', c: C, u: { inp: [120, 320] }, ua: 10_000 }, at)!.map((o) => o.day)).toEqual(['2026-10-17', '2026-10-17'])
    // First INP only now (no interaction before the first hide): +1 alone.
    expect(keys(rumOps({ v: 1, r: 'home', c: C, u: { inp: [null, 96] } }))).toEqual([`inp home|${C} 75 +`])
    // A "move" downwards, or with a bad old value, is refused; and moves never ride on a first beacon.
    expect(rumOps({ v: 1, r: 'home', c: C, u: { inp: [320, 120] } })).toEqual([])
    expect(rumOps({ v: 1, r: 'home', c: C, u: { inp: ['x', 120] } })).toEqual([])
    expect(keys(rumOps({ ...hard, u: { inp: [null, 900] } })).filter((x) => x.startsWith('inp'))).toEqual([`inp listing|${C} 250 +`])
  })

  it('soft navigations: each to its own target kind, capped, ranges checked', () => {
    const n = Array.from({ length: 12 }, () => ['listing', 1_310])
    const k = keys(rumOps({ v: 1, r: 'home', c: C, n: [['nope', 5], ['category', 25_000], ...n] }))
    expect(k).toHaveLength(RUM_MAX_NAVS - 2)
    expect(k.every((x) => x === `nav listing|${C} 1200 +`)).toBe(true)
  })

  it('no beacon can produce more than RUM_MAX_OPS ops', () => {
    const many = { ...hard, e: 'MISS', d: 1, n: Array.from({ length: 50 }, () => ['home', 100]) }
    expect(rumOps(many)!.length).toBeLessThanOrEqual(RUM_MAX_OPS)
  })
})
