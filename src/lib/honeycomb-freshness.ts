/**
 * THE FRESHNESS RULE, HONEYCOMB HALF — pure (no DB, no network). scripts/import-honeycomb-com-vn.ts uses it
 * to write the FRESH SET (--fresh-out, on the run that reads the site) and, on --apply, to revive rows
 * and move postedAt. The rule and the set's format live in src/lib/apartment-freshness.ts.
 *
 * ⛔ HONEYCOMB'S WINDOW IS 30 DAYS, NOT THE 7 OF THE OTHER SOURCES (2026-10-02): HONEYCOMB_WINDOW_DAYS =
 * windowDaysFor(HONEYCOMB_SELLER_ID), the one table in apartment-freshness.ts. EVERY window judgement in this
 * file uses it — the --fresh-out guard (--since-days 30), the detail read's start, the fresh set's items and
 * the window it records, the bulk re-save share, the revival and the postedAt move — so the stage, the set,
 * the apply and the expiry can never disagree about which flats are fresh. Never FRESH_DAYS here.
 *
 * THE DATE IS THE SITEMAP <lastmod> of the property's URL (dateKind 'modified'): the agency re-touching a
 * listing is this source's "re-posted". Nothing else on the page carries a date (honeycomb-listing.ts).
 * Measured 2026-10-01 (estate_property sitemaps 1, 6 and 7 — 4,822 of the 12,822 urls): every url carries a
 * lastmod, every lastmod is a full timestamp with an offset ("2026-09-17T16:24:25+07:00"), and the newest of
 * them was 2026-09-17 — none inside the 7 days before the check.
 *
 * ⛔ THE SET IS WRITTEN ONLY WHEN THE READ PROVABLY COVERED THE WINDOW (buildHoneycombFreshSet): the index
 * listed estate_property sitemaps 1…N with no gap, every one answered 200 with urls in it and ENDS WITH
 * </urlset> (a cut-off body is not a page), pages 1…N−1 hold exactly WP_SITEMAP_MAX_URLS (2,000) and page N
 * fewer (a stale index that drops the newest page shows as a full last page — sitemapReadProblem), neither
 * the index nor any page came from the LiteSpeed page cache (sitemapCacheProblem), no --limit, the detail
 * read was not stopped, every url whose lastmod is in the window had its page read, and those pages did not
 * mostly answer 404/410 (inWindowGoneProblem — the sitemap lists them as published).
 * Measured 2026-10-02 (wp-sitemap.xml + pages 1, 6, 7, 8): pages 1…6 hold 2,000 urls each, page 7 holds 822,
 * every body ends "</urlset>\n", and page 8 answers 404.
 * ⛔ THE SITE'S LITESPEED PAGE CACHE SERVES THE SITEMAPS UP TO 7 DAYS STALE (measured 2026-10-02: the plain
 * /wp-sitemap.xml answers `x-litespeed-cache: hit`, the cache policy is `public,max-age=604800`) — a cached
 * page shows last week's lastmods, so an ad re-posted since reads as old and would be EXPIRED. The stage
 * requests the index and every page with a cache-busting query (cacheBustedUrl: `?eno=<run start ms>`, a key
 * the cache has never seen — measured: both answer `miss`), keeps the canonical url for parsing and the
 * coverage text, records each file's header, and refuses the set if any of them still answers `hit`.
 * ⛔ A SITE-WIDE RE-SAVE IS NOT A RE-POST: when more than BULK_RESAVE_MAX_SHARE of ALL property urls carry
 * a lastmod in the window, lastmod says nothing about the market — no set is written, and the apply
 * neither revives nor moves postedAt on that evidence (lastmodTrust).
 */
import {
  FRESH_SET_MAX_AGE_MS, REVIVABLE_STATUSES, freshSetProblem, isInWindow, makeFreshSet, windowDaysFor,
  type FreshItem, type FreshSet,
} from './apartment-freshness'
import {
  EXTERNAL_ID_PREFIX, HONEYCOMB_SELLER_ID, Infeasible, allowedTarget, isGoneStatus, isPropertySitemap, parseHoneycombPage,
  parseUrlset, stageHoneycombRecord, type Got, type SitemapEntry, type StagedHoneycomb,
} from './honeycomb-listing'
import { pdpTombstoneTags } from './job-listing'

const DAY_MS = 86_400_000
/** Honeycomb's freshness window in days (30) — from the per-seller table, never a literal. */
export const HONEYCOMB_WINDOW_DAYS = windowDaysFor(HONEYCOMB_SELLER_ID)
/** Asia/Ho_Chi_Minh is UTC+7 all year — no daylight saving. */
const VN_OFFSET_MS = 7 * 3_600_000
/** More than this share of ALL property urls modified in the window = a bulk re-save, not re-posting. */
export const BULK_RESAVE_MAX_SHARE = 0.25
/** Past this share of sitemap urls that are not /property/<slug>/ urls, the site's url shape changed. */
export const OFF_SHAPE_MAX_SHARE = 0.01
/** From this many in-window sitemap urls answering 404/410 … */
export const GONE_MIN_URLS = 3
/** … and over this share of all the urls in the window, the read is a site fault, not the market (inWindowGoneProblem). */
export const GONE_MAX_SHARE = 0.5

/**
 * ⛔ WHY THE IN-WINDOW PAGES' 404/410s MAKE THE READ UNTRUSTWORTHY, or null (review of 2026-10-02). WordPress's
 * sitemap lists PUBLISHED posts only, and this run read it (cache-busted, so not last week's copy) minutes
 * before it requested the pages — so a url in the window answering 404/410 contradicts the sitemap: either the
 * post was unpublished in those minutes, or the site is not serving its own pages (a rewrite fault, a broken
 * theme or plugin). Measured 2026-10-02: 31 pages read in the window, 0 gone. A few are noise and are judged
 * gone as before; from GONE_MIN_URLS with over GONE_MAX_SHARE of the window gone, no set is written — "not in
 * the set" would otherwise take down every flat whose page the fault hid (the reproduced case: every in-window
 * page 404, the set 0 items / 0 undetermined, the plan expiring all 24 live rows). planExpiry's carry-over
 * guard refuses that set too; this refuses it where the cause is visible.
 */
export function inWindowGoneProblem(gone: number, inWindow: number): string | null {
  if (gone >= GONE_MIN_URLS && gone > GONE_MAX_SHARE * inWindow) {
    return `${gone} of the ${inWindow} sitemap urls in the window answered 404/410 — over ${GONE_MAX_SHARE * 100}% of pages the sitemap lists as published: the site is not serving its own pages (a rewrite or theme fault), not the market taking them down`
  }
  return null
}

const validYmd = (y: number, mo: number, d: number) => {
  const t = new Date(Date.UTC(y, mo - 1, d))
  // Date.UTC maps a year under 100 to 19xx and rolls Feb 30 into March — both fail the round trip.
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/**
 * The OLDEST instant a sitemap `lastmod` can mean, or null when it cannot be read.
 *   · a full timestamp WITH an offset or Z ("2026-09-17T16:24:25+07:00") — that instant; a missing
 *     seconds or fraction part is its start (16:24 → 16:24:00.000);
 *   · a bare date ("2026-09-17") — the START of that day in Asia/Ho_Chi_Minh;
 *   · ⛔ anything else is null, including a timestamp with NO offset: `Date.parse` reads that in the
 *     clock of whichever machine runs the import, so its instant is not knowable.
 */
export function honeycombSourceDate(lastmod: string | null | undefined): Date | null {
  if (typeof lastmod !== 'string') return null
  const s = lastmod.trim()
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (day) {
    const [y, mo, d] = [Number(day[1]), Number(day[2]), Number(day[3])]
    return validYmd(y, mo, d) ? new Date(Date.UTC(y, mo - 1, d) - VN_OFFSET_MS) : null
  }
  const ts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(s)
  if (!ts) return null
  const [y, mo, d, h, mi] = [Number(ts[1]), Number(ts[2]), Number(ts[3]), Number(ts[4]), Number(ts[5])]
  const sec = ts[6] === undefined ? 0 : Number(ts[6])
  // Truncated, never rounded: .9996 s is still inside second :00.999 at the earliest.
  const ms = ts[7] === undefined ? 0 : Number(ts[7].slice(0, 3).padEnd(3, '0'))
  if (!validYmd(y, mo, d) || h > 23 || mi > 59 || sec > 59) return null
  let offsetMs = 0
  if (ts[8] !== 'Z') {
    const oh = Number(ts[8].slice(1, 3))
    const om = Number(ts[8].slice(4, 6))
    if (oh > 14 || om > 59) return null
    offsetMs = (ts[8][0] === '-' ? -1 : 1) * (oh * 60 + om) * 60_000
  }
  return new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms) - offsetMs)
}

/**
 * Why the index's list of estate_property sitemaps is not provably whole, or null. WordPress pages the
 * posts sitemap as -1.xml … -N.xml; a gap or a duplicate means a page of it is missing from what we read.
 */
export function propertySitemapsProblem(urls: readonly string[]): string | null {
  if (!urls.length) return 'the sitemap index lists no estate_property sitemap'
  const nums: number[] = []
  for (const u of urls) {
    const m = isPropertySitemap(u) ? /-(\d+)\.xml$/.exec(u) : null
    if (!m) return `${u} is not an estate_property sitemap`
    nums.push(Number(m[1]))
  }
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  if (sorted.length !== urls.length) return `the index lists an estate_property sitemap twice (${nums.join(', ')})`
  if (sorted[0] !== 1 || sorted[sorted.length - 1] !== sorted.length) {
    return `the index lists estate_property sitemaps ${sorted.join(', ')} — not 1…${sorted.length}; a page of the sitemap is missing`
  }
  return null
}

/** How many property urls carry a lastmod at or after the window's start (in the window, or later). */
export function recentShare(entries: readonly SitemapEntry[], fetchedAtMs: number, windowDays: number = HONEYCOMB_WINDOW_DAYS): { recent: number; total: number } {
  const from = fetchedAtMs - windowDays * DAY_MS
  let recent = 0
  for (const e of entries) {
    const d = honeycombSourceDate(e.lastmod)
    if (d && d.getTime() >= from) recent++
  }
  return { recent, total: entries.length }
}

/** ⛔ The bulk re-save guard: why lastmod is no evidence of re-posting this run, or null. */
export function bulkResaveProblem(recent: number, total: number, windowDays: number = HONEYCOMB_WINDOW_DAYS): string | null {
  if (total > 0 && recent > BULK_RESAVE_MAX_SHARE * total) {
    return `${recent} of ${total} property urls (${((recent / total) * 100).toFixed(1)}%) carry a lastmod in the ${windowDays} days before the fetch — over ${BULK_RESAVE_MAX_SHARE * 100}%: a site-wide re-save, not the market re-listing`
  }
  return null
}

/**
 * Whether this run may treat a lastmod as "re-posted" at all — the apply's gate for revival and the
 * postedAt refresh. ⛔ Needs the WHOLE sitemap (else the re-save share cannot be measured) and a share
 * under the bulk guard. Not trusted = no revival and no postedAt change; create/update go on as before.
 */
export function lastmodTrust(stage: { fetchedAt: string; sitemap: { complete: boolean; entries: readonly SitemapEntry[] } }):
  { ok: true; recent: number; total: number } | { ok: false; reason: string } {
  const at = Date.parse(stage.fetchedAt)
  if (!Number.isFinite(at)) return { ok: false, reason: `fetchedAt ${JSON.stringify(stage.fetchedAt)} is not a date` }
  if (!stage.sitemap.complete) return { ok: false, reason: 'the staged sitemap read is incomplete — the bulk re-save share cannot be measured' }
  const { recent, total } = recentShare(stage.sitemap.entries, at)
  const bulk = bulkResaveProblem(recent, total)
  return bulk ? { ok: false, reason: bulk } : { ok: true, recent, total }
}

/** One estate_property sitemap as the stage read it: its CANONICAL url (the cache-busting query is not part
 *  of it), HTTP status, <url> entries parsed, how many of those passed allowedTarget (the only urls kept),
 *  whether the body ENDS with </urlset> (`closed`), and its `x-litespeed-cache` header (`cache`, null when
 *  the response carried none). */
export type SitemapFileRead = { url: string; status: number; urls: number; kept: number; closed: boolean; cache: string | null }

/**
 * Does this sitemap body end with its closing </urlset>? parseUrlset is a regex over <url> blocks, so a
 * body cut off mid-transfer (a dropped connection, a proxy limit) parses to FEWER urls and nothing else
 * notices. </urlset> is the document's last element; trailing whitespace and XML comments (a page-cache
 * plugin's footer) may follow it, nothing else may.
 */
export function sitemapBodyClosed(xml: string): boolean {
  return /<\/urlset>\s*(?:<!--[\s\S]*?-->\s*)*$/.test(xml)
}

/** One estate_property sitemap response → what the stage records about it, and its kept property urls.
 *  `url` is the CANONICAL sitemap url (as the index lists it), whatever query the request carried. */
export function sitemapFileRead(url: string, got: Pick<Got, 'status' | 'body' | 'litespeedCache'>): { read: SitemapFileRead; entries: SitemapEntry[] } {
  const cache = got.litespeedCache ?? null
  if (got.status !== 200) return { read: { url, status: got.status, urls: 0, kept: 0, closed: false, cache }, entries: [] }
  const xml = got.body.toString('utf8')
  const urls = parseUrlset(xml)
  const entries = urls.filter((e) => allowedTarget(e.url))
  return { read: { url, status: got.status, urls: urls.length, kept: entries.length, closed: sitemapBodyClosed(xml), cache }, entries }
}

/** The query parameter that keys a sitemap request past the LiteSpeed page cache. */
export const CACHE_BUST_PARAM = 'eno'

/**
 * The url the stage REQUESTS for a sitemap (`url` itself stays the one parsed and reported): `?eno=<run
 * start ms>` — a cache key nobody has requested before, so LiteSpeed answers from WordPress (measured
 * 2026-10-02: `x-litespeed-cache: miss` on the index and on page 7, the same 7 property sitemaps listed,
 * page 7 whole). One value per run, so a run reads every file at the same key.
 */
export function cacheBustedUrl(url: string, runStartMs: number): string {
  if (!Number.isSafeInteger(runStartMs) || runStartMs <= 0) throw new Error(`cacheBustedUrl: run start ${runStartMs} is not a positive integer`)
  return `${url}${url.includes('?') ? '&' : '?'}${CACHE_BUST_PARAM}=${runStartMs}`
}

/** Whether an `x-litespeed-cache` value says the page came from the cache ('hit', 'hit,private', …). */
export const isCacheHit = (header: string | null | undefined) => /^\s*hit\b/i.test(header ?? '')
/** A header value as printed in a reason or the coverage text: printable ASCII, ≤40 chars; 'none' when absent. */
const cacheLabel = (h: string | null | undefined) => (h ?? '').trim().replace(/[^\x20-\x7e]/g, '?').slice(0, 40) || 'none'

/**
 * ⛔ Why the sitemap read may be a CACHED copy, or null: the index or any estate_property page answered
 * `x-litespeed-cache: hit` despite the cache-busting query. A cached sitemap is up to 7 days old — its
 * lastmods miss every re-post since, and the expiry would take those ads down. A missing header (no page
 * cache in front) is not a hit.
 */
export function sitemapCacheProblem(indexCache: string | null, maps: readonly SitemapFileRead[]): string | null {
  const hits = [
    ...(isCacheHit(indexCache) ? [`/wp-sitemap.xml (${cacheLabel(indexCache)})`] : []),
    ...maps.filter((m) => isCacheHit(m.cache)).map((m) => `${m.url} (${cacheLabel(m.cache)})`),
  ]
  return hits.length ? `${hits.length} sitemap file(s) came from the LiteSpeed page cache (x-litespeed-cache: hit) despite the cache-busting query — up to 7 days stale: ${hits.join('; ')}` : null
}

/** The per-file `x-litespeed-cache` evidence for the coverage text: "index miss · -1 miss · … · -7 miss". */
export function sitemapCacheSummary(indexCache: string | null, maps: readonly SitemapFileRead[]): string {
  const num = (m: SitemapFileRead) => Number(/-(\d+)\.xml$/.exec(m.url)?.[1] ?? NaN)
  return [`index ${cacheLabel(indexCache)}`, ...[...maps].sort((a, b) => num(a) - num(b)).map((m) => `-${num(m)}.xml ${cacheLabel(m.cache)}`)].join(' · ')
}

/** WordPress core's sitemap page size (wp_sitemaps_get_max_urls), measured on this site 2026-10-02. */
export const WP_SITEMAP_MAX_URLS = 2000

/**
 * ⛔ Why the estate_property sitemaps as read are NOT provably the whole sitemap, or null. Beyond 1…N with
 * no gap (propertySitemapsProblem):
 *   · every page answered 200, holds urls, and ends with </urlset> — a cut-off body is not a page;
 *   · WordPress fills every page but the last to its page size, so pages 1…N−1 must each hold EXACTLY
 *     WP_SITEMAP_MAX_URLS (2,000, measured) — not "as many as page 1": a page 1 cut short in a way that still
 *     closed would otherwise set the bar for the rest. A page size the site changes fails closed until it
 *     is measured again;
 *   · page N must hold FEWER than WP_SITEMAP_MAX_URLS — a full last page means the index may be stale (a
 *     cached wp-sitemap.xml) and leave out page N+1: WordPress pages posts by ascending id, so the page left
 *     out holds the newest, likeliest-fresh listings. A single page is page N.
 *     (Fails closed on the 1-in-2,000 week whose total is an exact multiple; the backstop covers it.)
 */
export function sitemapReadProblem(maps: readonly SitemapFileRead[]): string | null {
  const listed = propertySitemapsProblem(maps.map((m) => m.url))
  if (listed) return listed
  const bad = maps.filter((m) => m.status !== 200 || m.urls === 0 || !m.closed)
  if (bad.length) {
    const why = (m: SitemapFileRead) => m.status !== 200 ? `HTTP ${m.status}` : m.urls === 0 ? '200 with no urls' : 'body does not end with </urlset> (cut off)'
    return `${bad.length} of ${maps.length} estate_property sitemaps not read whole: ${bad.map((m) => `${m.url} → ${why(m)}`).join('; ')}`
  }
  const num = (m: SitemapFileRead) => Number(/-(\d+)\.xml$/.exec(m.url)![1])
  const pages = [...maps].sort((a, b) => num(a) - num(b))
  const last = pages[pages.length - 1]
  if (pages.length === 1) {
    return last.urls >= WP_SITEMAP_MAX_URLS ? `the only estate_property sitemap holds ${last.urls} urls — a full page; the index may be leaving out the pages after it` : null
  }
  const uneven = pages.slice(0, -1).filter((m) => m.urls !== WP_SITEMAP_MAX_URLS)
  if (uneven.length) return `pages 1…${pages.length - 1} of the estate_property sitemap must each hold exactly ${WP_SITEMAP_MAX_URLS} urls (a full WordPress page); ${uneven.map((m) => `-${num(m)}.xml holds ${m.urls}`).join(', ')} — a page was cut short, or the page size changed`
  if (last.urls >= WP_SITEMAP_MAX_URLS) return `the last estate_property sitemap (-${num(last)}.xml) holds ${last.urls} urls, as many as a full page (${WP_SITEMAP_MAX_URLS}) — the index may be stale and leave out the page after it`
  return null
}

/** What the stage learned from one detail page it requested. */
export type DetailOutcome =
  | { kind: 'record'; postId: string }
  /** 404 / 410 — the listing is gone at the source; not fresh, not undetermined. */
  | { kind: 'gone'; status: number }
  /** Requested but not judged: a timeout, a 5xx, a refused or off-url redirect, an unparsable page. */
  | { kind: 'undetermined'; why: string }

/**
 * What one detail-page response says (the stage's per-page outcome; the fresh set's proof that a page
 * was read). `drop` is the report's reason key for anything that is not a record.
 */
export function classifyDetailPage(e: SitemapEntry, res: Got):
  { outcome: DetailOutcome; record: StagedHoneycomb | null; drop: string | null } {
  const undetermined = (why: string) => ({ outcome: { kind: 'undetermined' as const, why }, record: null, drop: why })
  /** ⛔ A redirect off the site (or to a robots-disallowed path) was NOT followed: drop the page. */
  if (res.refusedRedirect) return undetermined('redirectRefused')
  if (isGoneStatus(res.status)) return { outcome: { kind: 'gone', status: res.status }, record: null, drop: 'gone' }
  if (res.status !== 200) return undetermined(`http${res.status}`)
  if (res.finalUrl !== e.url || !allowedTarget(res.finalUrl)) return undetermined('redirected')
  const parsed = parseHoneycombPage(res.body.toString('utf8'), e.url)
  if (typeof parsed === 'string') return undetermined(parsed)
  /** ⛔ Through the allowlist on the way IN, as well as on the way back out of the file. */
  const record = stageHoneycombRecord({ ...parsed, lastmod: e.lastmod })
  if (!record) return undetermined('allowlist')
  return { outcome: { kind: 'record', postId: record.postId }, record, drop: null }
}

/**
 * The stage's detail read: each page in `batch`, in order, through `get` (the polite fetcher). ⛔ EVERY
 * PAGE REQUESTED GETS AN OUTCOME in `detail` — a record, gone, or undetermined (a fetch error included) —
 * except the one whose request threw Infeasible (a 429, a bot challenge): that ends the READ, not the run,
 * and `stopped` says why, which on its own refuses the fresh set. Nothing after it is requested.
 */
export async function readDetailPages(batch: readonly SitemapEntry[], get: (url: string) => Promise<Got>): Promise<{
  detail: Map<string, DetailOutcome>; records: StagedHoneycomb[]; read: number; drop: Record<string, number>; stopped: string | null
}> {
  const detail = new Map<string, DetailOutcome>()
  const records: StagedHoneycomb[] = []
  const drop: Record<string, number> = {}
  const bump = (k: string) => { drop[k] = (drop[k] ?? 0) + 1 }
  let read = 0
  let stopped: string | null = null
  for (const e of batch) {
    let res: Got
    try { res = await get(e.url) } catch (err) {
      if (err instanceof Infeasible) { stopped = err.message; break }
      bump('fetchError'); detail.set(e.url, { kind: 'undetermined', why: 'fetchError' }); continue
    }
    read++
    const c = classifyDetailPage(e, res)
    if (c.drop) bump(c.drop)
    detail.set(e.url, c.outcome)
    if (c.record) records.push(c.record)
  }
  return { detail, records, read, drop, stopped }
}

export type HoneycombFreshCounts = {
  listed: number; kept: number; inWindow: number; items: number; gone: number
  undetermined: number; unknownStored: number; unresolved: number; noDate: number; future: number
}

/**
 * The fresh set for Honeycomb, or why it must not be written. Pure: the stage hands in what it read.
 *   · items   — every url whose lastmod (worst case) is in the window at `fetchedAt` and whose page read
 *               gave a post id: `honeycomb:<post id>`, sourceDate = that lastmod. Apartments and houses
 *               alike (the expiry touches apartment rows only), INCLUDING rows already stored and rows
 *               the mapper or the content screen would refuse — this is evidence of age, not of quality.
 *   · unknown — urls in (or after) the window whose page could not be judged, and urls with no readable
 *               lastmod, resolved to an externalId through the page's post id or the stored row with that
 *               affiliateUrl. A url nobody stored has no row to keep, and is only counted.
 * ⛔ Refused — exit non-zero, nothing written — unless the read provably covered the window (see the file
 * header: a sitemap file served from the page cache refuses it too), when the in-window pages mostly answer
 * 404/410 (inWindowGoneProblem), and when the bulk re-save guard trips. The result is re-validated with freshSetProblem.
 */
export function buildHoneycombFreshSet(o: {
  fetchedAt: Date
  now: number
  /** Every estate_property sitemap the index listed, as read — in index order. */
  maps: readonly SitemapFileRead[]
  /** The sitemap INDEX response's `x-litespeed-cache` header (null when it carried none). */
  indexCache: string | null
  /** The property urls of all those sitemaps, deduplicated (the stage's `sitemap.entries`). */
  entries: readonly SitemapEntry[]
  /** The detail read's window start: every url with lastmod ≥ this had its page requested. */
  detailSinceMs: number
  limit: number
  stopped: string | null
  /** The outcome of every detail page requested, by sitemap url. */
  detail: ReadonlyMap<string, DetailOutcome>
  /** This seller's stored rows (any status) — to name an undetermined url's row. */
  stored: readonly { externalId: string | null; affiliateUrl: string | null }[]
}): { ok: true; set: FreshSet; counts: HoneycombFreshCounts } | { ok: false; reason: string } {
  const fetched = o.fetchedAt.getTime()
  if (!Number.isFinite(fetched)) return { ok: false, reason: 'fetchedAt is not a date' }
  const mapsProblem = sitemapReadProblem(o.maps)
  if (mapsProblem) return { ok: false, reason: mapsProblem }
  const cacheProblem = sitemapCacheProblem(o.indexCache, o.maps)
  if (cacheProblem) return { ok: false, reason: cacheProblem }
  if (!o.entries.length) return { ok: false, reason: 'the sitemaps gave no property url' }
  const listed = o.maps.reduce((n, m) => n + m.urls, 0)
  const kept = o.maps.reduce((n, m) => n + m.kept, 0)
  // A url the importer would not accept is a url whose row it cannot name — past a few, the url shape changed.
  if (listed - kept > OFF_SHAPE_MAX_SHARE * listed) return { ok: false, reason: `${listed - kept} of ${listed} sitemap urls are not /property/<slug>/ urls — the site's url shape changed` }
  // ⛔ Counts per page prove nothing if pages overlap: a url listed twice can stand in for one never listed.
  if (o.entries.length !== kept) return { ok: false, reason: `${kept} kept sitemap urls but ${o.entries.length} distinct — pages overlap, so a full count does not prove every url was listed` }
  if (o.limit) return { ok: false, reason: `--limit ${o.limit} read only part of the window` }
  if (o.stopped) return { ok: false, reason: `the detail read stopped early: ${o.stopped}` }
  const windowFrom = fetched - HONEYCOMB_WINDOW_DAYS * DAY_MS
  if (!(o.detailSinceMs <= windowFrom)) {
    return { ok: false, reason: `the detail read started at ${new Date(o.detailSinceMs).toISOString()}, after the window's start ${new Date(windowFrom).toISOString()} — pages inside the window were not read` }
  }

  const byUrl = new Map<string, string[]>()
  for (const r of o.stored) {
    if (!r.affiliateUrl || !r.externalId) continue
    byUrl.set(r.affiliateUrl, [...(byUrl.get(r.affiliateUrl) ?? []), r.externalId])
  }
  const items = new Map<string, FreshItem>()
  const unknown = new Set<string>()
  const counts: HoneycombFreshCounts = { listed, kept, inWindow: 0, items: 0, gone: 0, undetermined: 0, unknownStored: 0, unresolved: 0, noDate: 0, future: 0 }
  const notFetched: string[] = []
  const undetermined = (url: string, out: DetailOutcome | undefined) => {
    const ids = out?.kind === 'record' ? [`${EXTERNAL_ID_PREFIX}${out.postId}`] : byUrl.get(url) ?? []
    if (!ids.length) { counts.unresolved++; return }
    for (const id of ids) unknown.add(id)
  }
  for (const e of o.entries) {
    const d = honeycombSourceDate(e.lastmod)
    const out = o.detail.get(e.url)
    if (!d) { counts.noDate++; undetermined(e.url, out); continue }
    if (d.getTime() < windowFrom) continue
    // ⛔ The same window as windowFrom: with the 7-day default here, every url 8–30 days old would count as
    // "future" and be kept live as undetermined instead of being judged.
    if (!isInWindow(d, fetched, HONEYCOMB_WINDOW_DAYS)) { counts.future++; undetermined(e.url, out); continue }
    counts.inWindow++
    if (!out) { notFetched.push(e.url); continue }
    if (out.kind === 'gone') { counts.gone++; continue }
    if (out.kind === 'undetermined') { counts.undetermined++; undetermined(e.url, out); continue }
    const externalId = `${EXTERNAL_ID_PREFIX}${out.postId}`
    const prev = items.get(externalId)
    // Two urls naming one post: keep the OLDER date — the worst case of what the source shows.
    if (!prev || Date.parse(prev.sourceDate) > d.getTime()) items.set(externalId, { externalId, sourceDate: d.toISOString(), dateKind: 'modified' })
  }
  if (notFetched.length) return { ok: false, reason: `${notFetched.length} url(s) in the window were never read (e.g. ${notFetched[0]}) — the detail read did not cover the window` }
  const goneProblem = inWindowGoneProblem(counts.gone, counts.inWindow)
  if (goneProblem) return { ok: false, reason: goneProblem }
  const { recent, total } = recentShare(o.entries, fetched)
  const bulk = bulkResaveProblem(recent, total)
  if (bulk) return { ok: false, reason: bulk }
  // A post that is fresh under one url is not undetermined under another.
  for (const id of items.keys()) unknown.delete(id)
  counts.items = items.size
  counts.unknownStored = unknown.size

  const n = o.maps.length
  const counts1toN = [...o.maps].sort((a, b) => Number(/-(\d+)\.xml$/.exec(a.url)![1]) - Number(/-(\d+)\.xml$/.exec(b.url)![1])).map((m) => m.urls)
  const coverage = [
    `honeycomb.com.vn /wp-sitemap.xml → estate_property sitemaps 1…${n}, ${n}/${n} read (HTTP 200, non-empty, each ending </urlset>; urls per page ${counts1toN.join('/')}: pages before the last exactly ${WP_SITEMAP_MAX_URLS}, the last under it): ${listed} urls, ${kept} property urls, ${o.entries.length} distinct`,
    `each requested with ?${CACHE_BUST_PARAM}=<run start>, none from the page cache — x-litespeed-cache: ${sitemapCacheSummary(o.indexCache, o.maps)}`,
    `window lastmod ≥ ${new Date(windowFrom).toISOString()} (fetchedAt − ${HONEYCOMB_WINDOW_DAYS} d): ${counts.inWindow} urls, ${recent} of ${total} at or after it (${total ? ((recent / total) * 100).toFixed(2) : '0'}%, bulk re-save guard ${BULK_RESAVE_MAX_SHARE * 100}%)`,
    `detail read from ${new Date(o.detailSinceMs).toISOString()}, no --limit, not stopped — every in-window page read: ${counts.items} posts identified, ${counts.gone} gone (404/410), ${counts.undetermined} undetermined`,
    `${counts.noDate} urls without a readable lastmod, ${counts.future} dated after the fetch; ${counts.unknownStored} stored rows kept as undetermined, ${counts.unresolved} undetermined urls with no stored row`,
  ].join('; ')
  const set = makeFreshSet(HONEYCOMB_SELLER_ID, o.fetchedAt, coverage, [...items.values()], [...unknown], HONEYCOMB_WINDOW_DAYS)
  const problem = freshSetProblem(set, o.now, HONEYCOMB_SELLER_ID)
  if (problem) return { ok: false, reason: `the set fails its own check: ${problem}` }
  return { ok: true, set, counts }
}

/**
 * Whether the apply keeps (creates or refreshes) an ad with this lastmod. Always: the lastmod (worst case)
 * is at or after the run's day window `sinceMs`. ⛔ In a --since-days run (`exactDays`), ALSO within that
 * many days of the FETCH, exactly — the same isInWindow judgement the fresh set made at `fetchedAt`. The
 * day window opens at the start of a Vietnam day, up to 24 h earlier than fetchedAt − N days: it chooses
 * which detail pages to read, but an ad N to N+1 days old is not in the set, so creating it would upload its
 * photos for the expiry to take it down minutes later.
 */
export function keepVerdict(lastmod: string | null | undefined, o: { sinceMs: number; exactDays: number | null; fetchedAt: number }):
  { keep: true; t: number } | { keep: false; why: 'beforeSince' | 'outsideWindow' } {
  const d = honeycombSourceDate(lastmod)
  const t = d?.getTime() ?? NaN
  if (!(t >= o.sinceMs)) return { keep: false, why: 'beforeSince' }
  if (o.exactDays !== null && !isInWindow(d!, o.fetchedAt, o.exactDays)) return { keep: false, why: 'outsideWindow' }
  return { keep: true, t }
}

/** What an --apply does to an EXISTING row's dates and status. */
export type DateChange = { revive: boolean; postedAt: Date | null }
export const NO_DATE_CHANGE: DateChange = Object.freeze({ revive: false, postedAt: null }) as DateChange

/**
 * The revival and postedAt decision for one stored row (owner rule 2026-10-01), from its staged lastmod.
 *   · REVIVE — the lastmod is in Honeycomb's window (HONEYCOMB_WINDOW_DAYS, 30) AT THE FETCH (`fetchedAt`:
 *     the moment the fresh set is judged at too, so the set and the apply never disagree about a row),
 *     the fetch is no older than a
 *     fresh set may be (FRESH_SET_MAX_AGE_MS — the same evidence, trusted for the same time; a plain
 *     --since stage may otherwise be applied up to 72 h later), and the row is in REVIVABLE_STATUSES
 *     ('expired' | 'stale'); ⛔ never 'hidden', 'removed' or 'sold'.
 *   · postedAt — the source date (clamped to now) on a revival, and on any row whose source date is
 *     NEWER than what is stored (the agency re-touched it). A lastmod after the fetch is a broken clock,
 *     not a re-post, and moves nothing. ⛔ Nothing at all when lastmod is not trusted this run
 *     (lastmodTrust) or the row is a 'removed' tombstone.
 */
export function datePlan(o: {
  status: string; postedAt: Date; lastmod: string | null | undefined
  fetchedAt: number; now: number; trusted: boolean
}): DateChange {
  if (!o.trusted || o.status === 'removed') return NO_DATE_CHANGE
  const d = honeycombSourceDate(o.lastmod)
  // Any age (100 years), but not after the fetch beyond the shared clock skew.
  if (!d || !isInWindow(d, o.fetchedAt, 36_500)) return NO_DATE_CHANGE
  const src = new Date(Math.min(d.getTime(), o.now))
  // ⛔ Honeycomb's window, as the fresh set judges it: with the 7-day default the 8–30-day-old flats the
  // set keeps would never come back from 'expired'.
  const inWindow = isInWindow(d, o.fetchedAt, HONEYCOMB_WINDOW_DAYS)
  const revive = inWindow && o.now - o.fetchedAt <= FRESH_SET_MAX_AGE_MS && (REVIVABLE_STATUSES as readonly string[]).includes(o.status)
  const moved = src.getTime() !== o.postedAt.getTime()
  // ⛔ A re-date only to a lastmod INSIDE the window: the bulk guard measures the window only, so an older
  // site-wide re-save would otherwise re-date (and re-rank) the whole catalogue through a 90-day apply.
  const postedAt = moved && inWindow && (revive || src.getTime() > o.postedAt.getTime()) ? src : null
  return { revive, postedAt }
}

/** One line of the dated-rows journal: the PLANNED change, written (fsync) BEFORE the write it describes. */
export type DatedJournalEntry = {
  id: string; externalId: string
  oldStatus: string; oldPostedAt: string; oldRankScore: number
  revive: boolean; newPostedAt: string | null; newRankScore: number | null
}

/** A listing id or seller id this script could have read from the database — anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** A SQL string literal, quotes escaped (values are validated as well — belt and braces). */
const sqlLit = (x: string) => `'${x.replace(/'/g, "''")}'`

/**
 * The per-page ISR tombstone, as SQL a rollback .sql file carries for the ids it touches: a row a rollback
 * brings back keeps its cached 404 for 30 days without one, and a row it takes down keeps rendering.
 * Same tags and upsert as src/lib/pdp-tombstone.ts and scripts/expire-apartment-rentals.ts.
 */
export function pdpTombstoneSql(ids: readonly string[]): string {
  if (!ids.length) return ''
  for (const id of ids) if (!SAFE_ID.test(id)) throw new Error(`refusing a tombstone line for id ${JSON.stringify(id)}`)
  const tags = ids.flatMap(pdpTombstoneTags).map(sqlLit).join(',')
  return `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY[${tags}]) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
}

/**
 * The SQL that undoes one dated write — written only AFTER that write moved the row — while nothing has
 * touched the row since. ⛔ GUARDED ON THE STATE THE WRITE CREATED: postedAt is still the value this run
 * wrote (or, on a revival that left it, the old one) and, on a revival, the row is still 'active'. Then the
 * row's own ISR tombstone, so the page follows the rollback. '' when the entry changed nothing. Throws on
 * a value that could not have come from the database, rather than writing it into SQL.
 */
export function datedRollbackSql(e: DatedJournalEntry, sellerId: string): string {
  if (!SAFE_ID.test(e.id)) throw new Error(`refusing a rollback line for id ${JSON.stringify(e.id)}`)
  if (!/^[a-z0-9-]{1,64}$/.test(sellerId)) throw new Error(`refusing a rollback line for seller ${JSON.stringify(sellerId)}`)
  const ts = (iso: string) => {
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) throw new Error(`refusing a rollback line with date ${JSON.stringify(iso)}`)
    return sqlLit(new Date(t).toISOString())
  }
  const sets: string[] = []
  const where = [`id = ${sqlLit(e.id)}`, `"sellerId" = ${sqlLit(sellerId)}`]
  if (e.newPostedAt) {
    if (!Number.isFinite(e.oldRankScore)) throw new Error(`refusing a rollback line with rankScore ${e.oldRankScore}`)
    sets.push(`"postedAt" = ${ts(e.oldPostedAt)}`, `"rankScore" = ${e.oldRankScore}`)
    where.push(`"postedAt" = ${ts(e.newPostedAt)}`)
  }
  if (e.revive) {
    if (!(REVIVABLE_STATUSES as readonly string[]).includes(e.oldStatus)) throw new Error(`refusing a rollback line to status ${JSON.stringify(e.oldStatus)}`)
    sets.push(`status = ${sqlLit(e.oldStatus)}`)
    // A revival that left postedAt as it was: the row must still hold that postedAt too.
    if (!e.newPostedAt) where.push(`"postedAt" = ${ts(e.oldPostedAt)}`)
    where.push(`status = 'active'`)
  }
  return sets.length ? `UPDATE "Listing" SET ${sets.join(', ')} WHERE ${where.join(' AND ')};\n${pdpTombstoneSql([e.id])}` : ''
}

/**
 * ⛔ THE PAGES THIS RUN OWES AN ISR TOMBSTONE. A row whose visibility a write may change (a revival, a
 * retire) is OWED one BEFORE that write is attempted — `owe(id)` straight before it — and `pay()` straight
 * after it tombstones everything owed. ⛔ Before, not after: a write that COMMITS and then throws (a dropped
 * connection on the reply) never reaches a line after it, and its revived row kept its cached 404. A
 * tombstone on a row the write did not move only re-renders an unchanged page — harmless. A failed pay leaves the ids owed, so
 * the next pay retries them, and the caller's `finally { pay() }` reaches them when a later row throws (an
 * Infeasible 429 while fetching a create's photos ends the run). Without it a revived page served its
 * cached 404 for 30 days, and a re-run could not repair it: the row was already active, so nothing was
 * planned for it.
 */
export type TombstoneLedger = { owe(id: string): void; pay(): Promise<void>; owed(): string[]; paid(): number }
export function makeTombstoneLedger(tombstone: (ids: readonly string[]) => Promise<unknown>): TombstoneLedger {
  const owed = new Set<string>()
  let paid = 0
  return {
    owe(id) { owed.add(id) },
    async pay() {
      if (!owed.size) return
      const ids = [...owed]
      await tombstone(ids)
      for (const id of ids) owed.delete(id)
      paid += ids.length
    },
    owed: () => [...owed],
    paid: () => paid,
  }
}

/** `--since-days N`: a whole number of days, 1–3650, or null. */
export function parseSinceDays(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return n >= 1 && n <= 3650 ? n : null
}

/**
 * ⛔ CHECKED BEFORE ANY REQUEST: why --fresh-out cannot be honoured by this run, or null. Only a run that
 * reads the site can say what it shows now, and only one that reads every page in the window can say
 * that an ad missing from the set is old. ⛔ And only a `--since-days 30` stage (HONEYCOMB_WINDOW_DAYS): its
 * file records `sinceDays: 30`, so the apply creates and keeps by exactly the set's 30 days (keepVerdict).
 * A plain --since (or the default 90 days) stage records none, and its apply would create ads up to 90 days
 * old that are not in the set — uploaded, then expired minutes later; a 7-day stage would write a set the
 * expiry refuses (its window is not Honeycomb's).
 */
export function freshOutPreflight(o: { freshOut: string | null; src: string | null; apply: boolean; limit: number; sinceDays: number | null; sinceMs: number; now: number }): string | null {
  if (!o.freshOut) return null
  if (o.src || o.apply) return '--fresh-out is written by the run that READS the site (a stage); --src/--apply replay a staged file and cannot say what the site shows now'
  if (o.limit) return '--fresh-out needs every page in the window read; drop --limit'
  const days = HONEYCOMB_WINDOW_DAYS
  if (o.sinceDays !== days) return `--fresh-out needs --since-days ${days}${o.sinceDays !== null ? ` (not ${o.sinceDays})` : ' (not --since, not the default window)'}: Honeycomb's window is ${days} days, and only then does the apply judge creates and keeps by the set's exact ${days} days`
  if (!(o.sinceMs <= o.now - days * DAY_MS)) return `--since starts inside the ${days}-day window, so older pages in it would not be read — use --since-days ${days}`
  return null
}
