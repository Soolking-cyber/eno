import { describe, expect, it } from 'vitest'
import { FRESH_DAYS, freshSetProblem } from './apartment-freshness'
import { ageWithin, bdsAgeDays } from './batdongsan-age'
import {
  BDS_CRAWL_LOG_KIND, BDS_LIST_URLS, CATCHUP_MAX_RUN, MAX_TAIL_PAGES, buildBdsFreshSet, catchUpCap, catchUpProblem, catchUpTargets,
  coverageOfLog, crawlBindingProblem, crawlCoverage, endOfResults, judgeBdsRow, parseCrawlLog,
  type BdsJudgeContext, type BdsList, type CatchUpRecord, type CrawlPage, type CrawlPageRecord,
} from './batdongsan-crawl'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-05T06:00:00Z')
const START = NOW - 3 * 3_600_000
const SELLER = 'bds-vn-import-seller-0001'

/** n full pages whose pagination links to the last page, the last one linking nowhere later. */
const pagesTo = (n: number, over: (p: CrawlPage) => Partial<CrawlPage> = () => ({})): CrawlPage[] =>
  Array.from({ length: n }, (_, i) => {
    const page = i + 1
    const p: CrawlPage = { page, outcome: 'ok', cards: page === n ? 7 : 20, maxLinkedPage: page === n ? page - 1 || null : n, totalCount: null }
    return { ...p, ...over(p) }
  })
const blank = (page: number, outcome: CrawlPage['outcome']): CrawlPage => ({ page, outcome, cards: 0, maxLinkedPage: null, totalCount: null })

/** A list of n pages, two cards each, newest first (ages never reset), codes unique per list `tag`. */
const listRecords = (n: number, tag: number, over: (p: CrawlPageRecord) => Partial<CrawlPageRecord> = () => ({})): CrawlPageRecord[] =>
  Array.from({ length: n }, (_, i) => {
    const page = i + 1
    const p: CrawlPageRecord = {
      page, outcome: 'ok', cards: 2, maxLinkedPage: page === n ? page - 1 || null : n, totalCount: null,
      codes: [`pr4${tag}${String(page).padStart(4, '0')}1`, `pr4${tag}${String(page).padStart(4, '0')}2`], ages: [Math.floor(i / 2), Math.floor(i / 2)],
    }
    return { ...p, ...over(p) }
  })
/** The catch-up the rule asks for when nothing moved: page 1 again, nothing unseen. */
const quietCatchUp = (pages: CrawlPageRecord[]): CatchUpRecord[] => [{ ...pages[0], target: 1, unseen: 0 }]
const crawl = (list: BdsList, pages: CrawlPageRecord[], over: Record<string, unknown> = {}) => ({
  list, listUrl: BDS_LIST_URLS[list], startedAt: new Date(START).toISOString(), finishedAt: new Date(START + 1_800_000).toISOString(),
  finished: true, aborted: null, pages, catchUp: quietCatchUp(pages), catchUpCapped: false, ...over,
})
const APTS = listRecords(20, 1)
const MINI = listRecords(10, 2)
const log = (over: Record<string, unknown> = {}) => ({
  kind: BDS_CRAWL_LOG_KIND, v: 2, lists: ['apartments', 'apartmentsMini'],
  startedAt: new Date(START).toISOString(), finishedAt: new Date(START + 3_600_000).toISOString(),
  finished: true, aborted: null, preexisting: 0,
  crawls: [crawl('apartments', APTS), crawl('apartmentsMini', MINI)],
  ...over,
})

describe('endOfResults — the end is proven by the site\'s own pagination', () => {
  it('route A: the last page read links to no later page, and no page ever linked past it', () => {
    expect(endOfResults(pagesTo(3))).toMatchObject({ endPage: 3, probePage: null })
  })
  it('refuses a "last" page that still links further', () => {
    expect(endOfResults(pagesTo(3, (p) => (p.page === 3 ? { maxLinkedPage: 4 } : {})))).toBeNull()
  })
  it('refuses to end early when an earlier page linked further (a crawl stopped short)', () => {
    expect(endOfResults(pagesTo(3, (p) => (p.page === 1 ? { maxLinkedPage: 10 } : p.page === 3 ? { maxLinkedPage: 3 } : {})))).toBeNull()
  })
  it('a last page with NO pagination at all is not proof by itself', () => {
    expect(endOfResults(pagesTo(3, (p) => (p.page === 3 ? { maxLinkedPage: null } : {})))).toBeNull()
  })
  it('route B: a page PAST the last linked page came back empty (or redirected) right after an ok page', () => {
    const base = pagesTo(3, (p) => (p.page === 3 ? { maxLinkedPage: null } : {}))
    expect(endOfResults([...base, blank(4, 'empty')])).toMatchObject({ endPage: 3, probePage: 4 })
    expect(endOfResults([...base, { page: 4, outcome: 'redirect', cards: 20, maxLinkedPage: 3, totalCount: null }])).toMatchObject({ endPage: 3, probePage: 4 })
  })
  it('⛔ an empty page INSIDE the list is not the end — the hiccup that would expire everything after it', () => {
    expect(endOfResults([{ page: 1, outcome: 'ok', cards: 20, maxLinkedPage: 700, totalCount: null }, blank(2, 'empty')])).toBeNull()
  })
  it('route B needs SOME word on the list\'s length — with no link and no count anywhere, an empty page proves nothing', () => {
    const bare: CrawlPage[] = [{ page: 1, outcome: 'ok', cards: 20, maxLinkedPage: null, totalCount: null }, blank(2, 'empty')]
    expect(endOfResults(bare)).toBeNull()
    expect(endOfResults([{ ...bare[0], totalCount: 15 }, bare[1]])).toMatchObject({ endPage: 1, probePage: 2 })
    expect(endOfResults([{ ...bare[0], totalCount: 14_000 }, bare[1]])).toBeNull()
  })
  it('route B needs the page before the probe to have been read', () => {
    const base = pagesTo(3, (p) => (p.page === 3 ? { outcome: 'error', maxLinkedPage: null } : {}))
    expect(endOfResults([...base, blank(4, 'empty')])).toBeNull()
  })
  it('a challenge or an error as the last page is never the end', () => {
    expect(endOfResults([...pagesTo(2, () => ({ maxLinkedPage: 5 })), blank(3, 'challenge')])).toBeNull()
    expect(endOfResults([blank(1, 'error')])).toBeNull()
  })
  it("must agree with the site's own count to within one page — a pagination that stops early is not the end", () => {
    expect(endOfResults(pagesTo(3, (p) => (p.page === 1 ? { totalCount: 100 } : {})))).toBeNull()
    expect(endOfResults(pagesTo(4, (p) => (p.page === 1 ? { totalCount: 100 } : {})))?.endPage).toBe(4)
    expect(endOfResults(pagesTo(5, (p) => (p.page === 1 ? { totalCount: 100 } : {})))?.evidence).toMatch(/site count 100/)
  })
  describe('route C — the list SHRANK while it was read', () => {
    // Page 1 linked to page 10 when it was read; by the time the crawl got there the list ended at 8.
    const shrunk = pagesTo(8, (p) => (p.page === 1 ? { maxLinkedPage: 10 } : p.page === 8 ? { maxLinkedPage: 7 } : { maxLinkedPage: p.page + 2 }))
    it('ends at the last ok page when its own pagination says so and every page after it, past the furthest link, came back empty', () => {
      const end = endOfResults([...shrunk, blank(9, 'empty'), blank(10, 'empty'), blank(11, 'redirect')])
      expect(end).toMatchObject({ endPage: 8, probePage: 9 })
      expect(end?.evidence).toMatch(/shrank/)
    })
    it('not before the probe has passed the furthest page any read page linked to', () => {
      expect(endOfResults([...shrunk, blank(9, 'empty'), blank(10, 'empty')])).toBeNull()
    })
    it('not when the last ok page still links further, or a page after it failed rather than came back empty', () => {
      const linking = shrunk.map((p) => (p.page === 8 ? { ...p, maxLinkedPage: 9 } : p))
      expect(endOfResults([...linking, blank(9, 'empty'), blank(10, 'empty'), blank(11, 'empty')])).toBeNull()
      expect(endOfResults([...shrunk, blank(9, 'error'), blank(10, 'empty'), blank(11, 'empty')])).toBeNull()
    })
    it(`not past ${MAX_TAIL_PAGES} pages after the end — a list does not shrink that far in one crawl`, () => {
      const far = pagesTo(8, (p) => (p.page === 1 ? { maxLinkedPage: 13 } : p.page === 8 ? { maxLinkedPage: 7 } : {}))
      const tail = (k: number) => Array.from({ length: k }, (_, i) => blank(9 + i, 'empty'))
      expect(endOfResults([...far.map((p) => (p.page === 1 ? { ...p, maxLinkedPage: 12 } : p)), ...tail(MAX_TAIL_PAGES)])).toMatchObject({ endPage: 8 })
      expect(endOfResults([...far, ...tail(MAX_TAIL_PAGES + 1)])).toBeNull()
    })
    it("still has to agree with the site's latest count", () => {
      const counted = shrunk.map((p) => (p.page === 8 ? { ...p, totalCount: 400 } : p))
      expect(endOfResults([...counted, blank(9, 'empty'), blank(10, 'empty'), blank(11, 'empty')])).toBeNull()
    })
  })
})

describe('catchUpTargets — every tier top, where a moved ad lands', () => {
  it('page 1 when the ages never reset (one tier, newest first)', () => {
    expect(catchUpTargets(listRecords(6, 1), 6)).toEqual([1])
  })
  it('every page where the ages reset to a newer age — a new tier, or a pushed ad on top of one', () => {
    // VIP tier on pages 1–2 (ages 0…5), ordinary ads from page 3 (back to 0).
    const pages = listRecords(5, 1, (p) => ({ ages: p.page <= 2 ? [p.page * 2, p.page * 2 + 1] : [p.page - 3, p.page - 3] }))
    expect(catchUpTargets(pages, 5)).toEqual([1, 3])
    // A reset in the middle of a page is that page (1, 2, 4 | 0, 3, 4 — the tier restarts on page 2).
    const mid = listRecords(3, 1, (p) => ({ ages: p.page === 2 ? [4, 0] : [p.page, p.page + 1] }))
    expect(catchUpTargets(mid, 3)).toEqual([1, 2])
  })
  it('every page that was not read; unreadable labels are skipped; nothing past the end', () => {
    const pages = listRecords(6, 1, (p) => (p.page === 4 ? { outcome: 'error', cards: 0, codes: [], ages: [] } : p.page === 2 ? { ages: [null, null] } : {}))
    expect(catchUpTargets(pages, 6)).toEqual([1, 4])
    expect(catchUpTargets([...listRecords(3, 1), { page: 4, outcome: 'empty', cards: 0, maxLinkedPage: null, totalCount: null, codes: [], ages: [] }], 3)).toEqual([1])
  })
})

describe('catchUpProblem — the catch-up pass, re-walked from the logged ages and codes', () => {
  const pages = listRecords(10, 1)
  const again = (p: CrawlPageRecord, target: number, extra: string[] = []): CatchUpRecord => {
    return { ...p, codes: [...extra, ...p.codes].slice(0, Math.max(p.codes.length, extra.length)), cards: Math.max(p.codes.length, extra.length), target, unseen: extra.length }
  }
  it('accepts the quiet pass: page 1 again, nothing moved', () => {
    expect(catchUpProblem(pages, 10, quietCatchUp(pages), false)).toBeNull()
  })
  it('keeps reading from a tier top while a page shows codes the crawl had not seen, and stops at the first that shows none', () => {
    const run = [again(pages[0], 1, ['pr4999990001', 'pr4999990002']), again(pages[1], 1, ['pr4999990003']), { ...pages[2], target: 1, unseen: 0 }]
    expect(catchUpProblem(pages, 10, run, false)).toBeNull()
    expect(catchUpProblem(pages, 10, run.slice(0, 2), false)).toMatch(/never re-read page 3/)
    expect(catchUpProblem(pages, 10, [...run, { ...pages[3], target: 1, unseen: 0 }], false)).toMatch(/did not ask for/)
  })
  it('recomputes `unseen` from the codes — a log that says nothing moved when it did is refused', () => {
    expect(catchUpProblem(pages, 10, [{ ...again(pages[0], 1, ['pr4999990001']), unseen: 0 }], false)).toMatch(/says 0 unseen/)
  })
  it(`stops a run after ${CATCHUP_MAX_RUN} pages, at a page it could not read, and at the end page`, () => {
    const moving = (p: CrawlPageRecord, i: number) => again(p, 1, [`pr48888${i}01`])
    expect(catchUpProblem(pages, 10, pages.slice(0, CATCHUP_MAX_RUN).map(moving), false)).toBeNull()
    expect(catchUpProblem(pages, 10, [{ ...pages[0], outcome: 'challenge', cards: 0, codes: [], ages: [], target: 1, unseen: 0 }], false)).toBeNull()
    const short = listRecords(2, 1)
    expect(catchUpProblem(short, 2, short.map(moving), false)).toBeNull()
  })
  it('runs from EVERY tier top, in order, skipping one an earlier run already re-read', () => {
    const tiers = listRecords(10, 1, (p) => ({ ages: p.page === 6 ? [0, 0] : p.page > 6 ? [p.page - 6, p.page - 6] : [p.page, p.page] }))
    expect(catchUpTargets(tiers, 10)).toEqual([1, 6])
    const both = [{ ...tiers[0], target: 1, unseen: 0 }, { ...tiers[5], target: 6, unseen: 0 }]
    expect(catchUpProblem(tiers, 10, both, false)).toBeNull()
    expect(catchUpProblem(tiers, 10, both.slice(0, 1), false)).toMatch(/never re-read page 6 \(the run from tier top 6\)/)
    expect(catchUpProblem(tiers, 10, [both[1], both[0]], false)).toMatch(/expected page 1/)
  })
  it(`is capped at catchUpCap pages (${catchUpCap(10)} here), and the log must say so — no more, no less`, () => {
    // Every page resets: a target per page, more than the cap.
    const n = catchUpCap(10) + 10
    const sawtooth = listRecords(n, 1, (p) => ({ ages: [5, 0] }))
    const capped = sawtooth.slice(0, catchUpCap(n)).map((p) => ({ ...p, target: p.page, unseen: 0 }))
    // ⛔ A capped catch-up is consistent with its log but NOT whole: refused (ads that moved may be missing).
    expect(catchUpProblem(sawtooth, n, capped, true)).toMatch(/stopped at its cap/)
    expect(catchUpProblem(sawtooth, n, capped, false)).toMatch(/reached its cap/)
    expect(catchUpProblem(pages, 10, quietCatchUp(pages), true)).toMatch(/says the catch-up pass was capped/)
  })
})

describe('crawlCoverage — refuses every crawl that does not prove the whole of BOTH apartment lists', () => {
  it('accepts a whole crawl of both lists and says why, in words the expiry prints', () => {
    const c = crawlCoverage(log(), NOW)
    expect(c.problem).toBeNull()
    if (c.problem !== null) return
    expect(c.coverage.lists).toEqual(['apartments', 'apartmentsMini'])
    expect(c.coverage.codes.size).toBe(60)
    expect(c.coverage.apartmentCodes.size).toBe(60)
    expect(c.coverage.startedAtMs).toBe(START)
    expect(c.coverage.evidence).toMatch(/cho-thue-can-ho-chung-cu-tp-hcm \(apartments\): pages 1–20, 21 of 21 reads ok/)
    expect(c.coverage.evidence).toMatch(/cho-thue-can-ho-chung-cu-mini-tp-hcm \(apartmentsMini\): pages 1–10/)
    expect(c.coverage.evidence).toMatch(/catch-up: 1 page\(s\) from 1 tier top\(s\), 0 listing\(s\)/)
  })
  it('⛔ a crawl of the apartments list alone cannot produce a set — the mini flats it never read would all be expired (P1)', () => {
    const only = log({ lists: ['apartments'], crawls: [crawl('apartments', APTS)] })
    expect(crawlCoverage(only, NOW).problem).toMatch(/not every list the importer maps to apartment-rental \(apartments \+ apartmentsMini, or all\)/)
    expect(crawlCoverage(log({ crawls: [crawl('apartmentsMini', MINI)] }), NOW).problem).toMatch(/apartments \+ apartmentsMini/)
    // The `all` list carries both.
    expect(crawlCoverage(log({ crawls: [crawl('all', APTS)] }), NOW).problem).toBeNull()
  })
  it('the codes read on an apartment list are named, so the importer can check each is classified an apartment', () => {
    const c = crawlCoverage(log({ crawls: [crawl('all', APTS)] }), NOW)
    expect(c.problem === null && c.coverage.apartmentCodes.size).toBe(0)
  })
  it('⛔ every page of results needs one successful read — a failed page the catch-up re-read is covered; one never read refuses', () => {
    // Page 5 failed: the catch-up re-reads it (a tier top of its own) and the page after — 22 of 23 reads ok.
    const one = listRecords(20, 1, (p) => (p.page === 5 ? { outcome: 'error', cards: 0, codes: [], ages: [] } : {}))
    const cu = [{ ...one[0], target: 1, unseen: 0 }, { ...APTS[4], target: 5, unseen: 2 }, { ...APTS[5], target: 5, unseen: 0 }]
    expect(crawlCoverage(log({ crawls: [crawl('apartments', one, { catchUp: cu }), crawl('apartmentsMini', MINI)] }), NOW).problem).toBeNull()
    const two = listRecords(20, 1, (p) => (p.page === 5 || p.page === 9 ? { outcome: 'challenge', cards: 0, codes: [], ages: [] } : {}))
    const cu2 = [{ ...two[0], target: 1, unseen: 0 }, ...[5, 9].map((n) => ({ ...two[n - 1], target: n, unseen: 0 }))]
    // Pages 5 and 9 failed AND their catch-up re-reads (copies of the failed records) failed too → never read.
    expect(crawlCoverage(log({ crawls: [crawl('apartments', two, { catchUp: cu2 }), crawl('apartmentsMini', MINI)] }), NOW).problem).toMatch(/apartments list: 2 page\(s\) of results never read successfully \(5, 9;/)
  })
  it("does not count route B's probe page against the share", () => {
    const pages = [...listRecords(19, 1, (p) => (p.page === 19 ? { maxLinkedPage: null } : {})), { page: 20, outcome: 'empty' as const, cards: 0, maxLinkedPage: null, totalCount: null, codes: [], ages: [] }]
    expect(crawlCoverage(log({ crawls: [crawl('apartments', pages), crawl('apartmentsMini', MINI)] }), NOW).problem).toBeNull()
  })
  it('refuses a list that did not reach the end of results, or skipped its catch-up', () => {
    const open = listRecords(20, 1, (p) => (p.page === 20 ? { maxLinkedPage: 21 } : {}))
    expect(crawlCoverage(log({ crawls: [crawl('apartments', open), crawl('apartmentsMini', MINI)] }), NOW).problem).toMatch(/apartments list: the end of results was not reached/)
    expect(crawlCoverage(log({ crawls: [crawl('apartments', APTS, { catchUp: [] }), crawl('apartmentsMini', MINI)] }), NOW).problem).toMatch(/apartments list: the catch-up pass never re-read page 1/)
  })
  it('refuses an unfinished, aborted or merged crawl — of the run or of one list', () => {
    expect(crawlCoverage(log({ finished: false }), NOW).problem).toMatch(/did not finish/)
    expect(crawlCoverage(log({ finishedAt: null }), NOW).problem).toMatch(/did not finish/)
    expect(crawlCoverage(log({ aborted: 'apartmentsMini: 5 consecutive pages failed' }), NOW).problem).toMatch(/aborted: apartmentsMini: 5 consecutive/)
    expect(crawlCoverage(log({ preexisting: 13_768 }), NOW).problem).toMatch(/merged into an existing file/)
    expect(crawlCoverage(log({ preexisting: undefined }), NOW).problem).toMatch(/preexisting/)
    expect(crawlCoverage(log({ crawls: [crawl('apartments', APTS), crawl('apartmentsMini', MINI, { finished: false })] }), NOW).problem).toMatch(/apartmentsMini list: the crawl did not finish/)
    expect(crawlCoverage(log({ crawls: [crawl('apartments', APTS, { aborted: 'end not proven: …' }), crawl('apartmentsMini', MINI)] }), NOW).problem).toMatch(/apartments list: the crawl was aborted: end not proven/)
  })
  it('refuses a list that did not start at page 1, skipped a page, or read one twice', () => {
    const at = (pages: CrawlPageRecord[]) => crawlCoverage(log({ crawls: [crawl('apartments', pages, { catchUp: [] }), crawl('apartmentsMini', MINI)] }), NOW).problem
    expect(at(APTS.slice(1))).toMatch(/start at page 1/)
    expect(at(APTS.filter((p) => p.page !== 7))).toMatch(/skip nothing/)
    expect(at([...APTS, APTS[3]])).toMatch(/each once/)
  })
  it('refuses another list, the same list twice, an old log version, bad timestamps and malformed records', () => {
    expect(crawlCoverage(log({ crawls: [crawl('apartments', APTS, { listUrl: 'https://batdongsan.com.vn/ban-can-ho-chung-cu-tp-hcm' })] }), NOW).problem).toMatch(/pinned/)
    expect(crawlCoverage(log({ crawls: [crawl('apartments', APTS), crawl('apartments', APTS)] }), NOW).problem).toMatch(/crawled twice/)
    expect(crawlCoverage({ ...log(), v: 1 }, NOW).problem).toMatch(/version 1, expected 2/)
    expect(crawlCoverage(log({ kind: 'x' }), NOW).problem).toMatch(/kind/)
    expect(crawlCoverage([], NOW).problem).toMatch(/not a JSON object/)
    expect(crawlCoverage(log({ startedAt: 'yesterday' }), NOW).problem).toMatch(/startedAt/)
    expect(crawlCoverage(log({ finishedAt: new Date(START - 1).toISOString() }), NOW).problem).toMatch(/before startedAt/)
    expect(crawlCoverage(log({ finishedAt: new Date(NOW + 3_600_000).toISOString() }), NOW).problem).toMatch(/future/)
    expect(crawlCoverage(log({ crawls: [] }), NOW).problem).toMatch(/no crawls/)
    const bad = (p: Partial<CrawlPageRecord>) => crawlCoverage(log({ crawls: [crawl('apartments', [{ ...APTS[0], ...p }, ...APTS.slice(1)])] }), NOW).problem
    expect(bad({ outcome: 'fine' as never })).toMatch(/malformed/)
    expect(bad({ maxLinkedPage: 2.5 })).toMatch(/malformed/)
    expect(bad({ codes: ['pr1'] })).toMatch(/malformed/) // an ok page's codes are its cards
    expect(bad({ ages: [0] })).toMatch(/malformed/)
    expect(bad({ codes: ['pr1', 7 as never] })).toMatch(/malformed/)
    expect(bad({ outcome: 'empty', cards: 0 })).toMatch(/malformed/) // a page that was not read has no codes
  })
  it('ignores the log\'s own summary — the verdict comes from the page records', () => {
    const half = listRecords(20, 1, (p) => (p.page > 10 ? { outcome: 'error', cards: 0, codes: [], ages: [], maxLinkedPage: null } : {}))
    expect(crawlCoverage(log({ summary: { apartments: { endReached: true, okShare: 1 } }, crawls: [crawl('apartments', half), crawl('apartmentsMini', MINI)] }), NOW).problem).toMatch(/end of results was not reached/)
  })
})

describe('parseCrawlLog — what was READ, even when the set is refused', () => {
  it('an unfinished or partial crawl still says which codes it read (the importer\'s carried-over test)', () => {
    const p = parseCrawlLog(log({ finished: false, finishedAt: null, aborted: 'crashed' }), NOW)
    expect(p.problem).toBeNull()
    if (p.problem !== null) return
    expect(p.log.codes.has(APTS[3].codes[0])).toBe(true)
    expect(p.log.codes.has(MINI[9].codes[1])).toBe(true)
    expect(coverageOfLog(p.log).problem).toMatch(/did not finish/)
  })
  it('counts the codes the catch-up pass found', () => {
    const cu = [{ ...APTS[0], codes: ['pr47777771', APTS[0].codes[0]], target: 1, unseen: 1 }, { ...APTS[1], target: 1, unseen: 0 }]
    const p = parseCrawlLog(log({ crawls: [crawl('apartments', APTS, { catchUp: cu }), crawl('apartmentsMini', MINI)] }), NOW)
    expect(p.problem === null && p.log.codes.has('pr47777771')).toBe(true)
    expect(crawlCoverage(log({ crawls: [crawl('apartments', APTS, { catchUp: cu }), crawl('apartmentsMini', MINI)] }), NOW).problem).toBeNull()
  })
})

describe('crawlBindingProblem — the log must describe THIS file', () => {
  const read = new Set(['pr46000001', 'pr46000002'])
  it('binds when the codes are the same', () => {
    expect(crawlBindingProblem(['pr46000002', 'pr46000001'], read)).toBeNull()
  })
  it('refuses a file row the crawl did not read, and a read code missing from the file', () => {
    expect(crawlBindingProblem(['pr46000001', 'pr46000002', 'pr46000003'], read)).toMatch(/1 row\(s\) of the file were not read/)
    expect(crawlBindingProblem(['pr46000001'], read)).toMatch(/1 code\(s\) it read are not in the file/)
    expect(crawlBindingProblem(['pr46000001', 'pr46000002', undefined], read)).toMatch(/1 row/)
  })
})

describe('judgeBdsRow — one judgement for the import gate and the fresh set, AT THE FETCH MOMENT', () => {
  const ctx = (over: Partial<BdsJudgeContext> = {}): BdsJudgeContext => ({ readAtMs: START, limitDays: FRESH_DAYS, carried: () => false, ...over })
  it('dates a fresh row at the far end of its label, counted back from the earliest read', () => {
    expect(judgeBdsRow({ code: 'pr46000001', published: 'Đăng 3 ngày trước' }, ctx())).toEqual({ kind: 'fresh', sourceDate: new Date(START - 4 * DAY) })
  })
  it('calls a coarse or old label old, an unreadable one unknown', () => {
    expect(judgeBdsRow({ code: 'pr46000001', published: 'Đăng 1 tuần trước' }, ctx()).kind).toBe('old')
    expect(judgeBdsRow({ code: 'pr46000001', published: '' }, ctx()).kind).toBe('unknown')
    expect(judgeBdsRow({ code: 'pr46000001', published: 'Đăng 12/09/2026' }, ctx()).kind).toBe('unknown')
  })
  it('"Đăng 6 ngày trước" (6 to <7 days when read) is inside the 7-day window at the fetch — however long ago the fetch was, and on a fractional read instant', () => {
    for (const readAtMs of [NOW, NOW - 1, NOW - 23 * 3_600_000, START + 0.37]) {
      const v = judgeBdsRow({ code: 'pr46000001', published: 'Đăng 6 ngày trước' }, ctx({ readAtMs }))
      expect(v).toEqual({ kind: 'fresh', sourceDate: new Date(Math.floor(readAtMs) - 7 * DAY) })
    }
  })
  it('a row not proven to be from this scrape is carried, never judged', () => {
    expect(judgeBdsRow({ code: 'pr46000001', published: 'Đăng hôm nay' }, ctx({ carried: () => true })).kind).toBe('carried')
    expect(judgeBdsRow({ published: 'Đăng hôm nay' }, ctx()).kind).toBe('carried')
  })
  it('equals the worst-case cut with no time elapsed since the read, on every label and limit', () => {
    const labels = ['Đăng hôm nay', 'Đăng hôm qua', 'Đăng 2 ngày trước', 'Đăng 5 ngày trước', 'Đăng 6 ngày trước', 'Đăng 7 ngày trước', 'Đăng 1 tuần trước', 'Tin VIP']
    for (const published of labels) {
      for (const limitDays of [3, 7, 14]) {
        expect(judgeBdsRow({ code: 'pr46000001', published }, ctx({ limitDays })).kind === 'fresh', `${published} ≤${limitDays}d`).toBe(ageWithin(bdsAgeDays(published), 0, limitDays))
      }
    }
  })
})

describe('buildBdsFreshSet — every fresh APARTMENT, whatever the mapper makes of it', () => {
  const rows = [
    { code: 'pr46000001', published: 'Đăng hôm nay', property_type: 'Căn hộ / Chung cư', price_type: 'negotiable' },
    { code: 'pr46000002', published: 'Đăng 2 ngày trước', property_type: 'Căn hộ / Chung cư' },
    { code: 'pr46000003', published: 'Đăng 2 tuần trước', property_type: 'Căn hộ / Chung cư' },
    { code: 'pr46000004', published: '', property_type: 'Căn hộ / Chung cư' },
    { code: 'pr46000005', published: 'Đăng hôm nay', property_type: 'Nhà phố / Biệt thự' },
    { code: 'pr46000001', published: 'Đăng hôm nay', property_type: 'Căn hộ / Chung cư' },
    { code: 'pr123', published: 'Đăng hôm nay', property_type: 'Căn hộ / Chung cư' },
    { code: 'pr46000006', published: 'Đăng hôm nay', property_type: 'Căn hộ / Chung cư' },
  ]
  const build = () => buildBdsFreshSet(rows, {
    sellerId: SELLER, fetchedAt: new Date(START), coverage: 'pages 1–20 read; end reached',
    isApartment: (pt) => pt === 'Căn hộ / Chung cư',
    judge: (r) => judgeBdsRow(r, { readAtMs: START, limitDays: FRESH_DAYS, carried: (code) => code === 'pr46000006' }),
  })
  it('keeps fresh apartments (a negotiable one included), lists unreadable ones as unknown, drops the rest', () => {
    const { set, counts } = build()
    expect(set.items.map((i) => i.externalId)).toEqual(['bds:pr46000001', 'bds:pr46000002'])
    expect(set.unknown).toEqual(['bds:pr46000004'])
    expect(counts).toMatchObject({ rows: 8, apartments: 7, fresh: 2, old: 1, unknown: 1, carried: 1, duplicate: 1, badCode: 1 })
  })
  it('writes the worst-case date as a renewal label, and passes the expiry\'s own check', () => {
    const { set } = build()
    expect(set.items[0]).toEqual({ externalId: 'bds:pr46000001', sourceDate: new Date(START - DAY).toISOString(), dateKind: 'renewal-label' })
    expect(set.fetchedAt).toBe(new Date(START).toISOString())
    expect(freshSetProblem(set, NOW, SELLER)).toBeNull()
  })
  it('a set judged at the fetch stays valid on its 7-day edge ("Đăng 6 ngày trước" read 20 h before the import and the expiry)', () => {
    const readAtMs = NOW - 20 * 3_600_000 + 0.5
    const { set } = buildBdsFreshSet([{ code: 'pr46000009', published: 'Đăng 6 ngày trước', property_type: 'x' }], {
      sellerId: SELLER, fetchedAt: new Date(Math.floor(readAtMs)), coverage: 'c', isApartment: () => true,
      judge: (r) => judgeBdsRow(r, { readAtMs, limitDays: FRESH_DAYS, carried: () => false }),
    })
    expect(set.items).toHaveLength(1)
    expect(freshSetProblem(set, NOW, SELLER)).toBeNull()
  })
  it('refuses a seller with no id shape', () => {
    expect(() => buildBdsFreshSet([], { sellerId: 'nobody', fetchedAt: new Date(NOW), coverage: 'c', isApartment: () => true, judge: () => ({ kind: 'unknown' }) })).toThrow(/shape/)
  })
})
