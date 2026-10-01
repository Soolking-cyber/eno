import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FRESH_DAYS, freshSetProblem, type FreshItem } from '@/lib/apartment-freshness'
import { browseRankScore } from '@/lib/ranking-formula'
import {
  APARTMENT_TYPE, CITIES, COVERAGE_REFUSED_EXIT, DB_MISS_MAX, DB_RECHECK_MAX, FLOOR_CONFIRM, LEAF_MAX, MAX_FRESH_DETAILS, PAGE_SIZE, PRICE_LADDER, SELLER_ID,
  SOURCE_PAGE_CAP, FreshCrawler, IdFloor, Infeasible, buildFreshSet, createOnlyFields, datedEntryProblem, datedRollbackSql, districtSeeds,
  emptyStageNoop, existingRowPlan, freshCoverageEvidence, freshCoverageProblem, freshItemOf, freshSeedUrl, idOrderInversions, isTransient,
  isrTombstoneSql, judgeCreated, leafPageVerdict, leafProblem, listsProblem, mapRecord, modeRefusal, parseRunArgs, parseStage,
  parseZonedInstant, planDbNet, priceRange, restageRecord, retireRollbackSql, seedEchoProblem, seedLabel, sourcePostedAt, splitBand,
  splitProblem, splitSeed, stageAgeRefusal, stageDetail, stageItem,
  type CityKey, type DbNetReport, type FreshCoverage, type FreshSeed, type GetPage, type HeldRow, type MuabanDetail, type MuabanListItem,
} from '../../scripts/muaban-net-map'

/**
 * The 7-day rule for muaban.net (scripts/import-muaban-net.ts --fresh-out): the PURE half — seeding,
 * the coverage proofs, created_at windowing, the id floor, the set, and the apply-side dating. The
 * shapes below are muaban's own, read 2026-10-01 (the measurements are in muaban-net-map.ts).
 */
const DAY = 86_400_000
const SET_AT = Date.parse('2026-10-01T15:00:00Z')
const iso = (t: number) => new Date(t).toISOString()

describe('--fresh-out arguments — ⛔ a set must describe the whole window', () => {
  const p = (...a: string[]) => modeRefusal(parseRunArgs(['node', 'x', ...a]))
  const ok = ['--types', 'apartment', '--stage', '/s.jsonl', '--fresh-out', '/f.json']

  it('parses --fresh-out, and refuses it with no value', () => {
    expect(parseRunArgs(['node', 'x', ...ok]).freshOut).toBe('/f.json')
    expect(parseRunArgs(['node', 'x']).freshOut).toBeNull()
    expect(() => parseRunArgs(['node', 'x', '--fresh-out', '--types', 'apartment'])).toThrow(/--fresh-out needs a value/)
  })

  it('⛔ an unknown flag throws — a typo never runs a crawl that silently writes no set', () => {
    expect(() => parseRunArgs(['node', 'x', '--fresh-ot', '/f.json'])).toThrow(/unknown flag "--fresh-ot"/)
    expect(() => parseRunArgs(['node', 'x', '--max-age-days', '7'])).toThrow(/unknown flag/)
    expect(() => parseRunArgs(['--src', 's.jsonl', '--aply'])).toThrow(/unknown flag "--aply"/)
    // every flag the importer documents still parses
    expect(() => parseRunArgs(['node', 'x', '--city', 'hcm', '--types', 'room', '--cap', 'hcm=5', '--limit', '3', '--stage', 's',
      '--max-pages', '9', '--delay-ms', '2000', '--probe-images', '--cover-by-mark', '--list-only'])).not.toThrow()
    expect(() => parseRunArgs(['node', 'x', '--retire', '--journal', '/j', '--apply', '--force-mass-retire'])).not.toThrow()
    expect(() => parseRunArgs(['node', 'x', '--src', 's', '--journal', '/j', '--apply'])).not.toThrow()
  })

  it('accepts the weekly line: apartments, every city, a live crawl', () => {
    expect(p(...ok)).toBeNull()
    expect(p(...ok, '--city', 'hcm,hn,dn')).toBeNull()
  })

  it('refuses apartments-plus or no --types, one city, a cut-short crawl, list-only, and the write/retire modes', () => {
    expect(p('--stage', '/s', '--fresh-out', '/f')).toMatch(/--types apartment/)                     // the default is four types
    expect(p(...ok.slice(2), '--types', 'apartment,house')).toMatch(/--types apartment/)
    expect(p(...ok, '--city', 'hcm')).toMatch(/hn, dn missing/)
    expect(p(...ok, '--limit', '50')).toMatch(/--limit/)
    expect(p(...ok, '--cap', 'hcm=100')).toMatch(/--cap/)
    expect(p(...ok, '--list-only')).toMatch(/created_at/)
    expect(p('--src', '/s', '--types', 'apartment', '--fresh-out', '/f')).toMatch(/live crawl/)
    expect(p('--retire', '--types', 'apartment', '--fresh-out', '/f')).toMatch(/live crawl/)
  })
})

describe('judgeCreated — created_at against the window, worst case, never trusted blind', () => {
  it('reads muaban\'s microsecond +07:00 timestamp exactly (it is not day-granular)', () => {
    const v = judgeCreated('2026-09-30T16:05:27.337001+07:00', SET_AT, SET_AT)
    expect(v).toEqual({ kind: 'fresh', sourceDate: '2026-09-30T09:05:27.337Z' })
  })

  it('admits the 7th day to the millisecond and refuses one millisecond more', () => {
    expect(judgeCreated(iso(SET_AT - FRESH_DAYS * DAY), SET_AT, SET_AT).kind).toBe('fresh')
    expect(judgeCreated(iso(SET_AT - FRESH_DAYS * DAY - 1), SET_AT, SET_AT)).toEqual({ kind: 'old', clearlyOld: false })
  })

  it('calls an ad CLEARLY old only past the window plus the floor margin (a day)', () => {
    expect(judgeCreated(iso(SET_AT - 7.5 * DAY), SET_AT, SET_AT)).toEqual({ kind: 'old', clearlyOld: false })
    expect(judgeCreated(iso(SET_AT - 8 * DAY - 1), SET_AT, SET_AT)).toEqual({ kind: 'old', clearlyOld: true })
    expect(judgeCreated('2026-08-18T00:49:08.432024+07:00', SET_AT, SET_AT)).toEqual({ kind: 'old', clearlyOld: true })
  })

  it('dates an ad posted mid-crawl at the set\'s moment — older, never newer — so the set still validates', () => {
    const readAt = SET_AT + 40 * 60_000
    expect(judgeCreated(iso(SET_AT + 20 * 60_000), readAt, SET_AT)).toEqual({ kind: 'fresh', sourceDate: iso(SET_AT) })
  })

  it('⛔ unknown — kept, not judged — when unreadable, implausible, or later than the read itself', () => {
    expect(judgeCreated(undefined, SET_AT, SET_AT).kind).toBe('unknown')
    expect(judgeCreated('', SET_AT, SET_AT).kind).toBe('unknown')
    expect(judgeCreated('hôm qua', SET_AT, SET_AT).kind).toBe('unknown')
    expect(judgeCreated('1970-01-01T00:00:00Z', SET_AT, SET_AT).kind).toBe('unknown')
    expect(judgeCreated(iso(SET_AT + 10 * 60_000), SET_AT, SET_AT).kind).toBe('unknown')            // 10 min after the read
    expect(judgeCreated(iso(SET_AT + 4 * 60_000), SET_AT, SET_AT).kind).toBe('fresh')               // within clock skew
  })

  /**
   * ⛔ A created_at WITHOUT AN OFFSET NAMES NO INSTANT: Date.parse reads it in the machine's zone, so the same
   * string is 7 h apart on a UTC box and a Saigon one. The test pins TZ=UTC for its own duration, and every
   * expectation below is built so it holds in ANY zone (a naive read is at most 14 h off, far from the edge).
   */
  it('⛔ no explicit offset (Z or ±hh:mm) → unknown in the set and unreadable for the importer, whatever the machine zone', () => {
    const prev = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      const at = SET_AT - 3 * DAY                                                                    // mid-window: fresh by any reading
      const zulu = iso(at)                                                                           // '2026-09-28T15:00:00.000Z'
      const bare = zulu.slice(0, -1)                                                                 // the same wall clock, no zone
      const saigon = new Date(at + 7 * 3_600_000).toISOString().replace('Z', '+07:00')               // '2026-09-28T22:00:00.000+07:00'
      const ny = new Date(at - 4 * 3_600_000).toISOString().replace('Z', '-04:00')
      // what the old reader did: SOME instant inside the window, chosen by the machine's zone (UTC here)
      expect(Math.abs(Date.parse(bare) - at)).toBeLessThanOrEqual(14 * 3_600_000)
      // an explicit offset is one instant everywhere — and exactly the one Date.parse agrees on
      for (const z of [zulu, saigon, ny, zulu.toLowerCase().replace('t', 'T'), '2026-09-28T22:00:00.000000+07:00', '2026-09-28T22:00+07:00']) {
        expect(parseZonedInstant(z)).toBe(at)
        expect(judgeCreated(z, SET_AT, SET_AT)).toEqual({ kind: 'fresh', sourceDate: zulu })
        expect(sourcePostedAt(z, SET_AT)?.toISOString()).toBe(zulu)
      }
      expect(parseZonedInstant('2026-09-30T16:05:27.337001+07:00')).toBe(Date.parse('2026-09-30T09:05:27.337Z'))   // muaban's own shape
      // no offset, a bare date, a basic-format or impossible offset, an impossible day → not an instant
      for (const z of [bare, bare.slice(0, 19), '2026-09-28T22:00:00.000001', '2026-09-28', '2026-09-28T22:00:00+0700', '2026-09-28T22:00:00+7:00',
        '2026-09-28T22:00:00+24:00', '2026-02-30T10:00:00Z', '2026-09-28T24:00:00Z', ' 2026-09-28T15:00:00Z']) {
        expect(parseZonedInstant(z)).toBeNaN()
        expect(judgeCreated(z, SET_AT, SET_AT)).toMatchObject({ kind: 'unknown', why: expect.stringMatching(/unreadable/) })
        expect(sourcePostedAt(z, SET_AT)).toBeNull()
      }
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  })

  it('⛔ mapRecord: an offset-less created_at drops the row (\'postDate\'), never dates it in the machine zone', () => {
    const CARD = {
      id: 71204990, city_id: 30, subcategory_id: 46, property_type: APARTMENT_TYPE, category_name: 'Chung cư',
      covers: ['https://cloud.muaban.net/images/thumb-md/2026/09/04/557/743223b5aeee4ce3b97ff602f80feac7.jpg'],
      price: 12_000_000, price_display: '12 triệu/tháng', url: '/bat-dong-san/cho-thue-can-ho-quan-3-ho-chi-minh/x-id71204990',
      location: 'Phường 1, Quận 3', locations_display: [{ id: 1, name: 'Phường 1' }, { id: 368, name: 'Quận 3' }, { id: 30, name: 'TP.HCM' }],
    }
    const det = (created_at: string) => stageDetail({ id: CARD.id, url: CARD.url, city_id: 30, subcategory_id: 46, property_type: APARTMENT_TYPE, price: 12_000_000, price_display: '12 triệu/tháng', publish: true, created_at })
    const opts = { cities: ['hcm' as const], types: [APARTMENT_TYPE, 2811], now: SET_AT, windowAt: SET_AT }
    const zoned = iso(SET_AT - 3 * DAY)
    expect(mapRecord(stageItem(CARD), det(zoned), opts).ok).toBe(true)
    expect(mapRecord(stageItem(CARD), det(zoned.slice(0, -1)), opts)).toEqual({ ok: false, reason: 'postDate' })
    // not only apartments: a house is dated by the same reader
    const house = { ...CARD, property_type: 2811 }
    expect(mapRecord(stageItem(house), { ...det(zoned.slice(0, -1)), property_type: 2811 }, opts)).toEqual({ ok: false, reason: 'postDate' })
  })
})

describe('IdFloor — ⛔ calibrated from detail pages, at least a day below the window\'s edge', () => {
  const fresh = { kind: 'fresh', sourceDate: iso(SET_AT) } as const
  const recent = { kind: 'old', clearlyOld: false } as const
  const clear = { kind: 'old', clearlyOld: true } as const
  const unknown = { kind: 'unknown', why: 'HTTP 503' } as const

  it(`forms after ${FLOOR_CONFIRM} consecutive clearly-old cards, at the LOWEST of them`, () => {
    const f = new IdFloor()
    f.observe(71266686, fresh)
    f.observe(71250000, recent)
    f.observe(71240003, clear, '2026-09-22T10:00:00+07:00')
    f.observe(71240002, clear)
    expect(f.floor).toBeNull()
    f.observe(71240001, clear, '2026-09-22T09:59:00+07:00')
    expect(f.floor).toBe(71240001)
    expect(f.floorCreated).toBe('2026-09-22T09:59:00+07:00')
    expect(f.below(71240000)).toBe(true)
    expect(f.below(71240001)).toBe(false)                                                          // the floor card itself was read
    expect(f.below(71260000)).toBe(false)
  })

  it('a fresh or a recently-old card breaks the run; an undetermined one neither counts nor breaks', () => {
    const f = new IdFloor()
    f.observe(10, clear); f.observe(9, clear); f.observe(8, fresh)
    f.observe(7, clear); f.observe(6, recent)
    f.observe(5, clear); f.observe(4, unknown); f.observe(3, clear)
    expect(f.floor).toBeNull()
    f.observe(2, clear)
    expect(f.floor).toBe(2)
  })

  it('never forms on undetermined pages alone, and below() is false until it forms', () => {
    const f = new IdFloor()
    for (let id = 100; id > 0; id--) f.observe(id, unknown)
    expect(f.floor).toBeNull()
    expect(f.below(1)).toBe(false)
  })

  it('⛔ refuses ids out of descending order (the walk would no longer prove anything)', () => {
    const f = new IdFloor()
    f.observe(10, clear)
    expect(() => f.observe(11, clear)).toThrow(/descending/)
  })
})

describe('reading a list to its end — and proving it', () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => 1000 - i)

  it('leafPageVerdict: a full page goes on, a short or empty page is the end, a repeated page is the source cap', () => {
    expect(leafPageVerdict(full, null)).toBe('next')
    expect(leafPageVerdict([5, 4, 3, 2, 1], full)).toBe('end')                                    // Hóc Môn page 3: 5 cards
    expect(leafPageVerdict([], full)).toBe('end')                                                  // …and page 4: none
    expect(leafPageVerdict(full, full)).toBe('repeat')                                             // Bình Thạnh page 52 = page 51
    expect(leafPageVerdict(full, [...full].reverse())).toBe('next')
  })

  it('leafProblem: distinct ids must reach the total reported first AND last', () => {
    expect(leafProblem(119, 119, 119)).toBeNull()                                                  // Quận 4, both orders
    expect(leafProblem(45, 45, 45)).toBeNull()
    expect(leafProblem(118, 119, 119)).toMatch(/118 distinct cards read, the list reported 119/)  // a card shifted behind the reader
    expect(leafProblem(119, 119, 120)).toMatch(/119 then 120/)                                     // one arrived where we had already read
    expect(leafProblem(119, 120, 119)).toMatch(/120 then 119/)                                     // one deleted ahead of us: refused, re-read
  })

  it('the leaf ceiling leaves headroom under the source cap', () => {
    expect(SOURCE_PAGE_CAP * PAGE_SIZE).toBe(1020)
    expect(LEAF_MAX).toBeLessThan(SOURCE_PAGE_CAP * PAGE_SIZE)
  })
})

describe('splitting a list over the cap — ⛔ the parts must add up to the whole', () => {
  it('splitProblem with the measured splits (2026-10-01)', () => {
    expect(splitProblem(652 + 386, 1038, 1038)).toBeNull()                                         // Bình Thạnh by price
    expect(splitProblem(757 + 478, 1235, 1235)).toBeNull()                                         // Tân Bình by price
    expect(splitProblem(8907, 8906, 8907)).toBeNull()                                              // HCMC by its 23 districts, one arrival
    expect(splitProblem(1037, 1038, 1038)).toMatch(/1 card\(s\) in no part/)                      // a card with no district / no band
    expect(splitProblem(1037, 1038, 1037)).toBeNull()                                              // one deleted in between is not a hole
  })

  it('price bands: the root splits exactly where the measured URLs did, contiguous and disjoint all the way down', () => {
    const [a, b] = splitBand(null)!
    expect(priceRange(a)).toEqual([0, 8_000_000])
    expect(priceRange(b)).toEqual([8_000_001, 1_000_000_000_000])
    // every band, recursively: halves are contiguous, disjoint, and cover their parent
    const walk = (band: [number, number]) => {
      const halves = splitBand(band)
      if (!halves) { expect(band[1] - band[0]).toBe(1); return }
      const [lo, hi] = priceRange(band)
      const [x, y] = halves.map(priceRange)
      expect(x[0]).toBe(lo); expect(y[1]).toBe(hi); expect(y[0]).toBe(x[1] + 1)
      halves.forEach(walk)
    }
    walk([0, PRICE_LADDER.length - 1])
    expect(splitBand([5, 6])).toBeNull()
  })

  const QUICKLINK = { district: { title: 'Quận/Huyện', items: [
    { id: 363, name: 'Quận 1', url: '/bat-dong-san/cho-thue-can-ho-quan-1-ho-chi-minh', total: 398 },
    { id: 376, name: 'Quận Bình Thạnh', url: '/bat-dong-san/cho-thue-can-ho-quan-binh-thanh-ho-chi-minh', total: 1400 },
    { id: 381, name: 'TP. Thủ Đức - Quận Thủ Đức', url: '/bat-dong-san/cho-thue-can-ho-quan-thu-duc-ho-chi-minh', total: 222 },
  ] } }

  it('districtSeeds: the city page\'s own district lists, pinned to this city\'s apartment paths', () => {
    expect(districtSeeds({ quicklink: QUICKLINK }, 'hcm')).toEqual([
      { city: 'hcm', district: { id: 363, path: '/bat-dong-san/cho-thue-can-ho-quan-1-ho-chi-minh' }, band: null },
      { city: 'hcm', district: { id: 376, path: '/bat-dong-san/cho-thue-can-ho-quan-binh-thanh-ho-chi-minh' }, band: null },
      { city: 'hcm', district: { id: 381, path: '/bat-dong-san/cho-thue-can-ho-quan-thu-duc-ho-chi-minh' }, band: null },
    ])
    expect(districtSeeds({ quicklink: QUICKLINK }, 'hn')).toBeNull()                               // another city's paths
    const bad = (url: string) => districtSeeds({ quicklink: { district: { items: [...QUICKLINK.district.items, { id: 9, url }] } } }, 'hcm')
    expect(bad('/bat-dong-san/cho-thue-nha-quan-1-ho-chi-minh')).toBeNull()                         // houses, not apartments
    expect(bad('https://evil.example/bat-dong-san/cho-thue-can-ho-x-ho-chi-minh')).toBeNull()
    expect(bad('/bat-dong-san/cho-thue-can-ho-quan-1-ho-chi-minh?price=1-2')).toBeNull()
    expect(districtSeeds({}, 'hcm')).toBeNull()
    expect(districtSeeds({ quicklink: { district: { items: [] } } }, 'hcm')).toBeNull()
  })

  it('splitSeed: a city by its districts (else by price), a district by price, down to one ladder step', () => {
    const city: FreshSeed = { city: 'hcm', district: null, band: null }
    expect(splitSeed(city, { quicklink: QUICKLINK })!.map((s) => s.district!.id)).toEqual([363, 376, 381])
    expect(splitSeed(city, {})!.map((s) => s.band)).toEqual([[0, 8], [8, 17]])
    const bt: FreshSeed = { city: 'hcm', district: { id: 376, path: '/bat-dong-san/cho-thue-can-ho-quan-binh-thanh-ho-chi-minh' }, band: null }
    expect(splitSeed(bt, { quicklink: QUICKLINK })!.map((s) => [s.district!.id, s.band])).toEqual([[376, [0, 8]], [376, [8, 17]]])
    expect(splitSeed({ ...bt, band: [7, 8] }, {})).toBeNull()
  })

  it('freshSeedUrl: price order, the band, the page — muaban\'s own query shape', () => {
    expect(freshSeedUrl({ city: 'hn', district: null, band: null }, 1)).toBe('https://muaban.net/bat-dong-san/cho-thue-can-ho-ha-noi?sort=2')
    const bt: FreshSeed = { city: 'hcm', district: { id: 376, path: '/bat-dong-san/cho-thue-can-ho-quan-binh-thanh-ho-chi-minh' }, band: [8, 17] }
    expect(freshSeedUrl(bt, 3)).toBe('https://muaban.net/bat-dong-san/cho-thue-can-ho-quan-binh-thanh-ho-chi-minh?sort=2&price=8000001-1000000000000&page=3')
    expect(seedLabel(bt)).toBe('hcm district 376 price 8000001-1000000000000')
  })
})

describe('seedEchoProblem — ⛔ the page must be the list we asked for', () => {
  /** Tân Bình, price-ordered, 0–8M: the filterResult.filters muaban returned (2026-10-01). */
  const ECHO = {
    subcategory_id: { id: 46, value: 'Cho thuê' }, category_id: { id: 33, value: 'Bất động sản' }, city_id: { id: 30, value: 'TP.HCM' },
    district_id: { id: 379, value: 'Quận Tân Bình' }, property_type: { id: 2812, value: 'Căn hộ' }, property_types: { value: 'Căn hộ', ids: '2812' },
    sort: { id: 2, value: 'Giá tăng dần' }, price: { value: 'Đến 8 triệu', min: 0, max: 8000000 },
  }
  const seed: FreshSeed = { city: 'hcm', district: { id: 379, path: '/bat-dong-san/cho-thue-can-ho-quan-tan-binh-ho-chi-minh' }, band: [0, 8] }
  const pp = (f: Record<string, unknown>) => ({ filterResult: { filters: f } })

  it('accepts the real echo', () => {
    expect(seedEchoProblem(pp(ECHO), seed)).toBeNull()
    const { district_id: _d, price: _p, ...cityOnly } = ECHO
    expect(seedEchoProblem(pp(cityOnly), { city: 'hcm', district: null, band: null })).toBeNull()
  })

  it('refuses another sort, district, city, type, band, or a filter we did not ask for', () => {
    expect(seedEchoProblem(pp({ ...ECHO, sort: { id: 1 } }), seed)).toMatch(/sort/)
    expect(seedEchoProblem(pp({ ...ECHO, district_id: { id: 376 } }), seed)).toMatch(/district/)
    const { district_id: _d, ...noDistrict } = ECHO
    expect(seedEchoProblem(pp(noDistrict), seed)).toMatch(/district/)                              // redirected to the city list
    expect(seedEchoProblem(pp({ ...ECHO, city_id: { id: 24 } }), seed)).toMatch(/city/)
    expect(seedEchoProblem(pp({ ...ECHO, property_type: { id: 2811 } }), seed)).toMatch(/property_type/)
    expect(seedEchoProblem(pp({ ...ECHO, price: { min: 0, max: 9000000 } }), seed)).toMatch(/price/)
    expect(seedEchoProblem(pp(ECHO), { ...seed, band: null })).toMatch(/price filter we did not ask for/)
    expect(seedEchoProblem(pp({ ...ECHO, subcategory_id: { id: 169 } }), seed)).toMatch(/rentals/)
    expect(seedEchoProblem({}, seed)).toMatch(/no filters/)
  })
})

describe('coverage — ⛔ when the set may be written, and the evidence it carries', () => {
  const ok = (city: 'hcm' | 'hn' | 'dn', label: string, total: number, pages: number, split = false) => ({ city, label, ok: true, total, pages, split })
  const net = (over: Partial<DbNetReport> = {}): DbNetReport => ({
    aboveFloor: 400, unlisted: 6, recentBelow: 3, toRead: 9, read: 9, missed: 2, gone: 3, inactive: 1, unknown: 0, floorBreaks: 1, ...over,
  })
  const cov = (over: Partial<FreshCoverage> = {}): FreshCoverage => ({
    seeds: [
      ok('hcm', 'hcm', 8906, 2, true), ok('hcm', 'hcm district 363', 448, 23), ok('hcm', 'hcm district 376', 1038, 2, true),
      ok('hcm', 'hcm district 376 price 0-8000000', 652, 33), ok('hcm', 'hcm district 376 price 8000001-1000000000000', 386, 20),
      ok('hn', 'hn', 636, 32), ok('dn', 'dn', 937, 47),
    ],
    stopped: null, floor: 71240001, floorCreated: '2026-09-22T09:59:00+07:00', detailCapHit: false, cards: 10479, belowFloor: 9700,
    details: { read: 779, fresh: 640, old: 120, gone: 9, unknown: 10 }, inversions: 0, retries: 1, db: net(),
    ...over,
  })

  it('a whole crawl passes', () => {
    expect(freshCoverageProblem(cov())).toBeNull()
    expect(listsProblem(cov())).toBeNull()
  })

  it('refuses a stopped crawl, a missing city, a list not read whole, and the detail cap — before the db net', () => {
    expect(freshCoverageProblem(cov({ stopped: 'bot challenge at …' }))).toMatch(/stopped: bot challenge/)
    expect(freshCoverageProblem(cov({ seeds: cov().seeds.filter((s) => s.city !== 'dn') }))).toMatch(/no list of dn/)
    const seeds = cov().seeds.map((s) => (s.label === 'hcm district 363' ? { ...s, ok: false, why: '447 distinct cards read, the list reported 448' } : s))
    expect(freshCoverageProblem(cov({ seeds }))).toMatch(/hcm district 363: 447 distinct/)
    expect(freshCoverageProblem(cov({ detailCapHit: true }))).toMatch(new RegExp(`over ${MAX_FRESH_DETAILS} detail pages`))
    expect(listsProblem(cov({ detailCapHit: true, db: null }))).toMatch(/id floor never formed/)
  })

  it('⛔ refuses when the db net did not run, needed more reads than its budget, or found real holes in the lists', () => {
    expect(freshCoverageProblem(cov({ db: null }))).toMatch(/db net did not run/)
    expect(freshCoverageProblem(cov({ db: net({ toRead: DB_RECHECK_MAX + 1, unlisted: 1000, recentBelow: 501, read: 0 }) }))).toMatch(/1501 held rows need their own page read \(1000 above the id floor on no list page, 501 below it dated within the window\) — over 1500; nothing was read/)
    expect(freshCoverageProblem(cov({ db: net({ toRead: DB_RECHECK_MAX }) }))).toBeNull()
    expect(freshCoverageProblem(cov({ db: net({ missed: DB_MISS_MAX }) }))).toBeNull()
    expect(freshCoverageProblem(cov({ db: net({ missed: DB_MISS_MAX + 1 }) }))).toMatch(/21 of 400 live rows above the id floor are live at the source yet on no list page/)
    expect(freshCoverageProblem(cov({ db: net({ missed: 40, aboveFloor: 1000 }) }))).toBeNull()       // 4% of a large source
    // deleted ads are churn, not holes: any number of them passes
    expect(freshCoverageProblem(cov({ db: net({ unlisted: 300, toRead: 303, read: 303, gone: 299, missed: 1 }) }))).toBeNull()
  })

  it('the evidence names pages, the leaf ceiling, the splits, the floor, its inversions and the db net — concretely', () => {
    const e = freshCoverageEvidence(cov())
    expect(e).toContain('hcm 8906 cards: 3 list(s) read to their last page (76 pages')
    expect(e).toContain(`each ≤ ${LEAF_MAX} cards`)
    expect(e).toContain('distinct kept ids ≥ reported total')
    expect(e).toContain('2 split(s) whose parts summed to the whole')
    expect(e).toContain('hn 636 cards: 1 list(s) read to their last page (32 pages')
    expect(e).toContain('(1 page(s) re-read after a timeout/5xx)')
    expect(e).toContain('with id ≥ 71240001')
    expect(e).toContain('640 created within 7 days, 120 older, 9 gone, 10 undetermined; 0 id/created_at inversion(s) over 1 day(s)')
    expect(e).toContain('9700 cards below the floor')
    expect(e).toContain('floor card created 2026-09-22T09:59:00+07:00')
    expect(e).toContain('db net: 6 of 400 live rows above the floor were on no list page and 3 live rows below it carry a postedAt inside the window — all 9 read on their own page: 2 live there (list holes), 1 expired there, 3 gone, 0 undetermined; 1 below the floor were in fact fresh (kept)')
  })
})

describe('buildFreshSet — built and checked by the expiry\'s own validator', () => {
  const now = SET_AT + 40 * 60_000
  const items: FreshItem[] = [freshItemOf(71266686, iso(SET_AT - DAY)), freshItemOf(71262471, iso(SET_AT - 6 * DAY))]

  it('a valid set: this seller, created dates, the muaban: id space', () => {
    const r = buildFreshSet(new Date(SET_AT), 'evidence', items, [71200000], now)
    expect(r.problem).toBeNull()
    expect(r.set!.sellerId).toBe(SELLER_ID)
    expect(r.set!.fetchedAt).toBe(iso(SET_AT))
    expect(r.set!.items[0]).toEqual({ externalId: 'muaban:71266686', sourceDate: iso(SET_AT - DAY), dateKind: 'created' })
    expect(r.set!.unknown).toEqual(['muaban:71200000'])
    expect(freshSetProblem(JSON.parse(JSON.stringify(r.set)), now, SELLER_ID)).toBeNull()
  })

  it('an id judged fresh is never also undetermined, and undetermined ids are listed once', () => {
    const r = buildFreshSet(new Date(SET_AT), 'evidence', items, [71266686, 71255555, 71255555], now)
    expect(r.set!.unknown).toEqual(['muaban:71255555'])
  })

  it('⛔ refuses to produce a set the expiry would refuse', () => {
    expect(buildFreshSet(new Date(SET_AT), 'evidence', [freshItemOf(71100000, iso(SET_AT - 8 * DAY))], [], now).problem).toMatch(/outside the 7-day window/)
    expect(buildFreshSet(new Date(SET_AT), 'evidence', [freshItemOf(12, iso(SET_AT))], [], now).problem).toMatch(/shape/)
    expect(buildFreshSet(new Date(SET_AT), ' ', items, [], now).problem).toMatch(/coverage/)
    expect(buildFreshSet(new Date(SET_AT - 25 * 3_600_000), 'e', [], [], now).problem).toMatch(/over 24 h old/)
    const many = Array.from({ length: 10 }, (_, i) => 71200100 + i)
    expect(buildFreshSet(new Date(SET_AT), 'e', items, many, now).problem).toMatch(/undetermined/)
  })
})

describe('the 7-day rule in mapRecord — ⛔ created_at, judged by judgeCreated at the SET\'s moment', () => {
  const CARD = {
    id: 71204990, city_id: 30, subcategory_id: 46, property_type: APARTMENT_TYPE, property_subtype: 2529, category_name: 'Chung cư',
    covers: ['https://cloud.muaban.net/images/thumb-md/2026/09/04/557/743223b5aeee4ce3b97ff602f80feac7.jpg'],
    price: 12_000_000, price_display: '12 triệu/tháng',
    url: '/bat-dong-san/cho-thue-can-ho-chung-cu-quan-tay-ho-ha-noi/cho-thue-can-ho-id71204990',
    publish_at: '2026-10-01T00:00:14.097+07:00', location: 'Phường 1, Quận 3',
    locations_display: [{ id: 1, name: 'Phường 1' }, { id: 368, name: 'Quận 3' }, { id: 30, name: 'TP.HCM' }],
  }
  const card = (over: Partial<MuabanListItem> = {}): MuabanListItem => ({ ...stageItem(CARD), ...over })
  const detail = (created_at: string, over: Partial<MuabanDetail> = {}): MuabanDetail => ({
    ...stageDetail({ id: CARD.id, url: CARD.url, city_id: 30, subcategory_id: 46, property_type: APARTMENT_TYPE, price: 12_000_000, price_display: '12 triệu/tháng', publish: true, created_at }),
    ...over,
  })
  const opts = { cities: ['hcm' as const], types: [APARTMENT_TYPE], now: SET_AT + DAY }

  it('maps an apartment created inside the window at fetch time, dated by created_at (not publish_at)', () => {
    const m = mapRecord(card(), detail(iso(SET_AT - 3 * DAY)), { ...opts, windowAt: SET_AT })
    expect(m.ok && m.row.postedAt.toISOString()).toBe(iso(SET_AT - 3 * DAY))
    expect(m.ok && m.row.mutable.subcategorySlug).toBe('apartment-rental')
  })

  it('drops an apartment first posted before the window as \'window\' — even though publish_at says today', () => {
    // id 71204990 as measured: created 2026-09-04, re-published 2026-10-01 00:00
    expect(mapRecord(card(), detail('2026-09-04T14:02:45.703016+07:00'), { ...opts, windowAt: SET_AT })).toEqual({ ok: false, reason: 'window' })
  })

  it('judges at windowAt (the set\'s moment), not at the time of the --apply', () => {
    const created = iso(SET_AT - 6.5 * DAY)
    expect(mapRecord(card(), detail(created), { ...opts, windowAt: SET_AT }).ok).toBe(true)
    expect(mapRecord(card(), detail(created), { ...opts, windowAt: SET_AT + DAY })).toEqual({ ok: false, reason: 'window' })
    expect(mapRecord(card(), detail(created), { ...opts, windowAt: NaN })).toEqual({ ok: false, reason: 'window' })  // unreadable moment: fail closed
  })

  it('⛔ agrees with the set at the window\'s edge: judged at setAt even when the page was read 40 minutes later', () => {
    const readAt = SET_AT + 40 * 60_000
    const edge = iso(SET_AT - FRESH_DAYS * DAY + 10 * 60_000)                                     // fresh at setAt, old at readAt
    expect(judgeCreated(edge, readAt, SET_AT).kind).toBe('fresh')                                    // the set holds it…
    expect(mapRecord(card(), detail(edge), { ...opts, windowAt: SET_AT, readAt }).ok).toBe(true)     // …so the apply imports it
    expect(mapRecord(card(), detail(edge), { ...opts, windowAt: readAt, readAt })).toEqual({ ok: false, reason: 'window' }) // the old, per-record moment
  })

  it('⛔ an ad posted after the crawl started is in the set (dated setAt) AND imported (dated its own created_at)', () => {
    const readAt = SET_AT + 40 * 60_000
    const created = iso(SET_AT + 20 * 60_000)
    expect(judgeCreated(created, readAt, SET_AT)).toEqual({ kind: 'fresh', sourceDate: iso(SET_AT) })
    const m = mapRecord(card(), detail(created), { ...opts, windowAt: SET_AT, readAt })
    expect(m.ok && m.row.postedAt.toISOString()).toBe(created)
    // later than the read itself (beyond skew): undetermined in the set, not imported
    expect(mapRecord(card(), detail(iso(readAt + 10 * 60_000)), { ...opts, windowAt: SET_AT, readAt })).toEqual({ ok: false, reason: 'window' })
  })

  it('applies to apartments only: an old house still maps', () => {
    const house = mapRecord(card({ property_type: 2811 }), detail('2026-06-02T15:35:52+07:00', { property_type: 2811 }), { ...opts, types: [2811], windowAt: SET_AT })
    expect(house.ok).toBe(true)
  })
})

describe('existingRowPlan — revival and re-dating at --apply', () => {
  const apt = (postedAt: number) => ({ postedAt: new Date(postedAt), mutable: { subcategorySlug: 'apartment-rental' } as never })
  const at = (status: string, postedAt: number) => ({ status, postedAt: new Date(postedAt) })

  it('⛔ revives only from expired/stale — never hidden, removed, sold — and re-dates on revival', () => {
    expect(existingRowPlan(apt(SET_AT - DAY), at('expired', SET_AT - 9 * DAY))).toEqual({ revive: true, redate: true })
    expect(existingRowPlan(apt(SET_AT - DAY), at('stale', SET_AT))).toEqual({ revive: true, redate: true })     // even to an older date
    for (const s of ['hidden', 'removed', 'sold', 'active']) expect(existingRowPlan(apt(SET_AT - 2 * DAY), at(s, SET_AT)).revive).toBe(false)
  })

  it('re-dates a live row only when the source date is NEWER (a re-post)', () => {
    expect(existingRowPlan(apt(SET_AT), at('active', SET_AT - DAY))).toEqual({ revive: false, redate: true })
    expect(existingRowPlan(apt(SET_AT - DAY), at('active', SET_AT - DAY))).toEqual({ revive: false, redate: false })
    // the legacy rows: postedAt was publish_at, which is never older than created_at — not moved back
    expect(existingRowPlan(apt(SET_AT - 5 * DAY), at('active', SET_AT - DAY))).toEqual({ revive: false, redate: false })
  })

  it('never revives a non-apartment row (the rule never expired one)', () => {
    const house = { postedAt: new Date(SET_AT), mutable: { subcategorySlug: 'house-rental' } as never }
    expect(existingRowPlan(house, at('expired', SET_AT - 9 * DAY)).revive).toBe(false)
  })

  it('the re-dated rank is the create formula from the source date, never now', () => {
    const postedAt = new Date(SET_AT - 3 * DAY)
    const f = createOnlyFields({ postedAt }, 100, SET_AT)
    expect(f.rankScore).toBe(browseRankScore({ sellerTrustScore: 100, postedAt, featured: false }, SET_AT))
    expect(f.rankScore).toBeLessThan(browseRankScore({ sellerTrustScore: 100, postedAt: new Date(SET_AT), featured: false }, SET_AT))
  })
})

describe('the stage carries the set\'s moment — ⛔ pinned on the way back in', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    v: 1, fetchedAt: iso(SET_AT + 30 * 60_000), setAt: iso(SET_AT), seed: { city: 'hcm', type: APARTMENT_TYPE },
    item: { id: 71204990, url: '/bat-dong-san/cho-thue-can-ho-quan-1-ho-chi-minh/x-id71204990', city_id: 30, subcategory_id: 46, property_type: APARTMENT_TYPE, price: 1 },
    detail: null, detailStatus: null, ...over,
  })

  it('keeps a valid setAt (normalised), and adds no key when a record has none', () => {
    expect(restageRecord(rec(), 1).setAt).toBe(iso(SET_AT))
    expect(restageRecord(rec({ setAt: '2026-10-01T22:00:00+07:00' }), 1).setAt).toBe(iso(SET_AT))
    const { setAt: _s, ...plain } = rec()
    expect(Object.keys(restageRecord(plain, 1))).not.toContain('setAt')
  })

  it('⛔ refuses a setAt that is not an instant, is after the read, or is over a day before it', () => {
    expect(() => restageRecord(rec({ setAt: 'yesterday' }), 4)).toThrow(/line 4: setAt/)
    expect(() => restageRecord(rec({ setAt: 12 }), 4)).toThrow(/setAt/)
    expect(() => restageRecord(rec({ setAt: iso(SET_AT + 40 * 60_000) }), 4)).toThrow(/setAt/)       // 10 min after its own read
    expect(() => restageRecord(rec({ setAt: iso(SET_AT - 2 * DAY) }), 4)).toThrow(/setAt/)           // a window moved two days back
    expect(() => restageRecord(rec({ fetchedAt: 'x' }), 4)).toThrow(/setAt/)
  })

  it('⛔ one stage is one crawl: mixed setAt values (or with and without) are refused', () => {
    const line = (o: Record<string, unknown> = {}) => JSON.stringify(rec(o))
    expect(parseStage([line(), line()].join('\n'))).toHaveLength(2)
    expect(() => parseStage([line(), line({ setAt: iso(SET_AT - 60_000) })].join('\n'))).toThrow(/mixes crawls/)
    const { setAt: _s, ...plain } = rec()
    expect(() => parseStage([line(), JSON.stringify(plain)].join('\n'))).toThrow(/mixes crawls/)
  })
})

describe('rollback lines — ⛔ guarded on the state the write created, each with its own ISR tombstones', () => {
  const TOMB = (id: string) => `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY['eno:isrtag:_N_T_/en/listings/${id}','eno:isrtag:_N_T_/vi/listings/${id}']) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
  const entry = { kind: 'revive' as const, id: 'cmabc123', externalId: 'muaban:71266686', oldStatus: 'expired', oldPostedAt: iso(SET_AT - 9 * DAY), oldRankScore: 0.41, newPostedAt: iso(SET_AT - DAY), newRankScore: 0.55 }

  it('isrTombstoneSql: both languages per id, the same upsert as the expiry\'s rollback; quotes doubled', () => {
    expect(isrTombstoneSql(['cmabc123'])).toBe(TOMB('cmabc123'))
    expect(isrTombstoneSql(["o'x"])).toContain("'eno:isrtag:_N_T_/en/listings/o''x'")
  })

  /** What updateManyAndReturn({ select: { id, updatedAt } }) returned for the write — the line's last guard. */
  const STAMP = new Date('2026-10-02T03:04:05.678Z')
  const AT = `AND "updatedAt" <= '2026-10-02T03:04:05.678Z'`

  it('a revival: status, postedAt and rankScore back — only while still active, still dated by this run, and untouched since', () => {
    expect(datedRollbackSql(entry, STAMP)).toBe(
      `UPDATE "Listing" SET status = 'expired', "postedAt" = '${iso(SET_AT - 9 * DAY)}', "rankScore" = 0.41 WHERE id = 'cmabc123' AND "sellerId" = '${SELLER_ID}' AND status = 'active' AND "postedAt" = '${iso(SET_AT - DAY)}' ${AT};\n${TOMB('cmabc123')}\n`)
  })

  it('a re-date: postedAt and rankScore back, guarded on the unchanged status and the write\'s updatedAt — never sets a status', () => {
    const sql = datedRollbackSql({ ...entry, kind: 'redate', oldStatus: 'active' }, STAMP)
    expect(sql).toMatch(/^UPDATE "Listing" SET "postedAt" = '[^']+', "rankScore" = 0\.41 WHERE id = 'cmabc123' AND "sellerId" = '[^']+' AND status = 'active' AND "postedAt" = /)
    expect(sql).toContain(`"postedAt" = '${iso(SET_AT - DAY)}' ${AT};\n`)
    expect(sql).toContain(TOMB('cmabc123'))
    expect(datedRollbackSql({ ...entry, kind: 'redate', oldStatus: 'hidden' }, STAMP)).toContain(`AND status = 'hidden' AND "postedAt"`)
    // the stamp may come back as a string: one instant, normalised to UTC to the millisecond
    expect(datedRollbackSql(entry, '2026-10-02T10:04:05.678+07:00')).toContain(AT)
  })

  it('⛔ refuses values that could not have come from the database — before the write (datedEntryProblem) and at it', () => {
    expect(datedEntryProblem(entry)).toBeNull()
    expect(datedEntryProblem({ ...entry, id: "x'; DROP TABLE" })).toMatch(/id/)
    expect(() => datedRollbackSql({ ...entry, id: "x'; DROP TABLE" }, STAMP)).toThrow(/id/)
    expect(() => datedRollbackSql({ ...entry, oldStatus: 'hidden' }, STAMP)).toThrow(/status/)                  // a revival only ever came from expired/stale
    expect(() => datedRollbackSql({ ...entry, kind: 'redate', oldStatus: 'removed' }, STAMP)).toThrow(/status/)
    expect(() => datedRollbackSql({ ...entry, oldPostedAt: 'soon' }, STAMP)).toThrow(/date/)
    expect(datedEntryProblem({ ...entry, newPostedAt: 'soon' })).toMatch(/date/)
    expect(() => datedRollbackSql({ ...entry, oldRankScore: NaN }, STAMP)).toThrow(/rankScore/)
    // ⛔ no stamp, no line — an unguarded line could undo a later change
    expect(() => datedRollbackSql(entry, new Date(NaN))).toThrow(/updatedAt/)
    expect(() => datedRollbackSql(entry, '2026-10-02T03:04:05.678')).toThrow(/updatedAt/)                    // no offset: not an instant
  })

  it('the retire rollback re-activates only rows still hidden AND untouched since the hide, and tombstones them', () => {
    expect(retireRollbackSql([{ id: 'cm1', updatedAt: STAMP }])).toBe(
      `UPDATE "Listing" SET status = 'active' WHERE "sellerId" = '${SELLER_ID}' AND status = 'hidden' AND id = 'cm1' ${AT};\n${TOMB('cm1')}\n`)
    expect(retireRollbackSql([{ id: "x'; DROP TABLE", updatedAt: STAMP }])).toBeNull()
    expect(retireRollbackSql([{ id: 'cm1', updatedAt: 'later' }])).toBeNull()
  })
})

/**
 * ⛔ THE IMPORTER'S WIRING of the items above, pinned on its source (the script runs its main on import, against
 * the network and the database, so it is read here, never run): the coverage refusal exits 3 and keeps the stage,
 * an empty stage applies as a no-op, and every write a rollback line undoes returns the updatedAt it stamped.
 */
describe('scripts/import-muaban-net.ts — exit codes and rollback guards, as wired', () => {
  const SRC = readFileSync(join(process.cwd(), 'scripts/import-muaban-net.ts'), 'utf8')
  /** Comments out — only those that open a line, so a `'image/*'` string never starts one. */
  const code = SRC.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '')

  it('⛔ a coverage refusal does NOT throw: it reports, sets exit code 3, and the stage was already finished', () => {
    expect(COVERAGE_REFUSED_EXIT).toBe(3)
    expect(code).not.toMatch(/throw new Error\(`--fresh-out NOT written/)
    expect(code).toMatch(/if \(freshRefusal\) \{[\s\S]*?process\.exitCode = COVERAGE_REFUSED_EXIT[\s\S]*?\}\s*return/)
    // the stage is renamed into place right after the set is settled — before anything that could still fail the run
    const settled = code.indexOf('const freshRefusal = freshInfo ? await settleFreshSet(db, freshInfo) : null')
    expect(settled).toBeGreaterThan(-1)
    expect(code.indexOf('stage?.finish()')).toBeGreaterThan(settled)
    expect(code.indexOf('stage?.finish()')).toBeLessThan(code.indexOf('new ImportScreen('))
    // nothing turns the refusal into a crash
    expect(code).not.toMatch(/throw[^\n]*freshRefusal/)
  })

  it('⛔ --apply of an empty stage returns before the age check and before the database is opened (exit 0)', () => {
    const noop = code.indexOf('const noop = APPLY ? emptyStageNoop(records, SRC) : null')
    expect(noop).toBeGreaterThan(-1)
    expect(code.slice(noop, noop + 200)).toMatch(/if \(noop\) \{ console\.log\(noop\); return \}/)
    expect(noop).toBeLessThan(code.indexOf('stageAgeRefusal(records)'))
    expect(noop).toBeLessThan(code.indexOf('const db = openDb()', code.indexOf('async function main()')))   // main's connection, not retire()'s
    expect(emptyStageNoop(parseStage(''), '/s.jsonl')).toMatch(/holds no records — nothing to apply/)
    expect(emptyStageNoop(parseStage('\n \n'), '/s.jsonl')).not.toBeNull()
    expect(stageAgeRefusal(parseStage(''))).toMatch(/unknown age/)                                   // what an empty stage used to die on
    const one = JSON.stringify({ v: 1, fetchedAt: iso(Date.now()), seed: { city: 'hcm', type: APARTMENT_TYPE }, item: { id: 71204990, url: '/x-id71204990', city_id: 30, subcategory_id: 46, property_type: APARTMENT_TYPE, price: 1 }, detail: null, detailStatus: null })
    expect(emptyStageNoop(parseStage(one), '/s.jsonl')).toBeNull()
  })

  it('⛔ the retire hide and every dated write return { id, updatedAt } and build their rollback line from it', () => {
    expect(code).not.toMatch(/\.listing\.updateMany\(/)                                                 // no write a rollback line undoes is blind
    const writes = [...code.matchAll(/\.listing\.updateManyAndReturn\(\{([\s\S]*?)\}\)\n/g)].map((m) => m[1])
    expect(writes).toHaveLength(3)                                                                   // the retire hide, the revival, the update/re-date
    for (const w of writes) expect(w).toContain('select: { id: true, updatedAt: true }')
    expect(code).toContain('retireRollbackSql(moved)')
    expect(code).toContain('datedRollbackSql(entry!, moved[0].updatedAt)')
    expect(code).toContain('datedRollbackSql(entry, moved[0].updatedAt)')
    // validated BEFORE the planned change is journaled and the row written
    const check = code.indexOf('datedEntryProblem(entry)')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(code.indexOf('recordDurably(DATED, '))
  })
})

describe('idOrderInversions — per-run evidence on the order the id floor rests on', () => {
  const H = 3_600_000
  it('none while created_at rises with the id; small (< a day) jitter is not an inversion', () => {
    expect(idOrderInversions([[1, 0], [2, 10 * H], [3, 20 * H]])).toBe(0)
    expect(idOrderInversions([[1, 10 * H], [2, 0], [3, 20 * H]])).toBe(0)
    expect(idOrderInversions([])).toBe(0)
  })
  it('counts each read card created over a day EARLIER than some lower id — a cloned or migrated ad', () => {
    expect(idOrderInversions([[1, 30 * DAY], [2, 31 * DAY], [3, 2 * DAY], [4, 32 * DAY]])).toBe(1)
    expect(idOrderInversions([[4, 2 * DAY], [1, 30 * DAY], [3, DAY], [2, 31 * DAY]])).toBe(2)          // order of input irrelevant
  })
})

// ─── FreshCrawler against a fake muaban ────────────────────────────────────────────────────────

/** A fake muaban.net: the list and detail pages as the crawl reads them (shapes as measured 2026-10-01). */
type Ad = { id: number; city: CityKey; district: number; price: number; created: number; gone?: boolean; expired?: boolean; unlisted?: boolean }
const CITY_SLUG: Record<CityKey, string> = { hcm: 'ho-chi-minh', hn: 'ha-noi', dn: 'da-nang' }
const DSLUG: Record<number, string> = { 363: 'quan-1', 376: 'quan-binh-thanh', 1: 'quan-ba-dinh', 2: 'quan-hai-chau', 999: 'quan-moi' }
const QUICK: Record<CityKey, number[]> = { hcm: [363, 376], hn: [1], dn: [2] }
const pathOf = (city: CityKey, d?: number) => `/bat-dong-san/cho-thue-can-ho-${d !== undefined ? `${DSLUG[d]}-` : ''}${CITY_SLUG[city]}`
const cardOf = (a: Ad) => ({ id: a.id, city_id: CITIES[a.city].sourceId, district_id: a.district, subcategory_id: 46, property_type: APARTMENT_TYPE, price: a.price, price_display: `${a.price / 1e6} triệu/tháng`, url: `${pathOf(a.city, a.district)}/can-ho-id${a.id}` })
type Answer = { status: number; data: any | null }
type Hook = (u: URL, nth: number) => Answer | undefined

function fakeSite(ads: Ad[], hook?: Hook) {
  const calls: string[] = []
  const answer = (u: URL): Answer => {
    /** A detail page: the canonical slug form, or the id-only link (muaban answers both — the latter by a 301). */
    const m = /\/(?:[a-z0-9-]+-)?id(\d+)$/.exec(u.pathname)
    if (m) {
      const a = ads.find((x) => x.id === Number(m[1]))
      if (!a || a.gone) return { status: 404, data: { props: { pageProps: { notFound: true } } } }
      return { status: 200, data: { props: { pageProps: { classified: { ...cardOf(a), created_at: new Date(a.created).toISOString(), is_expired: !!a.expired, is_outdate: false, publish: true } } } } }
    }
    const city = (Object.keys(CITY_SLUG) as CityKey[]).find((c) => u.pathname.endsWith(CITY_SLUG[c]))!
    const did = Object.keys(DSLUG).map(Number).find((d) => u.pathname === pathOf(city, d))
    const district = did ?? null
    const priceQ = u.searchParams.get('price')
    const band = priceQ ? priceQ.split('-').map(Number) : null
    const page = Math.min(Number(u.searchParams.get('page') ?? 1), SOURCE_PAGE_CAP)                   // page 52 repeats page 51
    const all = ads
      .filter((a) => !a.gone && !a.unlisted && a.city === city && (district === null || a.district === district) && (!band || (a.price >= band[0] && a.price <= band[1])))
      .sort((a, b) => a.price - b.price || a.id - b.id)
    const filters = {
      subcategory_id: { id: 46 }, city_id: { id: CITIES[city].sourceId }, property_type: { id: APARTMENT_TYPE }, sort: { id: Number(u.searchParams.get('sort')) },
      ...(district !== null ? { district_id: { id: district } } : {}), ...(band ? { price: { min: band[0], max: band[1] } } : {}),
    }
    const quicklink = district === null && !band ? { district: { items: QUICK[city].map((id) => ({ id, url: pathOf(city, id) })) } } : undefined
    return { status: 200, data: { props: { pageProps: { filterResult: { filters }, quicklink, classified: { total: all.length, items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(cardOf) } } } } }
  }
  const get: GetPage = async (url) => {
    calls.push(url)
    const u = new URL(url)
    return hook?.(u, calls.filter((c) => c === url).length) ?? answer(u)
  }
  return { get, calls, answer, details: () => calls.filter((c) => /\/(?:[a-z0-9-]+-)?id\d+$/.test(c)) }
}

const H = 3_600_000
/** Ads whose ids rise with created_at: id BASE+k, 3 h apart, the newest 2.5 h old at SET_AT (no age falls on a boundary). */
const BASE = 71_000_000
function ads(groups: { city: CityKey; district: number; n: number; price?: (k: number) => number }[]): Ad[] {
  const slots = groups.flatMap((g) => Array.from({ length: g.n }, () => g))
  // a fixed shuffle, so every list holds old and new ads alike
  const order = slots.map((_, i) => i).sort((a, b) => ((a * 7919) % 1009) - ((b * 7919) % 1009) || a - b)
  return order.map((slot, k) => {
    const g = slots[slot]
    return { id: BASE + k, city: g.city, district: g.district, price: g.price ? g.price(k) : 3_000_000 + (k % 9) * 1_000_000, created: SET_AT - (slots.length - k) * 3 * H + 30 * 60_000 }
  })
}
const SMALL = () => ads([{ city: 'hcm', district: 363, n: 40 }, { city: 'hcm', district: 376, n: 30 }, { city: 'hn', district: 1, n: 50 }, { city: 'dn', district: 2, n: 70 }])
const clock = () => { let t = SET_AT; return () => (t += 1000) }
const crawler = (get: GetPage, log: string[] = []) => new FreshCrawler(get, { cities: ['hcm', 'hn', 'dn'], now: clock(), log: (l) => log.push(l) })
const seedOf = (fc: FreshCrawler, label: string) => fc.seeds.find((s) => s.label === label)
const FRESH_IDS = (all: Ad[], at: number) => all.filter((a) => !a.gone && at - a.created <= FRESH_DAYS * DAY).map((a) => a.id).sort()

describe('FreshCrawler — ⛔ every list read whole, then the detail walk down to the floor (fake muaban)', () => {
  it('reads a city over the cap by district, a district over the cap by price, and finds exactly the fresh ads', async () => {
    const all = ads([
      { city: 'hcm', district: 363, n: 1000, price: (k) => (k % 2 ? 5_000_000 : 12_000_000) }, { city: 'hcm', district: 376, n: 100 },
      { city: 'hn', district: 1, n: 30 }, { city: 'dn', district: 2, n: 25 },
    ])
    const site = fakeSite(all)
    const records: unknown[] = []
    const fc = await new FreshCrawler(site.get, { cities: ['hcm', 'hn', 'dn'], now: clock(), onRecord: (r) => records.push(r) }).run()
    expect(fc.stopped).toBeNull()
    const cheap = all.filter((a) => a.district === 363 && a.price <= 8_000_000).length
    expect(cheap).toBeGreaterThan(400)
    expect(fc.seeds.map((s) => [s.label, s.ok, s.total, s.split])).toEqual([
      ['hcm', true, 1100, true],
      ['hcm district 363', true, 1000, true],
      ['hcm district 363 price 0-8000000', true, cheap, false],
      ['hcm district 363 price 8000001-1000000000000', true, 1000 - cheap, false],
      ['hcm district 376', true, 100, false],
      ['hn', true, 30, false],
      ['dn', true, 25, false],
    ])
    expect(fc.cards.size).toBe(1155)
    // 56 created within 7 days (3 h apart, the newest 3 h old), 8 just older, then FLOOR_CONFIRM clearly old → the floor
    expect([...fc.items.keys()].sort()).toEqual(FRESH_IDS(all, fc.setAt))
    expect(fc.items.size).toBe(56)
    expect(fc.floor.floor).toBe(BASE + 1155 - 56 - 8 - FLOOR_CONFIRM)
    expect(fc.details).toEqual({ read: 56 + 8 + FLOOR_CONFIRM, fresh: 56, old: 8 + FLOOR_CONFIRM, gone: 0, unknown: 0 })
    expect(site.details()).toHaveLength(56 + 8 + FLOOR_CONFIRM)                                      // nothing below the floor was requested
    expect(fc.belowFloor).toBe(1155 - 56 - 8 - FLOOR_CONFIRM)
    expect(records).toHaveLength(56 + 8 + FLOOR_CONFIRM)
    expect(records.every((r) => (r as { setAt: string }).setAt === iso(fc.setAt))).toBe(true)
    expect(parseStage(records.map((r) => JSON.stringify(r)).join('\n'))).toHaveLength(67)          // the stage re-reads cleanly
    await fc.dbNet([])
    const cov = fc.coverage()
    expect(freshCoverageProblem(cov)).toBeNull()
    expect(cov.inversions).toBe(0)
    const built = buildFreshSet(new Date(fc.setAt), freshCoverageEvidence(cov), [...fc.items.values()], [...fc.unknown], fc.setAt + 3_600_000)
    expect(built.problem).toBeNull()
    expect(built.set!.fetchedAt).toBe(iso(fc.setAt))
  })

  it('a list that ends on a full page is closed by the empty page after it', async () => {
    const site = fakeSite(SMALL())                                                                    // hn: 50 = 20+20+10; hcm: 70; dn: 70
    const fc = await crawler(site.get).run()
    expect(seedOf(fc, 'hcm')).toMatchObject({ ok: true, total: 70, pages: 4 })
    const four = fakeSite(ads([{ city: 'hcm', district: 363, n: 40 }, { city: 'hn', district: 1, n: 20 }, { city: 'dn', district: 2, n: 5 }]))
    const f4 = await crawler(four.get).run()
    expect(seedOf(f4, 'hcm')).toMatchObject({ ok: true, total: 40, pages: 3 })                       // 20, 20, then an empty page
    expect(seedOf(f4, 'hn')).toMatchObject({ ok: true, total: 20, pages: 2 })
  })

  it('⛔ a page that repeats the one before (the source\'s page cap) fails the list, after one re-read', async () => {
    const site = fakeSite(SMALL(), (u) => (u.pathname === pathOf('dn') && Number(u.searchParams.get('page')) >= 3
      ? fakeSite(SMALL()).answer(new URL(u.href.replace(/page=\d+/, 'page=2'))) : undefined))
    const log: string[] = []
    const fc = await crawler(site.get, log).run()
    expect(seedOf(fc, 'dn')).toMatchObject({ ok: false, why: expect.stringMatching(/page 3 repeats page 2 — the source's 51-page cap/) })
    expect(log.some((l) => /dn: page 3 repeats page 2 .* reading it once more/.test(l))).toBe(true)
    expect(fc.details.read).toBe(0)                                                                  // no detail page spent on a set that cannot be written
    await fc.dbNet([])
    expect(freshCoverageProblem(fc.coverage())).toMatch(/^dn: page 3 repeats page 2/)
  })

  it('⛔ a card shifted behind the reader (an ad deleted mid-read) is caught by the count, and the list re-read', async () => {
    const all = SMALL()
    const hn = all.filter((a) => a.city === 'hn').sort((a, b) => a.price - b.price || a.id - b.id)
    let deleted = false
    const site = fakeSite(all, (u, nth) => {
      if (!deleted && u.pathname === pathOf('hn') && u.searchParams.get('page') === '2' && nth === 1) { hn[0].gone = true; deleted = true }
      return undefined
    })
    const log: string[] = []
    const fc = await crawler(site.get, log).run()
    expect(log.some((l) => /hn: 49 distinct cards read, the list reported 50 then 49 — reading it once more/.test(l))).toBe(true)
    expect(seedOf(fc, 'hn')).toMatchObject({ ok: true, total: 49 })
    expect(fc.cards.has(hn[1].id)).toBe(true)                                                         // the card that slid back onto page 1
  })

  it('⛔ an off-filter card (another city, no id) never pads a list\'s count over a card it hides', async () => {
    const all = SMALL()
    const hn = all.filter((a) => a.city === 'hn').sort((a, b) => a.price - b.price || a.id - b.id)
    const site = fakeSite(all, (u) => {
      if (u.pathname !== pathOf('hn')) return undefined
      const a = fakeSite(all).answer(u)
      const items = a.data.props.pageProps.classified.items as any[]
      const page = u.searchParams.get('page') ?? '1'
      if (page === '1') items.unshift({ ...cardOf(all.find((x) => x.city === 'hcm')!), id: 69_000_001 })   // a pinned VIP card from HCMC
      if (page === '2') items.unshift({ id: 'vip' })
      if (page === '3') a.data.props.pageProps.classified.items = items.filter((it) => it.id !== hn[49].id) // and one real card never shown
      return a
    })
    const fc = await crawler(site.get).run()
    expect(seedOf(fc, 'hn')).toMatchObject({ ok: false, why: expect.stringMatching(/49 distinct cards read, the list reported 50/) })
    expect(fc.offSeed).toBeGreaterThanOrEqual(4)                                                      // 2 per attempt
    expect(fc.cards.has(69_000_001)).toBe(false)
  })

  it('⛔ a split whose parts do not add up (an ad in no listed district) fails the city', async () => {
    const all = ads([{ city: 'hcm', district: 363, n: 900 }, { city: 'hcm', district: 376, n: 60 }, { city: 'hcm', district: 999, n: 1 }, { city: 'hn', district: 1, n: 5 }, { city: 'dn', district: 2, n: 5 }])
    const fc = await crawler(fakeSite(all).get).run()
    expect(seedOf(fc, 'hcm')).toMatchObject({ ok: false, split: true, why: 'the parts total 960, the whole 961 — 1 card(s) in no part' })
    expect(fc.seeds.map((s) => s.label)).toEqual(['hcm'])                                             // nothing after a failed city is read
    expect(fc.details.read).toBe(0)
  })

  it('⛔ a part that fails twice fails its split; a page that fails once is read once more and passes', async () => {
    const big = () => ads([{ city: 'hcm', district: 363, n: 900 }, { city: 'hcm', district: 376, n: 61 }, { city: 'hn', district: 1, n: 5 }, { city: 'dn', district: 2, n: 5 }])
    const dead = fakeSite(big(), (u) => (u.pathname === pathOf('hcm', 376) && !u.searchParams.get('page') ? { status: 0, data: null } : undefined))
    const fc = await crawler(dead.get).run()
    expect(seedOf(fc, 'hcm')).toMatchObject({ ok: false, why: 'a part failed: HTTP 0 on page 1' })
    expect(fc.retries).toBe(1)
    expect(dead.calls.filter((c) => c.startsWith(`https://muaban.net${pathOf('hcm', 376)}?`))).toHaveLength(2)

    for (const status of [0, 502, 503]) {
      const flaky = fakeSite(SMALL(), (u, nth) => (u.pathname === pathOf('hn') && !u.searchParams.get('page') && nth === 1 ? { status, data: null } : undefined))
      const log: string[] = []
      const ok = await crawler(flaky.get, log).run()
      expect(seedOf(ok, 'hn')).toMatchObject({ ok: true, total: 50 })
      expect(ok.retries).toBe(1)
      expect(log.some((l) => l.includes(`↻ hn page 1: HTTP ${status} — reading it once more`))).toBe(true)
    }
    expect(isTransient(404)).toBe(false)
    expect(isTransient(200)).toBe(false)
  })

  it('⛔ an Infeasible from the getter (a challenge, a 429) stops the crawl — never read as a page failure', async () => {
    const site = fakeSite(SMALL(), (u) => { if (u.pathname === pathOf('dn')) throw new Infeasible('bot challenge at dn (HTTP 403)'); return undefined })
    const fc = await crawler(site.get).run()
    expect(fc.stopped).toMatch(/bot challenge/)
    await fc.dbNet([])
    expect(freshCoverageProblem(fc.coverage())).toMatch(/the crawl stopped: bot challenge/)
    expect(site.details()).toHaveLength(0)
  })

  it('a detail page that answers 5xx or about another ad is undetermined — kept, and it neither forms nor breaks the floor', async () => {
    const all = SMALL()
    const top = Math.max(...all.map((a) => a.id))
    const site = fakeSite(all, (u) => {
      if (u.pathname.endsWith(`-id${top}`)) return { status: 503, data: null }
      if (u.pathname.endsWith(`-id${top - 1}`)) return { status: 200, data: { props: { pageProps: { classified: { id: 1 } } } } }
      return undefined
    })
    const fc = await crawler(site.get).run()
    expect([...fc.unknown].sort()).toEqual([top - 1, top])
    expect(fc.details.unknown).toBe(2)
    expect(fc.floor.floor).not.toBeNull()
    expect(fc.items.has(top)).toBe(false)
    // the 503 was read twice (once more, then undetermined); a 200 about another ad is an answer, never re-read
    expect(site.details().filter((c) => c.endsWith(`-id${top}`))).toHaveLength(2)
    expect(site.details().filter((c) => c.endsWith(`-id${top - 1}`))).toHaveLength(1)
    expect(fc.retries).toBe(1)
  })

  it('⛔ a detail page that answers 0 / 5xx ONCE is read once more (after the getter\'s politeness gap), counted in retries, and judged', async () => {
    for (const status of [0, 500, 503]) {
      const all = SMALL()
      const top = Math.max(...all.map((a) => a.id))
      const site = fakeSite(all, (u, nth) => {
        if (u.pathname.endsWith(`-id${top}`) && nth === 1) return { status, data: null }
        if (u.pathname.endsWith(`-id${top - 1}`)) return { status: 404, data: null }                    // deleted: an answer, not a blip
        return undefined
      })
      const log: string[] = []
      const drops: string[] = []
      const fc = await new FreshCrawler(site.get, { cities: ['hcm', 'hn', 'dn'], now: clock(), log: (l) => log.push(l), onDrop: (k) => drops.push(k) }).run()
      expect(site.details().filter((c) => c.endsWith(`-id${top}`))).toHaveLength(2)
      expect(site.details().filter((c) => c.endsWith(`-id${top - 1}`))).toHaveLength(1)
      expect(fc.retries).toBe(1)
      expect(log.some((l) => l.includes(`↻ detail id ${top}: HTTP ${status} — reading it once more`))).toBe(true)
      expect(fc.items.has(top)).toBe(true)                                                            // 2.5 h old: fresh, not undetermined
      expect(fc.unknown.has(top)).toBe(false)
      expect(fc.details).toMatchObject({ unknown: 0, gone: 1 })
      expect(fc.details.read).toBe(site.details().length - 1)                                         // each ad counted once; the re-read is a retry
      expect(drops.filter((k) => k === 'detailHttp')).toHaveLength(0)
      expect(freshCoverageEvidence(fc.coverage())).toContain('(1 page(s) re-read after a timeout/5xx)')
    }
  })

  it('⛔ the db net\'s own reads get the same one re-read', async () => {
    const all = SMALL()
    const hole: Ad = { id: BASE + 5000, city: 'hcm', district: 363, price: 5e6, created: SET_AT - 2 * DAY, unlisted: true }
    const site = fakeSite([...all, hole], (u, nth) => (u.pathname.endsWith(`id${hole.id}`) && nth === 1 ? { status: 502, data: null } : undefined))   // the held row's id-only link
    const fc = await crawler(site.get).run()
    const before = fc.retries
    const db = await fc.dbNet([{ externalId: `muaban:${hole.id}`, affiliateUrl: `https://muaban.net${pathOf('hcm', 363)}/can-ho-id${hole.id}`, postedAt: new Date(SET_AT - 2 * DAY) }])
    expect(fc.retries - before).toBe(1)
    expect(db).toMatchObject({ read: 1, unknown: 0, missed: 1 })                                     // judged: live there, so a hole
    expect(fc.items.has(hole.id)).toBe(true)
  })
})

describe('the db net — ⛔ the rows we hold that neither the lists nor the floor can vouch for', () => {
  const held = (id: number, postedAt: number, url = `${pathOf('hcm', 363)}/can-ho-id${id}`): HeldRow => ({ externalId: `muaban:${id}`, affiliateUrl: `https://muaban.net${url}`, postedAt: new Date(postedAt) })

  it('planDbNet: unlisted above the floor; below it only with a postedAt inside the window (or unreadable)', () => {
    const p = planDbNet([
      held(500, SET_AT), held(400, SET_AT - 30 * DAY), held(300, SET_AT),                             // above the floor 250
      held(200, SET_AT - DAY), held(150, SET_AT - FRESH_DAYS * DAY), held(100, SET_AT - FRESH_DAYS * DAY - 1), held(90, NaN),
      { externalId: 'nhatot:5', affiliateUrl: null, postedAt: new Date(SET_AT) }, { externalId: null, affiliateUrl: null, postedAt: new Date(SET_AT) },
    ], { floor: 250, listed: new Set([300]), setAt: SET_AT })
    expect(p.aboveFloor).toBe(3)
    expect(p.unlisted.map((m) => m.id)).toEqual([500, 400])
    expect(p.recentBelow.map((m) => m.id)).toEqual([200, 150, 90])
    expect(p.unlisted[0].url).toBe('https://muaban.net/bat-dong-san/cho-thue-can-ho-quan-1-ho-chi-minh/id500')
    // no floor: every row is "above" it
    expect(planDbNet([held(5, SET_AT - 99 * DAY)], { floor: null, listed: new Set(), setAt: SET_AT })).toMatchObject({ aboveFloor: 1, unlisted: [{ id: 5 }], recentBelow: [] })
  })

  it('⛔ only a page still LIVE at the source is a hole: deleted (404) and expired ads are churn, read first', async () => {
    const all = SMALL()
    const extra: Ad[] = Array.from({ length: 30 }, (_, i) => ({ id: BASE + 5000 + i, city: 'hcm', district: 363, price: 5e6, created: SET_AT - 2 * DAY, unlisted: true, gone: i < 25 }))
    const expired: Ad[] = Array.from({ length: 30 }, (_, i) => ({ id: BASE + 6000 + i, city: 'hcm', district: 363, price: 5e6, created: SET_AT - 30 * DAY, unlisted: true, expired: true }))
    const site = fakeSite([...all, ...extra, ...expired])
    const fc = await crawler(site.get).run()
    const before = site.details().length
    const db = await fc.dbNet([...extra, ...expired].map((a) => held(a.id, SET_AT - 40 * DAY)))
    expect(site.details().length - before).toBe(60)
    expect(db).toMatchObject({ unlisted: 60, read: 60, gone: 25, inactive: 30, missed: 5, floorBreaks: 0 })
    expect(freshCoverageProblem(fc.coverage())).toBeNull()                                           // 5 live holes: under DB_MISS_MAX
    // the 5 live unlisted ads are fresh: kept in the set, never expired for being off the lists
    for (const a of extra.slice(25)) expect(fc.items.has(a.id)).toBe(true)
    expect(fc.items.has(expired[0].id)).toBe(false)
  })

  it('⛔ more live holes than DB_MISS_MAX refuse the set: the lists are not whole', async () => {
    const holes: Ad[] = Array.from({ length: DB_MISS_MAX + 1 }, (_, i) => ({ id: BASE + 7000 + i, city: 'hcm', district: 363, price: 5e6, created: SET_AT - 30 * DAY, unlisted: true }))
    const site = fakeSite([...SMALL(), ...holes])
    const fc = await crawler(site.get).run()
    await fc.dbNet(holes.map((a) => held(a.id, SET_AT - 40 * DAY)))
    expect(freshCoverageProblem(fc.coverage())).toMatch(/21 of 21 live rows above the id floor are live at the source yet on no list page/)
  })

  it('⛔ a held row below the floor dated inside the window is READ — a fresh one is kept and counted as a floor break', async () => {
    const all = SMALL()
    const site = fakeSite(all)
    const fc = await crawler(site.get).run()
    const floor = fc.floor.floor!
    // an inverted ad: a low id created yesterday (a cloned or migrated ad), and an ordinary old one we also hold
    const listedLow = all.find((a) => a.id < floor - 5)!
    listedLow.created = SET_AT - DAY
    const old = all.find((a) => a.id < floor - 10 && a.id !== listedLow.id)!
    const before = site.details().length
    const db = await fc.dbNet([held(listedLow.id, SET_AT - DAY, cardOf(listedLow).url), held(old.id, SET_AT - 20 * DAY, cardOf(old).url)])
    expect(db).toMatchObject({ recentBelow: 1, read: 1, floorBreaks: 1, missed: 0 })
    expect(site.details().slice(before)).toEqual([`https://muaban.net${cardOf(listedLow).url}`])      // its own canonical page; the old row is not read
    expect(fc.items.has(listedLow.id)).toBe(true)
    expect(fc.records.at(-1)).toMatchObject({ item: { id: listedLow.id }, setAt: iso(fc.setAt) })   // staged too: the apply refreshes it
    expect(freshCoverageProblem(fc.coverage())).toBeNull()
    expect(freshCoverageEvidence(fc.coverage())).toContain('1 below the floor were in fact fresh (kept)')
  })

  it('⛔ over DB_RECHECK_MAX rows to read → none is read, and the set is refused', async () => {
    const site = fakeSite(SMALL())
    const fc = await crawler(site.get).run()
    const before = site.calls.length
    const rows = Array.from({ length: DB_RECHECK_MAX + 1 }, (_, i) => held(BASE + 100_000 + i, SET_AT - 40 * DAY))
    const db = await fc.dbNet(rows)
    expect(site.calls.length).toBe(before)
    expect(db).toMatchObject({ toRead: DB_RECHECK_MAX + 1, read: 0 })
    expect(freshCoverageProblem(fc.coverage())).toMatch(/over 1500; nothing was read/)
  })

  it('reads nothing when the lists already failed', async () => {
    const site = fakeSite(SMALL(), (u) => (u.pathname === pathOf('dn') ? { status: 404, data: null } : undefined))
    const fc = await crawler(site.get).run()
    const before = site.calls.length
    await fc.dbNet([held(BASE + 900_000, SET_AT)])
    expect(site.calls.length).toBe(before)
    expect(freshCoverageProblem(fc.coverage())).toMatch(/^dn: HTTP 404 on page 1/)
  })
})
