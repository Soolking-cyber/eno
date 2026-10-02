import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FRESH_DAYS, freshSetProblem, makeFreshSet, planExpiry, rollingWindowFrom, windowDaysFor } from './apartment-freshness'
import { HONEYCOMB_SELLER_ID, Infeasible, readHoneycombStage, unknownFlagProblem, type Got, type SitemapEntry } from './honeycomb-listing'
import {
  BULK_RESAVE_MAX_SHARE, CACHE_BUST_PARAM, GONE_MAX_SHARE, GONE_MIN_URLS, HONEYCOMB_WINDOW_DAYS, NO_DATE_CHANGE, WP_SITEMAP_MAX_URLS, buildHoneycombFreshSet, bulkResaveProblem, cacheBustedUrl,
  classifyDetailPage, datePlan, datedRollbackSql, freshOutPreflight, honeycombSourceDate, inWindowGoneProblem, isCacheHit, keepVerdict, lastmodTrust,
  makeTombstoneLedger, parseSinceDays, pdpTombstoneSql, propertySitemapsProblem, readDetailPages, recentShare, sitemapBodyClosed,
  sitemapCacheProblem, sitemapCacheSummary, sitemapFileRead, sitemapReadProblem,
  type DetailOutcome, type SitemapFileRead,
} from './honeycomb-freshness'

const DAY = 86_400_000
/** Honeycomb's window (30 days) — every window edge below is judged by it, never by FRESH_DAYS (7). */
const W = HONEYCOMB_WINDOW_DAYS
/** 2026-10-01 12:00 in Vietnam. */
const NOW = Date.parse('2026-10-01T05:00:00Z')
const FETCHED = NOW - 10 * 60_000
const iso = (ms: number) => new Date(ms).toISOString()
/** A lastmod as the site writes it (+07:00), `ms` before the fetch. */
const vnStamp = (ms: number) => {
  const d = new Date(ms + 7 * 3_600_000)
  return d.toISOString().slice(0, 19) + '+07:00'
}

describe("⛔ Honeycomb's window is the per-seller table's 30 days, not the other sources' 7", () => {
  it('HONEYCOMB_WINDOW_DAYS is windowDaysFor(the seller): 30, while every other source keeps FRESH_DAYS', () => {
    expect(HONEYCOMB_WINDOW_DAYS).toBe(30)
    expect(HONEYCOMB_WINDOW_DAYS).toBe(windowDaysFor(HONEYCOMB_SELLER_ID))
    expect(FRESH_DAYS).toBe(7)
  })
})

describe('honeycombSourceDate — the OLDEST instant a lastmod can mean', () => {
  it('reads the shape the site serves (measured 2026-10-01): a full timestamp with +07:00', () => {
    expect(honeycombSourceDate('2026-09-17T16:24:25+07:00')!.toISOString()).toBe('2026-09-17T09:24:25.000Z')
    expect(honeycombSourceDate('2026-09-17T09:24:25Z')!.toISOString()).toBe('2026-09-17T09:24:25.000Z')
    expect(honeycombSourceDate('2026-09-17T04:24:25-05:00')!.toISOString()).toBe('2026-09-17T09:24:25.000Z')
    expect(honeycombSourceDate(' 2026-09-17T16:24:25+07:00 ')!.toISOString()).toBe('2026-09-17T09:24:25.000Z')
  })
  it('a missing part is its START: no seconds → :00; a fraction is truncated, never rounded up', () => {
    expect(honeycombSourceDate('2026-09-17T16:24+07:00')!.toISOString()).toBe('2026-09-17T09:24:00.000Z')
    expect(honeycombSourceDate('2026-09-17T16:24:25.9996+07:00')!.toISOString()).toBe('2026-09-17T09:24:25.999Z')
    expect(honeycombSourceDate('2026-09-17T16:24:25.5Z')!.toISOString()).toBe('2026-09-17T16:24:25.500Z')
  })
  it('⛔ a bare date is the START of that day in Asia/Ho_Chi_Minh, not UTC midnight', () => {
    expect(honeycombSourceDate('2026-09-24')!.toISOString()).toBe('2026-09-23T17:00:00.000Z')
    // Date.parse would say 07:00 in Vietnam — seven hours younger than the worst case.
    expect(honeycombSourceDate('2026-09-24')!.getTime()).toBeLessThan(Date.parse('2026-09-24'))
  })
  it('⛔ an offset-less timestamp is unknowable (Date.parse reads it in the local clock) — null', () => {
    expect(honeycombSourceDate('2026-09-17T16:24:25')).toBeNull()
    expect(honeycombSourceDate('2026-09-17 16:24:25+07:00')).toBeNull()
  })
  it('refuses impossible dates and junk rather than rolling them over', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-09-17T24:00:00Z', '2026-09-17T23:60:00Z', '2026-09-17T23:59:60Z',
      '2026-09-17T10:00:00+15:00', '0099-01-01', 'yesterday', '', '2026-09', '17/09/2026']) {
      expect(honeycombSourceDate(bad), bad).toBeNull()
    }
    expect(honeycombSourceDate(null)).toBeNull()
    expect(honeycombSourceDate(undefined)).toBeNull()
  })
})

describe('the sitemap must be provably whole', () => {
  const map = (n: number) => `https://honeycomb.com.vn/wp-sitemap-posts-estate_property-${n}.xml`
  it('accepts estate_property sitemaps 1…N in any order', () => {
    expect(propertySitemapsProblem([1, 2, 3, 4, 5, 6, 7].map(map))).toBeNull()
    expect(propertySitemapsProblem([3, 1, 2].map(map))).toBeNull()
  })
  it('⛔ refuses a gap, a duplicate, none at all, or another sitemap', () => {
    expect(propertySitemapsProblem([1, 2, 4].map(map))).toMatch(/not 1…3/)
    expect(propertySitemapsProblem([2, 3].map(map))).toMatch(/not 1…2/)
    expect(propertySitemapsProblem([1, 1, 2].map(map))).toMatch(/twice/)
    expect(propertySitemapsProblem([])).toMatch(/no estate_property/)
    expect(propertySitemapsProblem([map(1), 'https://honeycomb.com.vn/wp-sitemap-posts-page-1.xml'])).toMatch(/not an estate_property/)
  })
})

describe('⛔ the bulk re-save guard', () => {
  const entries = (recent: number, old: number): SitemapEntry[] => [
    ...Array.from({ length: recent }, (_, i) => ({ url: `https://honeycomb.com.vn/property/r${i}/`, lastmod: vnStamp(FETCHED - DAY) })),
    ...Array.from({ length: old }, (_, i) => ({ url: `https://honeycomb.com.vn/property/o${i}/`, lastmod: vnStamp(FETCHED - (W + 10) * DAY) })),
  ]
  it('counts urls at or after the window start — a future-dated one too', () => {
    expect(recentShare(entries(3, 7), FETCHED)).toEqual({ recent: 3, total: 10 })
    const edge = [{ url: 'u', lastmod: vnStamp(FETCHED - W * DAY) }, { url: 'v', lastmod: vnStamp(FETCHED - W * DAY - 1000) }, { url: 'w', lastmod: vnStamp(FETCHED + DAY) }, { url: 'x', lastmod: null }]
    expect(recentShare(edge, FETCHED)).toEqual({ recent: 2, total: 4 })
  })
  it('⛔ measures the share over the 30-day window: a url touched 20 days ago is recent, one 31 days ago is not', () => {
    const e = [{ url: 'a', lastmod: vnStamp(FETCHED - 20 * DAY) }, { url: 'b', lastmod: vnStamp(FETCHED - (W + 1) * DAY) }]
    expect(recentShare(e, FETCHED)).toEqual({ recent: 1, total: 2 })
    // The 7-day measure would miss it — and let a re-save of the last month re-date the catalogue.
    expect(recentShare(e, FETCHED, FRESH_DAYS)).toEqual({ recent: 0, total: 2 })
    expect(bulkResaveProblem(26, 100)).toMatch(/in the 30 days before the fetch/)
  })
  it(`trips above ${BULK_RESAVE_MAX_SHARE * 100}% of ALL property urls, not at it`, () => {
    expect(bulkResaveProblem(25, 100)).toBeNull()
    expect(bulkResaveProblem(26, 100)).toMatch(/site-wide re-save/)
    expect(bulkResaveProblem(0, 0)).toBeNull()
  })
  it('lastmod is trusted only over a complete sitemap under the guard', () => {
    expect(lastmodTrust({ fetchedAt: iso(FETCHED), sitemap: { complete: true, entries: entries(3, 97) } })).toEqual({ ok: true, recent: 3, total: 100 })
    expect(lastmodTrust({ fetchedAt: iso(FETCHED), sitemap: { complete: true, entries: entries(30, 70) } })).toMatchObject({ ok: false, reason: expect.stringMatching(/re-save/) })
    expect(lastmodTrust({ fetchedAt: iso(FETCHED), sitemap: { complete: false, entries: entries(3, 97) } })).toMatchObject({ ok: false, reason: expect.stringMatching(/incomplete/) })
    expect(lastmodTrust({ fetchedAt: 'x', sitemap: { complete: true, entries: entries(3, 97) } })).toMatchObject({ ok: false })
  })
})

describe('buildHoneycombFreshSet', () => {
  const MAPS = 7
  const url = (s: string) => `https://honeycomb.com.vn/property/${s}/`
  type Row = { slug: string; ago: number | null; lastmod?: string | null; out?: DetailOutcome }
  /** The scene: `rows` in the window (or not), plus enough old urls that the share stays under the guard. */
  function scene(rows: Row[], over: Partial<Parameters<typeof buildHoneycombFreshSet>[0]> = {}) {
    // Padded to the pages' full 12,822 kept urls: distinct entries must equal what the pages kept (no overlap).
    const old = Array.from({ length: (MAPS - 1) * 2000 + 822 - rows.length }, (_, i) => ({ url: url(`old-${i}`), lastmod: vnStamp(FETCHED - 40 * DAY) }))
    const entries: SitemapEntry[] = [
      ...rows.map((r) => ({ url: url(r.slug), lastmod: r.lastmod !== undefined ? r.lastmod : r.ago === null ? null : vnStamp(FETCHED - r.ago) })),
      ...old,
    ]
    const detail = new Map<string, DetailOutcome>()
    for (const r of rows) if (r.out) detail.set(url(r.slug), r.out)
    // As measured 2026-10-02: pages 1…6 full (2,000 urls), page 7 holds 822, every body closed.
    const maps: SitemapFileRead[] = Array.from({ length: MAPS }, (_, i) => {
      const n = i < MAPS - 1 ? 2000 : 822
      return { url: `https://honeycomb.com.vn/wp-sitemap-posts-estate_property-${i + 1}.xml`, status: 200, urls: n, kept: n, closed: true, cache: 'miss' }
    })
    return buildHoneycombFreshSet({
      fetchedAt: new Date(FETCHED), now: NOW, maps, indexCache: 'miss', entries,
      // The --since-days 30 stage's day window: the start of the Vietnam day 30 days back (≤ fetchedAt − 30 d).
      detailSinceMs: Date.parse('2026-09-01T00:00:00+07:00'), limit: 0, stopped: null, detail,
      stored: [
        { externalId: 'honeycomb:500', affiliateUrl: url('stored-fresh') },
        { externalId: 'honeycomb:600', affiliateUrl: url('timeout') },
        { externalId: 'honeycomb:700', affiliateUrl: url('no-date') },
        { externalId: 'honeycomb:800', affiliateUrl: url('old-0') },
        { externalId: null, affiliateUrl: url('x') },
      ],
      ...over,
    })
  }
  const rec = (postId: string): DetailOutcome => ({ kind: 'record', postId })

  it('holds every in-window url read to a post id — stored or new, any category — at its worst-case date', () => {
    const r = scene([
      { slug: 'stored-fresh', ago: 2 * DAY, out: rec('500') },
      { slug: 'new-house', ago: 3 * 3_600_000, out: rec('501') },
      // 20 days old: outside the other sources' 7 days, inside Honeycomb's 30 — in the set.
      { slug: 'twenty-days', ago: 20 * DAY, out: rec('502') },
      { slug: 'old-stored', ago: (W + 1) * DAY },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.set.sellerId).toBe(HONEYCOMB_SELLER_ID)
    expect(r.set.windowDays).toBe(30)
    expect(r.set.items).toEqual([
      { externalId: 'honeycomb:500', sourceDate: iso(Math.floor((FETCHED - 2 * DAY) / 1000) * 1000), dateKind: 'modified' },
      { externalId: 'honeycomb:501', sourceDate: iso(Math.floor((FETCHED - 3 * 3_600_000) / 1000) * 1000), dateKind: 'modified' },
      { externalId: 'honeycomb:502', sourceDate: iso(Math.floor((FETCHED - 20 * DAY) / 1000) * 1000), dateKind: 'modified' },
    ])
    expect(r.set.unknown).toEqual([])
    expect(freshSetProblem(JSON.parse(JSON.stringify(r.set)), NOW, HONEYCOMB_SELLER_ID)).toBeNull()
    expect(r.set.coverage).toMatch(/estate_property sitemaps 1…7, 7\/7 read \(HTTP 200, non-empty, each ending <\/urlset>; urls per page 2000\/2000\/2000\/2000\/2000\/2000\/822/)
    expect(r.set.coverage).toMatch(/every in-window page read: 3 posts identified/)
    expect(r.set.coverage).toMatch(/\(fetchedAt − 30 d\)/)
    expect(r.set.coverage).toMatch(/pages before the last exactly 2000, the last under it/)
    expect(r.set.coverage).toContain(`each requested with ?${CACHE_BUST_PARAM}=<run start>, none from the page cache — x-litespeed-cache: index miss · -1.xml miss · -2.xml miss · -3.xml miss · -4.xml miss · -5.xml miss · -6.xml miss · -7.xml miss`)
  })

  it('⛔ a bare-date lastmod is judged at the START of its Vietnam day (the worst case), not at UTC midnight', () => {
    const at = Date.parse('2026-10-01T20:00:00Z') // 03:00 on 2 Oct in Vietnam: the 30-day window opens 2026-09-01T20:00Z
    const r = scene([
      { slug: 'a', ago: null, lastmod: '2026-09-03', out: rec('1') },
      // Could mean 2026-09-01T17:00Z at the earliest — before the window. Read as UTC midnight it would be in.
      { slug: 'b', ago: null, lastmod: '2026-09-02', out: rec('2') },
    ], { fetchedAt: new Date(at), now: at + 60_000 })
    expect(r.ok && r.set.items).toEqual([{ externalId: 'honeycomb:1', sourceDate: '2026-09-02T17:00:00.000Z', dateKind: 'modified' }])
  })

  it('404/410 is not fresh; a page that could not be judged keeps its STORED row as undetermined', () => {
    const r = scene([
      { slug: 'gone', ago: DAY, out: { kind: 'gone', status: 404 } },
      { slug: 'timeout', ago: DAY, out: { kind: 'undetermined', why: 'fetchError' } },
      { slug: 'unstored-5xx', ago: DAY, out: { kind: 'undetermined', why: 'http503' } },
      { slug: 'stored-fresh', ago: DAY, out: rec('500') },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.set.items.map((i) => i.externalId)).toEqual(['honeycomb:500'])
    expect(r.set.unknown).toEqual(['honeycomb:600'])
    expect(r.counts).toMatchObject({ gone: 1, undetermined: 2, unknownStored: 1, unresolved: 1 })
  })

  it('a url with no readable lastmod, or one dated after the fetch, is undetermined — never fresh, never silently old', () => {
    const r = scene([
      { slug: 'no-date', ago: null, lastmod: null },
      { slug: 'future', ago: -2 * DAY, out: rec('900') },
      { slug: 'stored-fresh', ago: DAY, out: rec('500') },
    ])
    expect(r.ok && r.set.unknown).toEqual(['honeycomb:700', 'honeycomb:900'])
    expect(r.ok && r.counts).toMatchObject({ noDate: 1, future: 1 })
  })

  it('two urls naming one post: one item, at the OLDER date; a post fresh under one url is not also undetermined', () => {
    const r = scene([
      { slug: 'alias-a', ago: DAY, out: rec('42') },
      { slug: 'alias-b', ago: 3 * DAY, out: rec('42') },
      { slug: 'alias-c', ago: -3 * DAY, out: rec('42') },
    ])
    expect(r.ok && r.set.items).toEqual([{ externalId: 'honeycomb:42', sourceDate: iso(Math.floor((FETCHED - 3 * DAY) / 1000) * 1000), dateKind: 'modified' }])
    expect(r.ok && r.set.unknown).toEqual([])
  })

  it('⛔ overlapping pages are refused: a url listed twice can stand in for one never listed', () => {
    const r = scene([{ slug: 'a', ago: DAY, out: rec('1') }], { entries: [{ url: url('a'), lastmod: vnStamp(FETCHED - DAY) }] })
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/pages overlap/) })
  })
  it('an empty window is a valid (empty) set — the expiry, not this step, decides whether that is believable', () => {
    const r = scene([])
    expect(r.ok && r.set.items).toEqual([])
  })

  it('⛔ end to end at the 30-day window: a flat touched 20 days ago is in the set and KEPT; 31 days ago, EXPIRED', () => {
    const stored = [
      { externalId: 'honeycomb:500', affiliateUrl: url('twenty-days') },
      { externalId: 'honeycomb:501', affiliateUrl: url('edge-in') },
      { externalId: 'honeycomb:502', affiliateUrl: url('edge-out') },
      { externalId: 'honeycomb:503', affiliateUrl: url('month-old') },
      { externalId: 'honeycomb:504', affiliateUrl: url('nine-days') },
    ]
    const r = scene([
      { slug: 'twenty-days', ago: 20 * DAY, out: rec('500') },
      { slug: 'nine-days', ago: 9 * DAY, out: rec('504') },
      // 29 d 23 h at the fetch: inside; 30 d + 1 min: outside (no page read needed — it is not in the window).
      { slug: 'edge-in', ago: W * DAY - 3_600_000, out: rec('501') },
      { slug: 'edge-out', ago: W * DAY + 60_000 },
      { slug: 'month-old', ago: (W + 1) * DAY },
    ], { stored })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // ⛔ The trap the window must not fall into: an 8–30-day-old url judged by the 7-day default counts as
    // "future" and is kept live as undetermined. Here every one is judged — none future, none undetermined.
    expect(r.counts).toMatchObject({ inWindow: 3, items: 3, future: 0, undetermined: 0 })
    expect(r.set.unknown).toEqual([])
    expect(r.set.items.map((i) => i.externalId).sort()).toEqual(['honeycomb:500', 'honeycomb:501', 'honeycomb:504'])
    expect(freshSetProblem(JSON.parse(JSON.stringify(r.set)), NOW, HONEYCOMB_SELLER_ID)).toBeNull()
    // The expiry as the weekly job runs it: Honeycomb is a ROLLING seller, so the carry-over guard reads each
    // live row's postedAt — the lastmod the apply wrote — against the window's start at the fetch.
    const ago: Record<string, number> = {
      'honeycomb:500': 20 * DAY, 'honeycomb:501': W * DAY - 3_600_000, 'honeycomb:502': W * DAY + 60_000, 'honeycomb:503': (W + 1) * DAY, 'honeycomb:504': 9 * DAY,
    }
    const active = stored.map((x) => ({ id: `L-${x.externalId}`, externalId: x.externalId, postedAt: new Date(FETCHED - ago[x.externalId]) }))
    const rollingFrom = rollingWindowFrom(HONEYCOMB_SELLER_ID, r.set.fetchedAt)
    expect(rollingFrom).toBe(FETCHED - W * DAY)
    const plan = planExpiry({ active, fresh: new Set(r.set.items.map((i) => i.externalId)), unknown: new Set(r.set.unknown), baseline: null, rollingFrom })
    expect(plan.refusal).toBeNull()
    expect(plan.expire.sort()).toEqual(['L-honeycomb:502', 'L-honeycomb:503'])
    expect(plan.keep).toBe(3)
    // The three rows still dated inside the window are all in the set; the two that aged out are not counted.
    expect(plan.carry).toEqual({ dated: 3, missing: 0 })
  })

  describe('⛔ refuses — and writes nothing — unless the read provably covered the window', () => {
    const fresh: Row[] = [{ slug: 'stored-fresh', ago: DAY, out: rec('500') }]
    const maps7 = (f: (m: SitemapFileRead, i: number) => SitemapFileRead) =>
      Array.from({ length: 7 }, (_, i) => f({ url: `https://honeycomb.com.vn/wp-sitemap-posts-estate_property-${i + 1}.xml`, status: 200, urls: i < 6 ? 2000 : 822, kept: i < 6 ? 2000 : 822, closed: true, cache: 'miss' }, i))
    it('⛔ a sitemap body cut off before </urlset>, a short middle page, or a full last page (a stale index)', () => {
      expect(scene(fresh, { maps: maps7((m) => m) }).ok).toBe(true)
      expect(scene(fresh, { maps: maps7((m, i) => (i === 2 ? { ...m, closed: false } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/-3\.xml → body does not end with <\/urlset>/) })
      expect(scene(fresh, { maps: maps7((m, i) => (i === 4 ? { ...m, urls: 1999, kept: 1999 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/-5\.xml holds 1999 — a page was cut short/) })
      expect(scene(fresh, { maps: maps7((m, i) => (i === 6 ? { ...m, urls: 2000, kept: 2000 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/as many as a full page \(2000\) — the index may be stale/) })
    })
    it('⛔ pages 1…N−1 hold EXACTLY 2000 — a short page 1 does not set the bar for the rest', () => {
      // Every page before the last cut to the same 1,500 used to pass ("the same full count" as page 1).
      expect(scene(fresh, { maps: maps7((m, i) => (i < 6 ? { ...m, urls: 1500, kept: 1500 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/must each hold exactly 2000 urls.*-1\.xml holds 1500, -2\.xml holds 1500/) })
      expect(scene(fresh, { maps: maps7((m, i) => (i < 6 ? { ...m, urls: 2500, kept: 2500 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/the page size changed/) })
    })
    it('⛔ a sitemap file served from the LiteSpeed page cache (x-litespeed-cache: hit) — the index or any page', () => {
      expect(scene(fresh, { indexCache: 'hit' })).toMatchObject({ ok: false, reason: expect.stringMatching(/1 sitemap file\(s\) came from the LiteSpeed page cache .*\/wp-sitemap\.xml \(hit\)/) })
      expect(scene(fresh, { maps: maps7((m, i) => (i === 3 ? { ...m, cache: 'hit,private' } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/-4\.xml \(hit,private\)/) })
      // No page cache in front (no header) is not a hit.
      const none = scene(fresh, { indexCache: null, maps: maps7((m) => ({ ...m, cache: null })) })
      expect(none.ok && none.set.coverage).toMatch(/x-litespeed-cache: index none · -1\.xml none/)
    })
    it('a sitemap that failed, came back empty, or is missing from the index', () => {
      expect(scene(fresh, { maps: maps7((m, i) => (i === 3 ? { ...m, status: 503, urls: 0, kept: 0 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/1 of 7 .*-4\.xml → HTTP 503/) })
      expect(scene(fresh, { maps: maps7((m, i) => (i === 6 ? { ...m, urls: 0, kept: 0 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/200 with no urls/) })
      expect(scene(fresh, { maps: maps7((m) => m).filter((_, i) => i !== 2) })).toMatchObject({ ok: false, reason: expect.stringMatching(/missing/) })
      expect(scene(fresh, { maps: [] })).toMatchObject({ ok: false, reason: expect.stringMatching(/no estate_property/) })
      expect(scene(fresh, { entries: [] })).toMatchObject({ ok: false, reason: expect.stringMatching(/no property url/) })
    })
    it('urls the importer cannot accept — the url shape changed', () => {
      expect(scene(fresh, { maps: maps7((m, i) => (i === 0 ? { ...m, kept: 1800 } : m)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/url shape changed/) })
    })
    it('--limit, a stopped read, a detail window that starts inside the 30 days', () => {
      expect(scene(fresh, { limit: 30 })).toMatchObject({ ok: false, reason: expect.stringMatching(/--limit/) })
      expect(scene(fresh, { stopped: 'answered 429' })).toMatchObject({ ok: false, reason: expect.stringMatching(/stopped early: answered 429/) })
      expect(scene(fresh, { detailSinceMs: FETCHED - W * DAY + 1 })).toMatchObject({ ok: false, reason: expect.stringMatching(/not read/) })
      expect(scene(fresh, { detailSinceMs: FETCHED - W * DAY }).ok).toBe(true)
      // ⛔ A 7-day detail read (the old weekly stage) cannot write a 30-day set: urls 8–30 days old were never read.
      expect(scene(fresh, { detailSinceMs: Date.parse('2026-09-24T00:00:00+07:00') })).toMatchObject({ ok: false, reason: expect.stringMatching(/pages inside the window were not read/) })
    })
    it('an in-window url whose page was never requested', () => {
      expect(scene([...fresh, { slug: 'skipped', ago: 2 * DAY }])).toMatchObject({ ok: false, reason: expect.stringMatching(/1 url\(s\) in the window were never read/) })
    })
    it(`a site-wide re-save: over ${BULK_RESAVE_MAX_SHARE * 100}% of ALL property urls modified in the window`, () => {
      // Of the full 12,822 urls: 3,300 in the window is over 25%, 3,100 is under.
      const many: Row[] = Array.from({ length: 3300 }, (_, i) => ({ slug: `bulk-${i}`, ago: DAY, out: rec(String(1000 + i)) }))
      expect(scene(many)).toMatchObject({ ok: false, reason: expect.stringMatching(/site-wide re-save/) })
      expect(scene(many.slice(0, 3100)).ok).toBe(true)
    })
    it('too many undetermined — the set fails its own freshSetProblem check', () => {
      const stored = Array.from({ length: 10 }, (_, i) => ({ externalId: `honeycomb:${2000 + i}`, affiliateUrl: url(`t${i}`) }))
      const rows: Row[] = stored.map((_, i) => ({ slug: `t${i}`, ago: DAY, out: { kind: 'undetermined', why: 'fetchError' } as DetailOutcome }))
      expect(scene([...rows, ...fresh], { stored })).toMatchObject({ ok: false, reason: expect.stringMatching(/fails its own check: .*undetermined/) })
    })
    it('a set that is already over a day old', () => {
      expect(scene(fresh, { now: FETCHED + 25 * 3_600_000 })).toMatchObject({ ok: false, reason: expect.stringMatching(/fails its own check: .*h old/) })
    })

    /** `n` in-window urls whose pages answered 404/410, and `k` whose pages were read to a post. */
    const goneRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ slug: `g${i}`, ago: (2 + i) * DAY, out: { kind: 'gone', status: i % 2 ? 410 : 404 } as DetailOutcome }))
    const readRows = (k: number): Row[] => Array.from({ length: k }, (_, i) => ({ slug: `ok${i}`, ago: (3 + i) * DAY, out: rec(String(3000 + i)) }))
    it(`⛔ the in-window pages mostly answering 404/410 (from ${GONE_MIN_URLS}, over ${GONE_MAX_SHARE * 100}%) — the sitemap lists them as published: a site fault, not the market`, () => {
      expect([GONE_MIN_URLS, GONE_MAX_SHARE]).toEqual([3, 0.5])
      // The reproduced 2026-10-02 case: every in-window /property/ page 404 (a WordPress rewrite fault).
      expect(scene(goneRows(6))).toMatchObject({ ok: false, reason: expect.stringMatching(/^6 of the 6 sitemap urls in the window answered 404\/410 — over 50% of pages the sitemap lists as published/) })
      expect(scene([...goneRows(3), ...readRows(2)])).toMatchObject({ ok: false, reason: expect.stringMatching(/^3 of the 5 sitemap urls in the window/) })
      expect(scene([...goneRows(4), ...readRows(3)])).toMatchObject({ ok: false, reason: expect.stringMatching(/^4 of the 7/) })
      // Half or fewer, or under three: judged gone as before, and the set is written.
      const half = scene([...goneRows(3), ...readRows(3)])
      expect(half.ok && half.counts).toMatchObject({ inWindow: 6, gone: 3, items: 3 })
      const two = scene(goneRows(2))
      expect(two.ok && two.counts).toMatchObject({ inWindow: 2, gone: 2, items: 0 })
      expect(inWindowGoneProblem(0, 0)).toBeNull()
      expect(inWindowGoneProblem(2, 2)).toBeNull()
      expect(inWindowGoneProblem(3, 6)).toBeNull()
      expect(inWindowGoneProblem(3, 5)).toMatch(/3 of the 5/)
      expect(inWindowGoneProblem(31, 31)).toMatch(/31 of the 31/)
    })
  })

  it('⛔ end to end, the 404 fault (review of 2026-10-02): no set is written — and the set that read would have made is refused by the expiry too', () => {
    // 24 live apartment rows: 6 re-touched inside the 30 days, 18 aged out; every in-window page now answers 404.
    const insideAges = [2, 5, 9, 14, 20, 29].map((d) => d * DAY)
    const stored = [
      ...insideAges.map((_, i) => ({ externalId: `honeycomb:${4000 + i}`, affiliateUrl: url(`in-${i}`) })),
      ...Array.from({ length: 18 }, (_, i) => ({ externalId: `honeycomb:${5000 + i}`, affiliateUrl: url(`old-${i}`) })),
    ]
    const r = scene(insideAges.map((ago, i) => ({ slug: `in-${i}`, ago, out: { kind: 'gone', status: 404 } as DetailOutcome })), { stored })
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/6 of the 6 sitemap urls in the window answered 404\/410/) })
    // Without that guard the read gives 0 items and 0 undetermined — what used to expire all 24.
    const set = makeFreshSet(HONEYCOMB_SELLER_ID, new Date(FETCHED), 'the same read', [], [], W)
    expect(freshSetProblem(JSON.parse(JSON.stringify(set)), NOW, HONEYCOMB_SELLER_ID)).toBeNull()
    const active = stored.map((x, i) => ({ id: `L${i}`, externalId: x.externalId, postedAt: new Date(FETCHED - (i < 6 ? insideAges[i] : (31 + i) * DAY)) }))
    const plan = planExpiry({ active, fresh: new Set(), unknown: new Set(set.unknown), baseline: 31, knownInDb: 0, rollingFrom: rollingWindowFrom(HONEYCOMB_SELLER_ID, set.fetchedAt) })
    expect(plan.carry).toEqual({ dated: 6, missing: 6 })
    expect(plan.refusal).toMatch(/6 of the 6 live rows last seen dated inside the window .* are missing from the set — 60% or more of them gone in one read reads as a source fault/)
  })
})

describe('datePlan — revival and postedAt at --apply', () => {
  const base = { postedAt: new Date(FETCHED - 30 * DAY), fetchedAt: FETCHED, now: NOW, trusted: true }
  const fresh = vnStamp(FETCHED - 2 * DAY)
  const freshDate = new Date(Math.floor((FETCHED - 2 * DAY) / 1000) * 1000)

  it("revives 'expired' and 'stale' when the lastmod is in the window, and moves postedAt to it", () => {
    expect(datePlan({ ...base, status: 'expired', lastmod: fresh })).toEqual({ revive: true, postedAt: freshDate })
    expect(datePlan({ ...base, status: 'stale', lastmod: fresh })).toEqual({ revive: true, postedAt: freshDate })
  })
  it("⛔ never revives 'hidden', 'removed', 'sold' — and leaves a 'removed' tombstone's dates alone too", () => {
    expect(datePlan({ ...base, status: 'hidden', lastmod: fresh })).toEqual({ revive: false, postedAt: freshDate })
    expect(datePlan({ ...base, status: 'sold', lastmod: fresh })).toEqual({ revive: false, postedAt: freshDate })
    expect(datePlan({ ...base, status: 'active', lastmod: fresh })).toEqual({ revive: false, postedAt: freshDate })
    expect(datePlan({ ...base, status: 'removed', lastmod: fresh })).toBe(NO_DATE_CHANGE)
  })
  it('an update moves postedAt only FORWARD and only to a lastmod INSIDE the window; an unchanged date is not a change', () => {
    // ⛔ Outside the window nothing moves: the bulk re-save guard measures the window only, so an older
    // site-wide re-save would otherwise re-date (and re-rank) the whole catalogue through a 90-day apply.
    const older = { ...base, postedAt: new Date(FETCHED - 60 * DAY) }
    const outside = vnStamp(FETCHED - (W + 1) * DAY)
    expect(datePlan({ ...older, status: 'active', lastmod: outside })).toEqual(NO_DATE_CHANGE)
    expect(datePlan({ ...older, status: 'expired', lastmod: outside })).toEqual(NO_DATE_CHANGE)
    const sixDays = vnStamp(FETCHED - 6 * DAY)
    expect(datePlan({ ...base, status: 'active', lastmod: sixDays })).toEqual({ revive: false, postedAt: new Date(Math.floor((FETCHED - 6 * DAY) / 1000) * 1000) })
    expect(datePlan({ ...base, status: 'active', postedAt: freshDate, lastmod: vnStamp(FETCHED - 20 * DAY) })).toEqual(NO_DATE_CHANGE)
    expect(datePlan({ ...base, status: 'active', postedAt: freshDate, lastmod: fresh })).toEqual(NO_DATE_CHANGE)
  })
  it("⛔ an 'expired' flat touched 8–30 days ago comes back (the 7-day rule had taken it down) at its source date", () => {
    for (const days of [8, 10, 20, 29]) {
      const d = vnStamp(FETCHED - days * DAY)
      const at = new Date(Math.floor((FETCHED - days * DAY) / 1000) * 1000)
      expect(datePlan({ ...base, postedAt: new Date(FETCHED - 60 * DAY), status: 'expired', lastmod: d }), `${days} d`).toEqual({ revive: true, postedAt: at })
      // A live row's postedAt moves forward to it too.
      expect(datePlan({ ...base, postedAt: new Date(FETCHED - 60 * DAY), status: 'active', lastmod: d }), `${days} d`).toEqual({ revive: false, postedAt: at })
    }
  })
  it('a revival takes the source date even when the stored one is newer (postedAt = the source date)', () => {
    expect(datePlan({ ...base, status: 'expired', postedAt: new Date(FETCHED), lastmod: fresh })).toEqual({ revive: true, postedAt: freshDate })
    expect(datePlan({ ...base, status: 'expired', postedAt: freshDate, lastmod: fresh })).toEqual({ revive: true, postedAt: null })
  })
  it('⛔ the window is judged at the FETCH, as the fresh set judges it — not at the apply\'s now', () => {
    // 29 d 23 h old at the fetch, past 30 d by the time the apply runs an hour later: in the set, so revived.
    const edge = vnStamp(FETCHED - W * DAY + 3_600_000)
    const r = datePlan({ ...base, now: FETCHED + 2 * 3_600_000, status: 'expired', lastmod: edge })
    expect(r.revive).toBe(true)
    // 30 d + 1 s old at the fetch: not in the set, never revived — however early the apply.
    expect(datePlan({ ...base, now: FETCHED, status: 'expired', lastmod: vnStamp(FETCHED - W * DAY - 1000) }).revive).toBe(false)
  })
  it('⛔ no revival on evidence older than a fresh set may be (24 h) — the newer date still moves', () => {
    const sixDays = vnStamp(FETCHED - 6 * DAY)
    expect(datePlan({ ...base, now: FETCHED + 24 * 3_600_000, status: 'expired', lastmod: sixDays }).revive).toBe(true)
    expect(datePlan({ ...base, now: FETCHED + 24 * 3_600_000 + 1, status: 'expired', lastmod: sixDays }))
      .toEqual({ revive: false, postedAt: new Date(Math.floor((FETCHED - 6 * DAY) / 1000) * 1000) })
  })
  it('⛔ nothing when lastmod is not trusted this run, unreadable, or after the fetch (a broken clock, not a re-post)', () => {
    expect(datePlan({ ...base, trusted: false, status: 'expired', lastmod: fresh })).toBe(NO_DATE_CHANGE)
    expect(datePlan({ ...base, status: 'expired', lastmod: null })).toBe(NO_DATE_CHANGE)
    expect(datePlan({ ...base, status: 'expired', lastmod: '2026-09-30T10:00:00' })).toBe(NO_DATE_CHANGE)
    expect(datePlan({ ...base, status: 'expired', lastmod: vnStamp(FETCHED + DAY) })).toBe(NO_DATE_CHANGE)
  })
  it('a lastmod within the clock skew after now is clamped to now, never later', () => {
    const r = datePlan({ ...base, now: FETCHED, status: 'expired', lastmod: vnStamp(FETCHED + 60_000) })
    expect(r).toEqual({ revive: true, postedAt: new Date(FETCHED) })
  })
})

describe('datedRollbackSql', () => {
  const e = { id: 'cmabc123', externalId: 'honeycomb:1', oldStatus: 'expired', oldPostedAt: '2026-08-01T00:00:00.000Z', oldRankScore: 0.41, revive: true, newPostedAt: '2026-09-29T03:00:00.000Z', newRankScore: 0.52 }
  const TOMB = `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY['eno:isrtag:_N_T_/en/listings/cmabc123','eno:isrtag:_N_T_/vi/listings/cmabc123']) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
  it('puts back status, postedAt and rankScore only while the row still holds what the run wrote — then tombstones the page', () => {
    expect(datedRollbackSql(e, HONEYCOMB_SELLER_ID)).toBe(
      `UPDATE "Listing" SET "postedAt" = '2026-08-01T00:00:00.000Z', "rankScore" = 0.41, status = 'expired' WHERE id = 'cmabc123' AND "sellerId" = 'honeycomb-import-seller-0001' AND "postedAt" = '2026-09-29T03:00:00.000Z' AND status = 'active';\n${TOMB}`)
    expect(datedRollbackSql({ ...e, revive: false }, HONEYCOMB_SELLER_ID)).toBe(
      `UPDATE "Listing" SET "postedAt" = '2026-08-01T00:00:00.000Z', "rankScore" = 0.41 WHERE id = 'cmabc123' AND "sellerId" = 'honeycomb-import-seller-0001' AND "postedAt" = '2026-09-29T03:00:00.000Z';\n${TOMB}`)
    // A revival that left postedAt alone is guarded on that postedAt too: a later re-date is not undone.
    expect(datedRollbackSql({ ...e, newPostedAt: null, newRankScore: null }, HONEYCOMB_SELLER_ID)).toBe(
      `UPDATE "Listing" SET status = 'expired' WHERE id = 'cmabc123' AND "sellerId" = 'honeycomb-import-seller-0001' AND "postedAt" = '2026-08-01T00:00:00.000Z' AND status = 'active';\n${TOMB}`)
    expect(datedRollbackSql({ ...e, revive: false, newPostedAt: null }, HONEYCOMB_SELLER_ID)).toBe('')
  })
  it('pdpTombstoneSql: both languages per id, quotes escaped, a non-id refused, nothing for no ids', () => {
    expect(pdpTombstoneSql(['cmabc123'])).toBe(TOMB)
    expect(pdpTombstoneSql(['a1', 'b2'])).toContain(`ARRAY['eno:isrtag:_N_T_/en/listings/a1','eno:isrtag:_N_T_/vi/listings/a1','eno:isrtag:_N_T_/en/listings/b2','eno:isrtag:_N_T_/vi/listings/b2']`)
    expect(() => pdpTombstoneSql(["x'y"])).toThrow(/id/)
    expect(pdpTombstoneSql([])).toBe('')
  })
  it('⛔ refuses a value that could not have come from the database, instead of writing it into SQL', () => {
    expect(() => datedRollbackSql({ ...e, id: "x'; drop table" }, HONEYCOMB_SELLER_ID)).toThrow(/id/)
    expect(() => datedRollbackSql({ ...e, oldStatus: 'hidden' }, HONEYCOMB_SELLER_ID)).toThrow(/status/)
    expect(() => datedRollbackSql({ ...e, oldPostedAt: 'garbage' }, HONEYCOMB_SELLER_ID)).toThrow(/date/)
    expect(() => datedRollbackSql({ ...e, oldRankScore: NaN }, HONEYCOMB_SELLER_ID)).toThrow(/rankScore/)
    expect(() => datedRollbackSql(e, "s' or 1=1")).toThrow(/seller/)
  })
})

describe('the weekly run’s flags', () => {
  it('--since-days is a whole number of days', () => {
    expect(parseSinceDays('7')).toBe(7)
    expect(parseSinceDays(' 90 ')).toBe(90)
    for (const bad of ['0', '-7', '7.5', '7d', '', '99999', null]) expect(parseSinceDays(bad), String(bad)).toBeNull()
  })
  it('⛔ --fresh-out only on a run that reads the whole window of the live site', () => {
    const ok = { freshOut: '/Users/x/fresh.json', src: null, apply: false, limit: 0, sinceDays: W, sinceMs: NOW - W * DAY, now: NOW }
    expect(freshOutPreflight(ok)).toBeNull()
    expect(freshOutPreflight({ ...ok, freshOut: null, limit: 5, sinceDays: null })).toBeNull()
    expect(freshOutPreflight({ ...ok, src: 'staged.json' })).toMatch(/READS the site/)
    expect(freshOutPreflight({ ...ok, apply: true })).toMatch(/READS the site/)
    expect(freshOutPreflight({ ...ok, limit: 30 })).toMatch(/--limit/)
    expect(freshOutPreflight({ ...ok, sinceMs: NOW - W * DAY + 1 })).toMatch(/--since-days 30/)
  })
  it("⛔ --fresh-out needs --since-days 30 (Honeycomb's window): a plain --since (or the default 90 days) stage records no exact window for its apply", () => {
    const ok = { freshOut: '/Users/x/fresh.json', src: null, apply: false, limit: 0, sinceDays: W, sinceMs: NOW - (W + 1) * DAY, now: NOW }
    expect(freshOutPreflight(ok)).toBeNull()
    // --since 2026-08-01 (or no window flag at all): covers the 30 days, but the apply would create 60-day-old ads.
    expect(freshOutPreflight({ ...ok, sinceDays: null, sinceMs: NOW - 60 * DAY })).toMatch(/needs --since-days 30 \(not --since, not the default window\)/)
    expect(freshOutPreflight({ ...ok, sinceDays: null, sinceMs: NOW - 90 * DAY })).toMatch(/needs --since-days 30/)
    expect(freshOutPreflight({ ...ok, sinceDays: 31, sinceMs: NOW - 32 * DAY })).toMatch(/needs --since-days 30 \(not 31\)/)
    expect(freshOutPreflight({ ...ok, sinceDays: 29 })).toMatch(/not 29/)
    // ⛔ The old weekly stage (--since-days 7) is refused: its set would be refused by the expiry anyway.
    expect(freshOutPreflight({ ...ok, sinceDays: FRESH_DAYS, sinceMs: NOW - 8 * DAY })).toMatch(/needs --since-days 30 \(not 7\)/)
  })
  it('⛔ an unknown flag is refused — a misspelt --fresh-out must not exit 0 with no set', () => {
    expect(unknownFlagProblem(['--since-days', '7', '--save', 's.json', '--fresh-out', 'f.json'])).toBeNull()
    expect(unknownFlagProblem(['--src', 's.json', '--apply', '--journal-dir', '/j', '--retire'])).toBeNull()
    expect(unknownFlagProblem(['--verify'])).toBeNull()
    expect(unknownFlagProblem(['--fresh-outt', 'f.json'])).toMatch(/unknown flag "--fresh-outt"/)
    expect(unknownFlagProblem(['--since-day', '7'])).toMatch(/unknown flag/)
    expect(unknownFlagProblem(['--save', 's.json', 'extra'])).toMatch(/unexpected argument "extra"/)
  })
})

describe('⛔ the sitemap pages as read: closed bodies, full pages, a short last page', () => {
  const MAP = 'https://honeycomb.com.vn/wp-sitemap-posts-estate_property-1.xml'
  const body = (n: number, tail = '</urlset>\n') => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    Array.from({ length: n }, (_, i) => `<url><loc>https://honeycomb.com.vn/property/p-${i}/</loc><lastmod>2026-09-17T16:24:25+07:00</lastmod></url>`).join('')}${tail}`
  it('sitemapBodyClosed: ends with </urlset> (whitespace or a cache comment after it is fine) — a cut-off body is not', () => {
    expect(sitemapBodyClosed(body(3))).toBe(true)
    expect(sitemapBodyClosed(body(3, '</urlset>\n<!-- Page cached by LiteSpeed -->\n'))).toBe(true)
    expect(sitemapBodyClosed(body(3, ''))).toBe(false)
    expect(sitemapBodyClosed(body(3).slice(0, -40))).toBe(false)
    expect(sitemapBodyClosed(body(3, '</urlset><url>'))).toBe(false)
  })
  it('sitemapFileRead: a truncated 200 parses to fewer urls AND says it is not closed', () => {
    const whole = sitemapFileRead(MAP, { status: 200, body: Buffer.from(body(3)) })
    expect(whole.read).toEqual({ url: MAP, status: 200, urls: 3, kept: 3, closed: true, cache: null })
    expect(whole.entries.map((e) => e.url)).toEqual([0, 1, 2].map((i) => `https://honeycomb.com.vn/property/p-${i}/`))
    const cut = sitemapFileRead(MAP, { status: 200, body: Buffer.from(body(3).slice(0, -60)) }) // mid-way through the 3rd <url>
    expect(cut.read).toMatchObject({ urls: 2, closed: false })
    expect(sitemapFileRead(MAP, { status: 503, body: Buffer.from(body(3)) })).toEqual({ read: { url: MAP, status: 503, urls: 0, kept: 0, closed: false, cache: null }, entries: [] })
    // The header is recorded per file, on any status; the CANONICAL url is what is reported.
    expect(sitemapFileRead(MAP, { status: 200, body: Buffer.from(body(3)), litespeedCache: 'miss' }).read).toMatchObject({ url: MAP, cache: 'miss' })
    expect(sitemapFileRead(MAP, { status: 503, body: Buffer.from(''), litespeedCache: 'hit' }).read).toMatchObject({ cache: 'hit' })
    const offShape = sitemapFileRead(MAP, { status: 200, body: Buffer.from(body(1).replace('</urlset>', '<url><loc>https://honeycomb.com.vn/agent/x/</loc></url></urlset>')) })
    expect(offShape.read).toMatchObject({ urls: 2, kept: 1 })
  })
  const m = (n: number, urls: number): SitemapFileRead => ({ url: `https://honeycomb.com.vn/wp-sitemap-posts-estate_property-${n}.xml`, status: 200, urls, kept: urls, closed: true, cache: 'miss' })
  it('sitemapReadProblem: the measured shape passes; a single page must be under a full one', () => {
    expect(sitemapReadProblem([1, 2, 3, 4, 5, 6].map((n) => m(n, 2000)).concat(m(7, 822)))).toBeNull()
    expect(sitemapReadProblem([m(2, 822), m(1, 2000)])).toBeNull()
    expect(sitemapReadProblem([m(1, 12)])).toBeNull()
    expect(sitemapReadProblem([m(1, WP_SITEMAP_MAX_URLS)])).toMatch(/the only estate_property sitemap holds 2000 urls/)
    expect(sitemapReadProblem([m(1, 2000), m(2, 2000)])).toMatch(/-2\.xml\) holds 2000 urls, as many as a full page/)
    expect(sitemapReadProblem([m(1, 2000), m(2, 1999), m(3, 5)])).toMatch(/-2\.xml holds 1999/)
    expect(sitemapReadProblem([m(1, 2000), { ...m(2, 5), status: 200, urls: 0, kept: 0 }])).toMatch(/200 with no urls/)
    expect(sitemapReadProblem([m(1, 2000), m(3, 5)])).toMatch(/missing/)
  })
  it(`⛔ sitemapReadProblem: pages 1…N−1 hold EXACTLY ${WP_SITEMAP_MAX_URLS}, measured — not page 1's own count`, () => {
    // These passed while page 1 set the bar: every page before the last cut short by the same amount.
    expect(sitemapReadProblem([m(1, 1999), m(2, 1999), m(3, 5)])).toMatch(/must each hold exactly 2000 urls .*-1\.xml holds 1999, -2\.xml holds 1999/)
    expect(sitemapReadProblem([m(1, 1500), m(2, 1400)])).toMatch(/-1\.xml holds 1500 — a page was cut short/)
    // A bigger page size (a filter on wp_sitemaps_max_urls) fails closed until it is measured again.
    expect(sitemapReadProblem([m(1, 2500), m(2, 10)])).toMatch(/-1\.xml holds 2500 — a page was cut short, or the page size changed/)
    expect(sitemapReadProblem([m(1, 2000), m(2, 1999)])).toBeNull()
    expect(sitemapReadProblem([m(1, 2000), m(2, 2001)])).toMatch(/as many as a full page \(2000\)/)
  })
})

describe('⛔ the detail read: every page requested gets an outcome', () => {
  const U = (s: string) => `https://honeycomb.com.vn/property/${s}/`
  /** Trimmed from the page fixture in honeycomb-listing.test.ts (post 317878, as served 2026-09-24). */
  const page = (id: string) => `<!DOCTYPE html><html><head><link rel='shortlink' href='https://honeycomb.com.vn/?p=${id}' /></head>
<body class="single single-estate_property postid-${id}"><div id="prop_categs" class="property_categs"><a href="https://honeycomb.com.vn/properties/apartments-for-rent-in-hcmc/" rel="tag">Apartments</a> / </div>
<h1 class="entry-title entry-prop">Cozy furnished apartment</h1>
<div class="listing_detail col-md-12"><strong>Address:</strong> An Phu Ward, District 2, HCMC</div>
<div class="listing_detail col-md-6" id="propertyid_display"><strong>Property Id:</strong> ${id}</div><div class="listing_detail col-md-6"><strong>Price:</strong> $ 2,692 </div><div class="listing_detail col-md-6"><strong>Bedrooms:</strong> 3</div><div class="listing_detail col-md-6"><strong>District:</strong> 2</div>
<div id="owl-demo" class="owl-carousel owl-theme"><div class="item" style="background-image:url(https://honeycomb.com.vn/wp-content/uploads/2026/09/EH-17-1110x640.jpg)"></div></div>
</body></html>`
  const got = (url: string, status: number, body = '', over: Partial<Got> = {}): Got => ({ status, finalUrl: url, body: Buffer.from(body), type: 'text/html', refusedRedirect: null, ...over })
  const e = (s: string): SitemapEntry => ({ url: U(s), lastmod: '2026-09-30T10:00:00+07:00' })

  it('classifyDetailPage: a record, gone (404/410), and every way a page goes undetermined', () => {
    const ok = classifyDetailPage(e('a'), got(U('a'), 200, page('317878')))
    expect(ok.outcome).toEqual({ kind: 'record', postId: '317878' })
    expect(ok.record).toMatchObject({ postId: '317878', url: U('a'), lastmod: '2026-09-30T10:00:00+07:00' })
    expect(classifyDetailPage(e('a'), got(U('a'), 404)).outcome).toEqual({ kind: 'gone', status: 404 })
    expect(classifyDetailPage(e('a'), got(U('a'), 410)).outcome).toEqual({ kind: 'gone', status: 410 })
    expect(classifyDetailPage(e('a'), got(U('a'), 503)).outcome).toEqual({ kind: 'undetermined', why: 'http503' })
    expect(classifyDetailPage(e('a'), got(U('a'), 301, '', { refusedRedirect: 'off-site' })).outcome).toEqual({ kind: 'undetermined', why: 'redirectRefused' })
    expect(classifyDetailPage(e('a'), got(U('b'), 200, page('1'))).outcome).toEqual({ kind: 'undetermined', why: 'redirected' })
    expect(classifyDetailPage(e('a'), got(U('a'), 200, '<html>nothing</html>')).outcome).toMatchObject({ kind: 'undetermined' })
  })

  it('readDetailPages: an outcome for every page requested, a fetch error included; nothing is skipped', async () => {
    const batch = ['rec', 'gone', 'err', '5xx'].map(e)
    const asked: string[] = []
    const r = await readDetailPages(batch, async (url) => {
      asked.push(url)
      if (url === U('rec')) return got(url, 200, page('42'))
      if (url === U('gone')) return got(url, 404)
      if (url === U('err')) throw new Error('ECONNRESET')
      return got(url, 502)
    })
    expect(asked).toEqual(batch.map((b) => b.url))
    expect([...r.detail.keys()]).toEqual(asked)
    expect(r.detail.get(U('rec'))).toEqual({ kind: 'record', postId: '42' })
    expect(r.detail.get(U('err'))).toEqual({ kind: 'undetermined', why: 'fetchError' })
    expect(r).toMatchObject({ read: 3, stopped: null, drop: { gone: 1, fetchError: 1, http502: 1 } })
    expect(r.records.map((x) => x.postId)).toEqual(['42'])
  })

  it('⛔ an Infeasible (429 / challenge) ends the read there: no outcome for it, nothing after it requested, `stopped` set', async () => {
    const batch = ['a', 'b', 'c'].map(e)
    const asked: string[] = []
    const r = await readDetailPages(batch, async (url) => {
      asked.push(url)
      if (url === U('b')) throw new Infeasible(`${url} answered 429`)
      return got(url, 200, page('7'))
    })
    expect(asked).toEqual([U('a'), U('b')])
    expect([...r.detail.keys()]).toEqual([U('a')])
    expect(r.stopped).toMatch(/answered 429/)
    // …and a stopped read can never become a fresh set.
    expect(buildHoneycombFreshSet({
      fetchedAt: new Date(FETCHED), now: NOW, entries: batch, detail: r.detail, detailSinceMs: FETCHED - 8 * DAY, limit: 0, stopped: r.stopped, stored: [],
      maps: [{ url: 'https://honeycomb.com.vn/wp-sitemap-posts-estate_property-1.xml', status: 200, urls: 3, kept: 3, closed: true, cache: 'miss' }], indexCache: 'miss',
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/stopped early/) })
  })
})

describe('⛔ the LiteSpeed page cache: sitemaps requested cache-busted, a hit refuses the set', () => {
  const MAP = (n: number) => `https://honeycomb.com.vn/wp-sitemap-posts-estate_property-${n}.xml`
  const read = (n: number, cache: string | null): SitemapFileRead => ({ url: MAP(n), status: 200, urls: n === 2 ? 822 : 2000, kept: n === 2 ? 822 : 2000, closed: true, cache })
  it('cacheBustedUrl: ?eno=<run start ms> on a canonical url, & after an existing query; refuses a junk key', () => {
    expect(cacheBustedUrl('https://honeycomb.com.vn/wp-sitemap.xml', 1790876913000)).toBe('https://honeycomb.com.vn/wp-sitemap.xml?eno=1790876913000')
    expect(cacheBustedUrl(MAP(7), 1790876913000)).toBe(`${MAP(7)}?eno=1790876913000`)
    expect(cacheBustedUrl('/wp-sitemap.xml?x=1', 5)).toBe('/wp-sitemap.xml?x=1&eno=5')
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => cacheBustedUrl('/wp-sitemap.xml', bad), String(bad)).toThrow(/positive integer/)
  })
  it('isCacheHit: "hit" in any case or with a qualifier; "miss", absent or junk is not', () => {
    for (const h of ['hit', 'HIT', ' hit ', 'hit,private', 'hit,litemage']) expect(isCacheHit(h), h).toBe(true)
    for (const h of ['miss', 'miss,private', '', null, undefined, 'white', 'nohit']) expect(isCacheHit(h), String(h)).toBe(false)
  })
  it('sitemapCacheProblem names every file served from the cache; sitemapCacheSummary records every header in page order', () => {
    expect(sitemapCacheProblem('miss', [read(1, 'miss'), read(2, 'miss')])).toBeNull()
    expect(sitemapCacheProblem(null, [read(1, null), read(2, null)])).toBeNull()
    expect(sitemapCacheProblem('hit', [read(1, 'miss'), read(2, 'hit')])).toMatch(/^2 sitemap file\(s\) came from the LiteSpeed page cache .*\/wp-sitemap\.xml \(hit\); .*-2\.xml \(hit\)$/)
    expect(sitemapCacheSummary('miss', [read(2, 'miss'), read(1, null)])).toBe('index miss · -1.xml none · -2.xml miss')
    // A hostile header is printed tamed: printable ASCII, 40 chars at most.
    expect(sitemapCacheSummary('hit\u0007' + 'x'.repeat(100), [])).toBe(`index hit?${'x'.repeat(36)}`)
  })
})

describe('⛔ keepVerdict — a --since-days run creates and keeps by the EXACT window at the fetch', () => {
  // The weekly stage's day window: the start of the Vietnam day 7 days back — up to 24 h before fetchedAt − 7 d.
  const sinceMs = Date.parse('2026-09-24T00:00:00+07:00')
  const at = (ms: number) => vnStamp(ms)
  it('an ad 7–8 days old at the fetch is inside the day window but OUTSIDE the 7 days: not created, not kept', () => {
    // Fetched 2026-10-01 11:50 in Vietnam; the day window opened 2026-09-24 00:00, the 7 days at 09-24 11:50.
    const before7d = '2026-09-24T03:00:00+07:00'
    expect(Date.parse(before7d)).toBeGreaterThanOrEqual(sinceMs)
    expect(keepVerdict(before7d, { sinceMs, exactDays: 7, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'outsideWindow' })
    // A plain --since run (exactDays null) still keeps it, as before.
    expect(keepVerdict(before7d, { sinceMs, exactDays: null, fetchedAt: FETCHED })).toMatchObject({ keep: true })
  })
  it('inside the 7 days at the fetch: kept, with its worst-case instant', () => {
    const v = keepVerdict(at(FETCHED - 2 * DAY), { sinceMs, exactDays: 7, fetchedAt: FETCHED })
    expect(v).toEqual({ keep: true, t: Math.floor((FETCHED - 2 * DAY) / 1000) * 1000 })
  })
  it("a 30-day stage (Honeycomb's weekly run) creates and keeps an ad 20 days old; 30 d + 1 min is outside, 31 d before the day window", () => {
    const since30 = Date.parse('2026-09-01T00:00:00+07:00')
    expect(keepVerdict(at(FETCHED - 20 * DAY), { sinceMs: since30, exactDays: W, fetchedAt: FETCHED })).toEqual({ keep: true, t: FETCHED - 20 * DAY })
    expect(keepVerdict(at(FETCHED - W * DAY - 60_000), { sinceMs: since30, exactDays: W, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'outsideWindow' })
    expect(keepVerdict(at(FETCHED - (W + 1) * DAY), { sinceMs: since30, exactDays: W, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'beforeSince' })
  })
  it('before the day window, unreadable, or (exact runs) dated after the fetch: dropped', () => {
    expect(keepVerdict(at(FETCHED - 30 * DAY), { sinceMs, exactDays: 7, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'beforeSince' })
    expect(keepVerdict(null, { sinceMs, exactDays: null, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'beforeSince' })
    expect(keepVerdict('2026-09-30T10:00:00', { sinceMs, exactDays: 7, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'beforeSince' })
    expect(keepVerdict(at(FETCHED + DAY), { sinceMs, exactDays: 7, fetchedAt: FETCHED })).toEqual({ keep: false, why: 'outsideWindow' })
  })
  it('the stage records which run it was: sinceDays survives the file; junk REFUSES the file (never widens the window)', () => {
    const file = (sinceDays: unknown) => ({ source: 'honeycomb.com.vn', fetchedAt: iso(FETCHED), fx: { vndPerUsd: 25_971 }, records: [], params: { since: '2026-09-24', limit: 0, city: null, sinceDays }, sitemap: {}, pages: {} })
    const read = (v: unknown) => { const r = readHoneycombStage(file(v)); return r.ok ? r.stage.params.sinceDays : 'refused' }
    expect(read(7)).toBe(7)
    expect(read(undefined)).toBeNull()
    expect(read(null)).toBeNull()
    expect(read('7')).toBe('refused')
    expect(read(0)).toBe('refused')
    expect(read(7.5)).toBe('refused')
  })
})

describe('⛔ the tombstone ledger — a page whose visibility changed is never left without one', () => {
  it('owed before the write, paid straight after; a failed pay keeps it owed and the next pay retries', async () => {
    const calls: string[][] = []
    let fail = true
    const l = makeTombstoneLedger(async (ids) => { calls.push([...ids]); if (fail) throw new Error('db down') })
    l.owe('a')
    await expect(l.pay()).rejects.toThrow('db down')
    expect(l.owed()).toEqual(['a'])
    l.owe('b')
    fail = false
    await l.pay()
    expect(calls).toEqual([['a'], ['a', 'b']])
    expect(l.owed()).toEqual([])
    expect(l.paid()).toBe(2)
    await l.pay()
    expect(calls).toHaveLength(2) // nothing owed → no call
  })
  it('⛔ a throw after a revival landed (the P1: an Infeasible 429 on a later create) still tombstones it, in the finally', async () => {
    const tombstoned: string[] = []
    const l = makeTombstoneLedger(async (ids) => { tombstoned.push(...ids) })
    // The script's shape: per-row writes in try, ledger.pay() in finally.
    const run = async () => {
      try {
        l.owe('revived-1') // owed before the write; the write landed, then — before its own pay — something throws
        throw new Infeasible('photo answered 429')
      } finally {
        await l.pay()
      }
    }
    await expect(run()).rejects.toBeInstanceOf(Infeasible)
    expect(tombstoned).toEqual(['revived-1'])
  })
  it('⛔ a write that COMMITS and then throws (the reply lost) is still paid — it was owed before the attempt', async () => {
    const tombstoned: string[] = []
    const rows = new Map([['r1', 'expired']])
    const l = makeTombstoneLedger(async (ids) => { tombstoned.push(...ids) })
    const revive = async (id: string) => {
      l.owe(id) // the script's order: owe, then attempt
      rows.set(id, 'active') // committed…
      throw new Error('Connection terminated unexpectedly') // …but the reply never came back
    }
    try {
      try { await revive('r1') } catch { /* the per-row catch: counted as errored, the run goes on */ }
    } finally {
      await l.pay()
    }
    expect(rows.get('r1')).toBe('active')
    expect(tombstoned).toEqual(['r1'])
  })
})

describe('⛔ the importer script wires the rule the way the lib describes', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/import-honeycomb-com-vn.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const apply = code.slice(code.indexOf('// ── APPLY') >= 0 ? code.indexOf('// ── APPLY') : code.indexOf('if (refusal) throw new Error(`seller ${SELLER_ID} ${refusal}; refusing to write`)'))
  const phase = apply.slice(apply.indexOf('const ledger = makeTombstoneLedger('), apply.indexOf('const active = await db.listing.count('))

  it('⛔ the ISR tag table is checked before the FIRST status write (the screen hides, revivals, retires)', () => {
    const check = apply.indexOf("to_regclass('public.next_cache_tag')")
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(apply.indexOf('await screen.applyHides()'))
    expect(apply.slice(check, apply.indexOf('await screen.applyHides()'))).toMatch(/if \(!isrTable\) throw new Error\(/)
  })

  it('⛔ the whole write phase is try { … } finally { ledger.pay() } — a throw cannot skip a tombstone', () => {
    expect(phase).toMatch(/^const ledger = makeTombstoneLedger\(\(ids\) => tombstonePdps\(db, ids\)\)\s+try \{\s+for \(const p of \[\.\.\.toUpdate, \.\.\.toCreate\]\) \{/)
    const fin = phase.indexOf('} finally {')
    expect(fin).toBeGreaterThan(phase.indexOf('for (const p of [...toUpdate, ...toCreate])'))
    expect(fin).toBeGreaterThan(phase.indexOf('if (gone.length) {'))
    expect(phase.slice(fin)).toMatch(/^\} finally \{\s+try \{ await ledger\.pay\(\) \} catch \(e\) \{[\s\S]*sql = pdpTombstoneSql\(owed\); recordDurably\(OWED, sql\)[\s\S]*process\.exitCode = 1/)
    // No other tombstone path, and no end-of-run-only tombstone left behind.
    expect(code.match(/tombstonePdps\(/g)).toHaveLength(1)
  })

  it('⛔ a revival: one guarded updateMany (from expired|stale, at the postedAt read), owed BEFORE it is attempted, rollback only after it moved', () => {
    expect(phase).toMatch(/where: \{ id: p\.s\.id, sellerId: SELLER_ID, status: \{ in: \[\.\.\.REVIVABLE_STATUSES\] \}, postedAt: p\.s\.postedAt \},\s+data: \{ \.\.\.data, status: 'active' \},/)
    const compose = phase.indexOf("const undo = entry ? datedRollbackSql(entry, SELLER_ID) : ''")
    const plan = phase.indexOf('if (entry) recordDurably(DATED, JSON.stringify(entry))')
    const write = phase.indexOf('await db.listing.updateMany({')
    const movedCheck = phase.indexOf('if (!moved.count)')
    const owe = phase.indexOf('if (p.dated.revive) ledger.owe(p.s.id)')
    const rollback = phase.indexOf('if (undo) recordDurably(ROLLBACK, undo)')
    const pay = phase.indexOf('if (p.dated.revive) { stat.revived++; await ledger.pay() }')
    expect([compose, plan, write, movedCheck, owe, rollback, pay].every((i) => i > -1)).toBe(true)
    expect(compose).toBeLessThan(plan)
    expect(plan).toBeLessThan(owe)
    // ⛔ owed BEFORE the write: a revival that commits and then throws never reaches a line after it.
    expect(owe).toBeLessThan(write)
    expect(write).toBeLessThan(movedCheck)
    expect(movedCheck).toBeLessThan(rollback)
    expect(rollback).toBeLessThan(pay)
    expect(phase.match(/ledger\.owe\(p\.s\.id\)/g)).toHaveLength(1)
  })

  it("⛔ no unguarded write by id: every existing-row write is an updateMany that skips a 'removed' row", () => {
    expect(code).not.toMatch(/\.listing\.update\(/)
    expect(phase).toMatch(/where: \{ id: p\.s\.id, sellerId: SELLER_ID, status: \{ not: 'removed' \}, \.\.\.\(datedWrite \? \{ postedAt: p\.s\.postedAt \} : \{\}\) \},/)
  })

  it('⛔ a retire: planned ids first and OWED before the write, …AndReturn for exactly the rows moved, journalled, rollback guarded + tombstoned', () => {
    const r = phase.slice(phase.indexOf('if (gone.length) {'))
    const planned = r.indexOf('recordDurably(CREATED, JSON.stringify({ retirePlanned: gone }))')
    const write = r.indexOf('await db.listing.updateManyAndReturn({')
    const owe = r.indexOf('for (const id of gone) ledger.owe(id)')
    const rollback = r.indexOf('recordDurably(ROLLBACK, hid.map(')
    expect(planned).toBeGreaterThan(-1)
    expect(planned).toBeLessThan(owe)
    expect(owe).toBeLessThan(write)
    expect(write).toBeLessThan(rollback)
    expect(r).not.toMatch(/for \(const r of hid\) ledger\.owe/)
    expect(r).toMatch(/AND status = 'hidden' AND "updatedAt" = \$\{lit\(r\.updatedAt\.toISOString\(\)\)\};\\n\$\{pdpTombstoneSql\(\[r\.id\]\)\}/)
  })

  it('rankScore on a moved postedAt is the create formula, from the source date', () => {
    expect(src).toMatch(/browseRankScore\(\{ sellerTrustScore: seller\?\.trustScore \?\? 100, postedAt: p\.dated\.postedAt, featured: false \}\)/)
    expect(src).toMatch(/browseRankScore\(\{ sellerTrustScore: seller\?\.trustScore \?\? 100, postedAt: p\.k\.postedAt, featured: false \}\)/)
  })

  it('⛔ files are written atomically: tmp + fsync + rename + fsync of the DIRECTORY — the fresh set and the staged file', () => {
    const w = code.slice(code.indexOf('function writeAtomically('), code.indexOf('function prepareJournalDir('))
    expect(w).toMatch(/writeSync\(fd, text\); fsyncSync\(fd\)[\s\S]*renameSync\(tmp, file\)[\s\S]*openSync\(dirname\(resolve\(file\)\), 'r'\)[\s\S]*fsyncSync\(dfd\)/)
    const f = code.slice(code.indexOf('function writeFreshOut('), code.indexOf('async function verify()'))
    expect(f.indexOf('freshSetProblem(')).toBeLessThan(f.indexOf('writeAtomically('))
    expect(code).toMatch(/if \(FRESH_OUT && fresh\) writeFreshOut\(FRESH_OUT, fresh\)/)
    expect(code).toMatch(/if \(SAVE\) writeAtomically\(SAVE, JSON\.stringify\(stage, null, 1\), 0o600\)/)
    expect(code).not.toMatch(/writeFileSync/)
  })

  it('⛔ the keep filter is keepVerdict with the exact window; the stage records --since-days; a 7-day stage applies within a day', () => {
    expect(code).toMatch(/const v = keepVerdict\(r\.lastmod, \{ sinceMs, exactDays, fetchedAt: fetchedMs \}\)/)
    expect(code).toMatch(/const exactDays = SINCE_DAYS \?\? \(SINCE_ARG \? null : stage\.params\.sinceDays\)/)
    expect(code).toMatch(/params: \{ since: SINCE, limit: LIMIT, city: CITY, sinceDays: SINCE_DAYS \}/)
    expect(code).toMatch(/stageAgeProblem\(stage\.fetchedAt, Date\.now\(\), FRESH_SET_MAX_AGE_MS \/ 3_600_000\)/)
  })

  it('⛔ the sitemaps are REQUESTED cache-busted, parsed and reported by their canonical url, and the cache headers reach the fresh set', () => {
    expect(code).toMatch(/const RUN_START_MS = Date\.now\(\)/)
    expect(code).toMatch(/const index = await politeGet\(cacheBustedUrl\(`\$\{HONEYCOMB_ORIGIN\}\/wp-sitemap\.xml`, RUN_START_MS\)\)/)
    expect(code).toMatch(/const res = await politeGet\(cacheBustedUrl\(m, RUN_START_MS\)\)\s+const \{ read: r, entries: kept \} = sitemapFileRead\(m, res\)/)
    expect(code).not.toMatch(/politeGet\(m\)|politeGet\(`\$\{HONEYCOMB_ORIGIN\}\/wp-sitemap\.xml`\)/)
    expect(code).toMatch(/crawlProbe = \{ maps: mapReads, indexCache, detail \}/)
    expect(code).toMatch(/maps: crawlProbe\.maps, indexCache: crawlProbe\.indexCache, entries: stage\.sitemap\.entries,/)
    // robots.txt must allow the busted form too.
    expect(code).toMatch(/cacheBustedUrl\('\/wp-sitemap\.xml', RUN_START_MS\), cacheBustedUrl\('\/wp-sitemap-posts-estate_property-1\.xml', RUN_START_MS\)/)
  })

  it('⛔ --fresh-out is preflighted with the --since-days value', () => {
    expect(code).toMatch(/freshOutPreflight\(\{ freshOut: FRESH_OUT, src: SRC, apply: APPLY, limit: LIMIT, sinceDays: SINCE_DAYS, sinceMs, now: Date\.now\(\) \}\)/)
  })

  it('the crawl reads through the pure readers: sitemapFileRead, sitemapReadProblem for `complete`, readDetailPages', () => {
    expect(code).toMatch(/const \{ read: r, entries: kept \} = sitemapFileRead\(m, res\)/)
    expect(code).toMatch(/complete: !mapsProblem && entries\.length > 0/)
    expect(code).toMatch(/await readDetailPages\(batch, politeGet\)/)
  })

  it('unknown flags are refused before anything else runs, --verify included', () => {
    expect(src.indexOf('const unknownFlag = unknownFlagProblem(argv.slice(2))')).toBeLessThan(src.indexOf('if (VERIFY) return verify()'))
  })
})
