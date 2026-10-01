/**
 * BATDONGSAN.COM.VN — WHAT A SCRAPE PROVES, for the 7-day rule (src/lib/apartment-freshness.ts).
 * Owner, 2026-10-01: an imported apartment stays live only while its source shows it posted or re-posted
 * within 7 days; refreshed weekly. Pure — no database, no network, no clock (callers pass `now`).
 *
 * The importer (scripts/import-batdongsan-rentals.ts) reads a scrape FILE, not the site: Cloudflare
 * answers every automated request with a challenge, so only ~/batdongsan_rentals_hcmc/scraper.py (a real,
 * headed Chrome) can read the list. A fresh set built from that file can only be as whole as the crawl
 * behind it, and the file alone cannot say how the crawl went — a blocked crawl writes a short file that
 * looks like any other. So the scraper writes a CRAWL LOG next to it (all_rentals.crawl.json): per list it
 * crawled, every page it asked for and what came back (ok / empty / redirect / error / challenge), with the
 * listing codes on it. This module re-derives the verdict from those per-page records — never from the
 * log's own summary — and refuses a set unless EVERY list was read from page 1 to the END OF RESULTS, at
 * every page of results was read successfully at least once, and the catch-up pass below was done.
 *
 * ⛔ BOTH APARTMENT LISTS (2026-10-01 verifier, P1). Batdongsan lists "Căn hộ chung cư" and "Chung cư mini,
 * căn hộ dịch vụ" separately (/cho-thue-can-ho-chung-cu-tp-hcm and /cho-thue-can-ho-chung-cu-mini-tp-hcm),
 * and the importer maps BOTH to apartment-rental (5,739 of the 13,931 apartment rows of the 2026-10-01
 * scrape are mini). A set built from one list would expire every live row of the other whatever its age,
 * so a set needs BDS_APARTMENT_LISTS both crawled whole (or the `all` list, which carries both).
 *
 * ⛔ THE END OF RESULTS IS PROVEN BY THE SITE'S OWN PAGINATION, NOT BY "A PAGE CAME BACK EMPTY". An empty
 * page in the middle of a 700-page list (a hiccup, a half-solved challenge) would otherwise end the crawl
 * at page 120 with a "complete" set, and the expiry would then take every flat on pages 121–700. Three
 * routes, all checked against every link the crawl saw:
 *   A. an ok page links to NO later list page, and no page the crawl read ever linked further;
 *   B. the page right after the last ok page, PAST the highest page any read page linked to, came back
 *      with no listings (or the site redirected it elsewhere) — only when some page showed a pagination
 *      link or the site's count at all (with neither, nothing says how long the list is);
 *   C. the list SHRANK while it was read: the last ok page's own pagination says it is the last page, and
 *      every page after it — up to and past the furthest page an earlier read linked to — came back empty
 *      or redirected (at most MAX_TAIL_PAGES of them; scraper.py gives up on more).
 * When a page showed the site's own count ("Hiện có 13.931 bất động sản"), the end page must also agree
 * with the latest one to within one page — a pagination that stops early (a capped list) is not the end.
 *
 * ⛔ THE CATCH-UP PASS (2026-10-01 verifier, P2). The list moves while it is read, and the ads that move
 * are the freshest: a new or pushed ("đẩy tin") ad lands at the TOP OF ITS TIER — Batdongsan shows VIP
 * tiers above ordinary ads, each tier newest first, and a push moves an ad to the top of its own tier
 * (trogiup.batdongsan.com.vn, "Đẩy tin" / "Câu hỏi liên quan đến Tin đăng"). An ad that moves from a page
 * not yet read to a page already read is never seen, and would be expired for a week. So after the end
 * is proven, scraper.py re-reads from every TIER TOP — page 1, every page where the card labels reset to
 * a newer age (the newest-first order restarting = a new tier, or a pushed ad), and every page that was
 * not read — and keeps reading while a page shows a code this crawl had not seen (catchUpTargets, the
 * same rule here and in the scraper). This module re-derives the targets from the logged ages and checks
 * every run against them; past catchUpCap pages the pass stops and the log says so (`catchUpCapped`).
 * ⚠️ WHAT IT STILL CANNOT SEE: an ad removed ahead of the crawl shifts every later card up by one, and the
 * card that moved from page k+1 to page k after page k was read is never seen. Over an hour's crawl that
 * is a handful of ads; the next weekly run sees them again.
 */
import { EXTERNAL_ID_SHAPE, makeFreshSet, type FreshItem, type FreshSet } from './apartment-freshness'
import { bdsAgeDays, bdsWorstCaseDate } from './batdongsan-age'

export const BDS_CRAWL_LOG_KIND = 'batdongsan-crawl-log'
/** v2: one record per list crawled (`crawls`), per-page codes and label ages, the catch-up pass. */
export const BDS_CRAWL_LOG_VERSION = 2
/** The lists scraper.py can read. Pinned: a log of any other list is not evidence for this seller. */
export const BDS_LIST_URLS = {
  all: 'https://batdongsan.com.vn/nha-dat-cho-thue-tp-hcm',
  apartments: 'https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-tp-hcm',
  apartmentsMini: 'https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-mini-tp-hcm',
} as const
export type BdsList = keyof typeof BDS_LIST_URLS
/** Batdongsan's two apartment lists. scraper.py --apartments crawls both; the importer maps both to apartment-rental. */
export const BDS_APARTMENT_LISTS = ['apartments', 'apartmentsMini'] as const satisfies readonly BdsList[]
/** The owner's floor (2026-10-01): a crawl that read fewer of its pages than this proves nothing. */
/**
 * Kept for the record: the share of page READS that succeeded is reported, but it no longer decides — see
 * coverageOfLog: every page of results must have one successful read (first read or catch-up), or the set
 * is refused (exit 3; that week imports what it read and skips the expiry).
 */
export const MIN_OK_PAGE_SHARE = 1
/** Route C: at most this many pages after the last page of results (scraper.py MAX_CONSECUTIVE_FAILURES). */
export const MAX_TAIL_PAGES = 5
/** A catch-up run reads at most this many pages from one tier top (scraper.py CATCHUP_MAX_RUN). */
export const CATCHUP_MAX_RUN = 5
/** The catch-up pass reads at most this many pages per list (scraper.py catchup_cap). */
export const catchUpCap = (endPage: number) => Math.max(50, Math.ceil(endPage / 4))
export const PAGE_OUTCOMES = ['ok', 'empty', 'redirect', 'error', 'challenge'] as const
export type PageOutcome = (typeof PAGE_OUTCOMES)[number]
const SKEW_MS = 5 * 60_000

export interface CrawlPage {
  page: number
  outcome: PageOutcome
  /** Listing cards found on the page as served. */
  cards: number
  /** The highest page number of THIS list that the page links to (its pagination), null when none. */
  maxLinkedPage: number | null
  /** The site's "Hiện có N bất động sản" when the page showed it. */
  totalCount: number | null
}

/** A page record as the log carries it: the codes of its cards and their label ages, in page order. */
export interface CrawlPageRecord extends CrawlPage {
  codes: string[]
  /** Each card's label age in whole days (bdsAgeDays().minDays), null when unreadable. */
  ages: (number | null)[]
}

/** A catch-up read: the tier top whose run it belongs to, and how many of its codes the crawl had not seen. */
export interface CatchUpRecord extends CrawlPageRecord {
  target: number
  unseen: number
}

export interface EndOfResults {
  /** The last page of results. */
  endPage: number
  /** The first page past the end the crawl asked for (routes B, C) — not a page of results. */
  probePage: number | null
  evidence: string
}

/**
 * Did the crawl reach the end of the list? `pages` must be contiguous from 1 and sorted (crawlCoverage
 * checks that first). Null = not proven — the set is refused. MIRRORED by end_of_results in scraper.py.
 */
export function endOfResults(pages: readonly CrawlPage[]): EndOfResults | null {
  const ok = pages.filter((p) => p.outcome === 'ok')
  if (!ok.length) return null
  // The furthest page the site itself pointed to, from any page that was read.
  const declared = Math.max(...ok.map((p) => Math.max(p.page, p.maxLinkedPage ?? 0)))
  const perPage = Math.max(...ok.map((p) => p.cards))
  const counted = [...ok].reverse().find((p) => p.totalCount !== null && p.totalCount >= 0)
  const countAgrees = (endPage: number) => {
    if (!counted || perPage <= 0) return { ok: true, note: 'no site count shown' }
    const need = Math.ceil((counted.totalCount as number) / perPage)
    return { ok: endPage >= need - 1, note: `site count ${counted.totalCount} at ${perPage}/page → ${need} pages` }
  }
  const last = pages[pages.length - 1]
  if (last.outcome === 'ok' && last.maxLinkedPage !== null && last.maxLinkedPage <= last.page && last.page >= declared) {
    const c = countAgrees(last.page)
    if (!c.ok) return null
    return { endPage: last.page, probePage: null, evidence: `page ${last.page} links to no later page and no page read linked past it (${c.note})` }
  }
  const lastOk = ok[ok.length - 1]
  const tail = pages.filter((p) => p.page > lastOk.page)
  if (!tail.length || !tail.every((p) => p.outcome === 'empty' || p.outcome === 'redirect') || !(last.page > declared)) return null
  // Route B needs SOME word from the site on how long the list is — a link or a count. With neither, an
  // empty page inside the list would read as "past the end" of a list we know nothing about.
  const sized = ok.some((p) => p.maxLinkedPage !== null) || !!counted
  const routeB = tail.length === 1 && sized
  const routeC = tail.length <= MAX_TAIL_PAGES && lastOk.maxLinkedPage !== null && lastOk.maxLinkedPage <= lastOk.page
  if (!routeB && !routeC) return null
  const c = countAgrees(lastOk.page)
  if (!c.ok) return null
  const how = tail.length === 1 ? `came back ${last.outcome === 'empty' ? 'with no listings' : 'redirected elsewhere'}` : `and the ${tail.length - 1} before it came back empty or redirected`
  return {
    endPage: lastOk.page, probePage: tail[0].page,
    evidence: routeB
      ? `page ${last.page}, past the last page any read page linked to (${declared}), ${how} (${c.note})`
      : `the list shrank while it was read: page ${lastOk.page}'s own pagination ends there, and page ${last.page}, past the last page any read page linked to (${declared}), ${how} (${c.note})`,
  }
}

/**
 * The pages the catch-up pass must re-read from (ascending): page 1, every page where the card label ages
 * RESET to a newer age (each tier is newest first, so a reset is a tier top — or a pushed ad, which sits on
 * top of its tier), and every page that was not read. Pages past `endPage` are not results. MIRRORED by
 * catchup_targets in scraper.py.
 */
export function catchUpTargets(pages: readonly { page: number; outcome: PageOutcome; ages: readonly (number | null)[] }[], endPage: number): number[] {
  const targets = new Set<number>([1])
  let prev: number | null = null
  for (const p of pages) {
    if (p.page > endPage) break
    if (p.outcome !== 'ok') { targets.add(p.page); prev = null; continue }
    for (const a of p.ages) {
      if (a === null) continue
      if (prev !== null && a < prev) targets.add(p.page)
      prev = a
    }
  }
  return [...targets].sort((a, b) => a - b)
}

/**
 * Was the catch-up pass done as the rule says? Re-walks the targets against the records, recomputing each
 * record's `unseen` from the codes. Null = done (possibly capped — the caller reports it).
 */
export function catchUpProblem(pages: readonly CrawlPageRecord[], endPage: number, catchUp: readonly CatchUpRecord[], capped: boolean): string | null {
  const seen = new Set<string>()
  for (const p of pages) if (p.outcome === 'ok') for (const c of p.codes) seen.add(c)
  const cap = catchUpCap(endPage)
  let i = 0
  let doneThrough = 0
  let hitCap = false
  for (const t of catchUpTargets(pages, endPage)) {
    if (t <= doneThrough) continue
    for (let n = t; ; n++) {
      if (i >= cap) { hitCap = true; break }
      const r = catchUp[i]
      if (!r) return `the catch-up pass never re-read page ${n} (the run from tier top ${t})`
      if (r.page !== n || r.target !== t) return `catch-up read ${i + 1} is page ${r.page} of the run from ${r.target}, expected page ${n} of the run from ${t}`
      let unseen = 0
      for (const c of new Set(r.codes)) if (!seen.has(c)) { unseen++; seen.add(c) }
      if (r.unseen !== unseen) return `catch-up read ${i + 1} (page ${n}) says ${r.unseen} unseen code(s), its codes say ${unseen}`
      i++
      doneThrough = n
      if (r.outcome !== 'ok' || unseen === 0 || n >= endPage || n - t + 1 >= CATCHUP_MAX_RUN) break
    }
    if (hitCap) break
  }
  if (i !== catchUp.length) return `the catch-up pass has ${catchUp.length - i} read(s) the rule did not ask for`
  if (hitCap !== capped) return hitCap ? `the catch-up pass reached its cap (${cap} pages) but the log does not say so` : 'the log says the catch-up pass was capped, but it finished every tier top'
  // ⛔ A capped catch-up did not finish: ads that moved past the cap during the crawl were never seen, and
  // the expiry would take them down for a week — the very case the catch-up exists for. Not whole.
  if (capped) return `the catch-up pass stopped at its cap (${cap} pages) before every tier top was re-read — listings that moved during the crawl may be missing`
  return null
}

export interface ParsedCrawl {
  list: BdsList
  startedAtMs: number
  finished: boolean
  aborted: string | null
  pages: CrawlPageRecord[]
  catchUp: CatchUpRecord[]
  catchUpCapped: boolean
  /** Every code read on an ok page of this list (main pass and catch-up). */
  codes: Set<string>
}

export interface ParsedCrawlLog {
  startedAtMs: number
  finishedAtMs: number | null
  finished: boolean
  aborted: string | null
  preexisting: number
  crawls: ParsedCrawl[]
  /** Every code read on an ok page of any list — what "read by this crawl" means. */
  codes: Set<string>
}

const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min
const intOrNull = (v: unknown) => (v === null || v === undefined ? null : isInt(v) ? v : NaN)
const dateMs = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN)

function parsePage(p: unknown, catchUp: boolean): CrawlPageRecord | CatchUpRecord | null {
  if (!p || typeof p !== 'object') return null
  const r = p as Record<string, unknown>
  const maxLinkedPage = intOrNull(r.maxLinkedPage)
  const totalCount = intOrNull(r.totalCount)
  if (!isInt(r.page, 1) || !(PAGE_OUTCOMES as readonly unknown[]).includes(r.outcome) || !isInt(r.cards) || Number.isNaN(maxLinkedPage) || Number.isNaN(totalCount)) return null
  if (!Array.isArray(r.codes) || !Array.isArray(r.ages) || r.codes.length !== r.ages.length) return null
  if (r.codes.some((c) => typeof c !== 'string' || !c) || r.ages.some((a) => a !== null && !isInt(a))) return null
  // Only an ok page's cards were read; its codes are exactly its cards.
  if (r.outcome === 'ok' ? r.codes.length !== r.cards : r.codes.length !== 0) return null
  const base: CrawlPageRecord = { page: r.page, outcome: r.outcome as PageOutcome, cards: r.cards, maxLinkedPage, totalCount, codes: r.codes as string[], ages: r.ages as (number | null)[] }
  if (!catchUp) return base
  if (!isInt(r.target, 1) || !isInt(r.unseen)) return null
  return { ...base, target: r.target, unseen: r.unseen }
}

/**
 * The crawl log, structurally checked — what it says was read, not yet whether that was the whole list.
 * Used on its own as the proof that a row of the scrape was read by THIS crawl (with crawlBindingProblem),
 * which the import needs even when the set is refused. `now` bounds the timestamps.
 */
export function parseCrawlLog(raw: unknown, now: number): { problem: string } | { problem: null; log: ParsedCrawlLog } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'the crawl log is not a JSON object' }
  const g = raw as Record<string, unknown>
  if (g.kind !== BDS_CRAWL_LOG_KIND) return { problem: `kind is ${JSON.stringify(g.kind)}, expected "${BDS_CRAWL_LOG_KIND}"` }
  if (g.v !== BDS_CRAWL_LOG_VERSION) return { problem: `version ${JSON.stringify(g.v)}, expected ${BDS_CRAWL_LOG_VERSION} — scrape again with the current scraper.py` }
  const startedAtMs = dateMs(g.startedAt)
  if (!Number.isFinite(startedAtMs)) return { problem: 'startedAt is missing or not a date' }
  if (startedAtMs > now + SKEW_MS) return { problem: `startedAt ${g.startedAt} is in the future` }
  const finishedAtMs = g.finishedAt === null || g.finishedAt === undefined ? null : dateMs(g.finishedAt)
  if (finishedAtMs !== null) {
    if (!Number.isFinite(finishedAtMs)) return { problem: 'finishedAt is not a date' }
    if (finishedAtMs < startedAtMs) return { problem: `finishedAt ${g.finishedAt} is before startedAt ${g.startedAt}` }
    if (finishedAtMs > now + SKEW_MS) return { problem: `finishedAt ${g.finishedAt} is in the future` }
  }
  if (!isInt(g.preexisting)) return { problem: `preexisting ${JSON.stringify(g.preexisting)} is not a row count` }
  if (g.aborted !== null && g.aborted !== undefined && typeof g.aborted !== 'string') return { problem: 'aborted is neither null nor a reason' }
  if (!Array.isArray(g.crawls) || !g.crawls.length) return { problem: 'the log records no crawls' }
  const crawls: ParsedCrawl[] = []
  const codes = new Set<string>()
  for (const [ci, c] of (g.crawls as unknown[]).entries()) {
    if (!c || typeof c !== 'object') return { problem: `crawl ${ci} is not an object` }
    const k = c as Record<string, unknown>
    const list = (Object.keys(BDS_LIST_URLS) as BdsList[]).find((l) => l === k.list)
    if (!list || k.listUrl !== BDS_LIST_URLS[list]) return { problem: `crawl ${ci}: list ${JSON.stringify(k.list)} / ${JSON.stringify(k.listUrl)} is not one of the pinned Batdongsan rental lists` }
    if (crawls.some((x) => x.list === list)) return { problem: `the ${list} list was crawled twice in one log` }
    const cStart = dateMs(k.startedAt)
    if (!Number.isFinite(cStart) || cStart < startedAtMs - SKEW_MS) return { problem: `crawl ${ci} (${list}): startedAt missing, or before the run's start` }
    if (typeof k.finished !== 'boolean') return { problem: `crawl ${ci} (${list}): finished is not a boolean` }
    if (k.aborted !== null && k.aborted !== undefined && typeof k.aborted !== 'string') return { problem: `crawl ${ci} (${list}): aborted is neither null nor a reason` }
    if (!Array.isArray(k.pages) || !Array.isArray(k.catchUp) || typeof k.catchUpCapped !== 'boolean') return { problem: `crawl ${ci} (${list}): pages / catchUp / catchUpCapped missing` }
    const pages: CrawlPageRecord[] = []
    for (const [i, p] of (k.pages as unknown[]).entries()) {
      const r = parsePage(p, false)
      if (!r) return { problem: `crawl ${ci} (${list}): page record ${i} is malformed: ${JSON.stringify(p).slice(0, 200)}` }
      pages.push(r)
    }
    pages.sort((a, b) => a.page - b.page)
    const catchUp: CatchUpRecord[] = []
    for (const [i, p] of (k.catchUp as unknown[]).entries()) {
      const r = parsePage(p, true) as CatchUpRecord | null
      if (!r) return { problem: `crawl ${ci} (${list}): catch-up record ${i} is malformed: ${JSON.stringify(p).slice(0, 200)}` }
      catchUp.push(r)
    }
    const listCodes = new Set<string>()
    for (const p of [...pages, ...catchUp]) if (p.outcome === 'ok') for (const code of p.codes) { listCodes.add(code); codes.add(code) }
    crawls.push({ list, startedAtMs: cStart, finished: k.finished, aborted: (k.aborted as string | null | undefined) ?? null, pages, catchUp, catchUpCapped: k.catchUpCapped, codes: listCodes })
  }
  return { problem: null, log: { startedAtMs, finishedAtMs, finished: g.finished === true, aborted: (g.aborted as string | null | undefined) ?? null, preexisting: g.preexisting, crawls, codes } }
}

export interface CrawlCoverage {
  lists: BdsList[]
  startedAtMs: number
  finishedAtMs: number
  /** Every listing code read on an ok page of any list. */
  codes: Set<string>
  /** The codes read on an apartment list — every one must be classified an apartment. */
  apartmentCodes: Set<string>
  /** Human-readable proof, written into the fresh set's `coverage`. */
  evidence: string
}

/** Does this set of lists carry every row the importer maps to apartment-rental? */
export const coversApartments = (lists: readonly BdsList[]) => lists.includes('all') || BDS_APARTMENT_LISTS.every((l) => lists.includes(l))

/** Was every list of a structurally sound log read whole? `{ problem }` = do not write a set. */
export function coverageOfLog(log: ParsedCrawlLog): { problem: string } | { problem: null; coverage: CrawlCoverage } {
  if (!log.finished || log.finishedAtMs === null) return { problem: 'the crawl did not finish (the log was last written mid-run) — scrape again' }
  if (log.aborted !== null) return { problem: `the crawl was aborted: ${log.aborted}` }
  // ⛔ A crawl that merged into an existing all_rentals.json carries that file's rows with their OLD labels.
  if (log.preexisting !== 0) return { problem: `the crawl merged into an existing file (${log.preexisting} rows carried in) — move all_rentals.json aside and scrape with --new` }
  const lists = log.crawls.map((c) => c.list)
  if (!coversApartments(lists)) return { problem: `the crawl read ${lists.join(' + ')} — not every list the importer maps to apartment-rental (${BDS_APARTMENT_LISTS.join(' + ')}, or all); a set from it would expire every live row of the other` }
  const parts: string[] = []
  const apartmentCodes = new Set<string>()
  for (const c of log.crawls) {
    const at = `${c.list} list`
    if (!c.finished) return { problem: `${at}: the crawl did not finish` }
    if (c.aborted !== null) return { problem: `${at}: the crawl was aborted: ${c.aborted}` }
    if (!c.pages.length) return { problem: `${at}: no pages recorded` }
    // ⛔ From page 1, every page once: a resumed crawl (scraper.py 300 …) covers only its own pages.
    for (let i = 0; i < c.pages.length; i++) {
      if (c.pages[i].page !== i + 1) return { problem: `${at}: pages are not 1…${c.pages.length} each once (found page ${c.pages[i].page} at position ${i + 1}) — the crawl must start at page 1 and skip nothing` }
    }
    const end = endOfResults(c.pages)
    if (!end) {
      const last = c.pages[c.pages.length - 1]
      return { problem: `${at}: the end of results was not reached — the last page asked for (${last.page}) was "${last.outcome}"${last.maxLinkedPage !== null ? ` and links up to page ${last.maxLinkedPage}` : ''}` }
    }
    const cu = catchUpProblem(c.pages, end.endPage, c.catchUp, c.catchUpCapped)
    if (cu) return { problem: `${at}: ${cu}` }
    // The pages of results and the catch-up reads; the probes past the end are not results.
    const counted = [...c.pages.filter((p) => p.page <= end.endPage), ...c.catchUp]
    const okCount = counted.filter((p) => p.outcome === 'ok').length
    const share = okCount / counted.length
    const tally = PAGE_OUTCOMES.map((o) => [o, counted.filter((p) => p.outcome === o).length] as const).filter(([, n]) => n > 0).map(([o, n]) => `${n} ${o}`).join(', ')
    // ⛔ Every page of results must have been read successfully at least once — a first read or a catch-up
    // re-read. A page never read is a page whose listings the expiry would take down as "not fresh".
    const readOk = new Set([...c.pages, ...c.catchUp].filter((p) => p.outcome === 'ok').map((p) => p.page))
    const unread = Array.from({ length: end.endPage }, (_, i) => i + 1).filter((n) => !readOk.has(n))
    if (unread.length) return { problem: `${at}: ${unread.length} page(s) of results never read successfully (${unread.slice(0, 10).join(', ')}${unread.length > 10 ? ', …' : ''}; ${tally}) — their listings would be expired unread` }
    if (!c.codes.size) return { problem: `${at}: the crawl read no listing codes` }
    if ((BDS_APARTMENT_LISTS as readonly string[]).includes(c.list)) for (const code of c.codes) apartmentCodes.add(code)
    const targets = catchUpTargets(c.pages, end.endPage)
    const found = c.catchUp.reduce((n, r) => n + r.unseen, 0)
    parts.push(`${BDS_LIST_URLS[c.list]} (${c.list}): pages 1–${end.endPage}, ${okCount} of ${counted.length} reads ok (${(share * 100).toFixed(1)}%: ${tally}); end of results: ${end.evidence}; catch-up: ${c.catchUp.length} page(s) from ${targets.length} tier top(s), ${found} listing(s) that moved during the crawl${c.catchUpCapped ? ` — CAPPED at ${catchUpCap(end.endPage)} pages` : ''}; ${c.codes.size} distinct codes`)
  }
  const evidence = `batdongsan crawl ${new Date(log.startedAtMs).toISOString()} → ${new Date(log.finishedAtMs).toISOString()}: ${parts.join(' | ')}; ${log.codes.size} distinct listing codes read`
  return { problem: null, coverage: { lists, startedAtMs: log.startedAtMs, finishedAtMs: log.finishedAtMs, codes: log.codes, apartmentCodes, evidence } }
}

/** parseCrawlLog + coverageOfLog: the crawl log's verdict, re-derived from its per-page records. */
export function crawlCoverage(raw: unknown, now: number): { problem: string } | { problem: null; coverage: CrawlCoverage } {
  const parsed = parseCrawlLog(raw, now)
  return parsed.problem !== null ? parsed : coverageOfLog(parsed.log)
}

/**
 * ⛔ THE LOG MUST DESCRIBE THIS FILE. Every row of the scrape must be a code the crawl read, and every
 * code it read must be in the file — a stale log next to a new file (or the reverse) is refused, not
 * reconciled. Null = bound.
 */
export function crawlBindingProblem(fileCodes: readonly unknown[], logCodes: ReadonlySet<string>): string | null {
  const inFile = new Set<string>()
  let unread = 0
  for (const c of fileCodes) {
    if (typeof c !== 'string' || !logCodes.has(c)) { unread++; continue }
    inFile.add(c)
  }
  const missing = [...logCodes].filter((c) => !inFile.has(c)).length
  if (unread || missing) return `the crawl log does not describe this scrape file: ${unread} row(s) of the file were not read by that crawl, ${missing} code(s) it read are not in the file`
  return null
}

export type BdsVerdict =
  | { kind: 'fresh'; sourceDate: Date }
  | { kind: 'old'; sourceDate: Date }
  /** The label could not be read (empty, an absolute date, a new wording) — not evidence either way. */
  | { kind: 'unknown' }
  /** The label is not proven to be from this scrape. */
  | { kind: 'carried' }

export interface BdsJudgeContext {
  /** The earliest the labels can have been read — bdsScrapeStartMs. The fresh set's fetchedAt. */
  readAtMs: number
  limitDays: number
  /** Is this row's label NOT proven to be from this scrape? */
  carried: (code: string, label: string) => boolean
}

/**
 * ONE judgement for the importer's age gate AND its --fresh-out set, so "imported / revived" and "kept
 * live" can never disagree. The date is the label's worst case — its far end counted back from the
 * earliest read — and the window is judged AT THAT FETCH MOMENT (the lead, 2026-10-01; the fresh set's
 * fetchedAt, which freshSetProblem judges by), not at the import: "Đăng 6 ngày trước" (6 to <7 days) is
 * inside a 7-day window when it is read, whenever the import runs. That reduces to the label's far end.
 */
export function judgeBdsRow(row: { code?: unknown; published?: unknown }, ctx: BdsJudgeContext): BdsVerdict {
  const code = typeof row.code === 'string' ? row.code : ''
  const label = String(row.published ?? '')
  if (!code || ctx.carried(code, label)) return { kind: 'carried' }
  const age = bdsAgeDays(label)
  if (!age) return { kind: 'unknown' }
  const sourceDate = bdsWorstCaseDate(age, ctx.readAtMs)
  return age.maxDays <= ctx.limitDays ? { kind: 'fresh', sourceDate } : { kind: 'old', sourceDate }
}

export interface BdsFreshCounts { rows: number; apartments: number; fresh: number; old: number; unknown: number; carried: number; duplicate: number; badCode: number }

/**
 * The fresh set: every APARTMENT row of the scrape the judgement calls fresh — whatever the importer's
 * mapper later makes of it (a negotiable price, no coordinates, a content-screen refusal) and whether or
 * not it is already in the database. Unreadable labels go to `unknown` (kept live, never created). The
 * caller validates the result with freshSetProblem before writing it.
 */
export function buildBdsFreshSet(
  rows: readonly { code?: unknown; published?: unknown; property_type?: unknown }[],
  ctx: { sellerId: string; fetchedAt: Date; coverage: string; isApartment: (propertyType: unknown) => boolean; judge: (row: { code?: unknown; published?: unknown }) => BdsVerdict },
): { set: FreshSet; counts: BdsFreshCounts } {
  const shape = EXTERNAL_ID_SHAPE[ctx.sellerId]
  if (!shape) throw new Error(`${ctx.sellerId} has no externalId shape`)
  const counts: BdsFreshCounts = { rows: rows.length, apartments: 0, fresh: 0, old: 0, unknown: 0, carried: 0, duplicate: 0, badCode: 0 }
  const items: FreshItem[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!ctx.isApartment(r.property_type)) continue
    counts.apartments++
    const externalId = `bds:${typeof r.code === 'string' ? r.code : ''}`
    if (!shape.test(externalId)) { counts.badCode++; continue }
    if (seen.has(externalId)) { counts.duplicate++; continue }
    seen.add(externalId)
    const v = ctx.judge(r)
    counts[v.kind]++
    if (v.kind === 'fresh') items.push({ externalId, sourceDate: v.sourceDate.toISOString(), dateKind: 'renewal-label' })
    else if (v.kind === 'unknown') unknown.push(externalId)
  }
  return { set: makeFreshSet(ctx.sellerId, ctx.fetchedAt, ctx.coverage, items, unknown), counts }
}
