/**
 * Nhà Tốt and THE 7-DAY RULE (src/lib/apartment-freshness.ts) — the pure half: the time-bounded read of
 * the gateway's newest-first lists, the proof that it covered the window, the fresh set built from it, and
 * what --apply does to an existing row that the source shows fresh again. No fetch, no DB, no fs.
 *
 * ─── THE SOURCE DATE ────────────────────────────────────────────────────────────────────────────
 * `list_time` (ms epoch) — the LAST re-list ("đẩy tin"); the ad's "2 giờ trước" label is drawn from it and
 * `orig_list_time` keeps the first posting. It is exact, so it is its own worst case. dateKind 'list-time'.
 *
 * ─── WHY A READ CAN PROVE IT COVERED THE WINDOW (measured 2026-10-01, 9 live pages) ──────────────
 * Every list (whole region, and per district) is ordered by list_time, newest first: 0 inversions over 9
 * pages of 50, `is_sticky` ads included — they sit in order here. ⛔ THAT ORDER IS CHECKED ON EVERY PAGE,
 * never assumed (nhatotOrderProblem): within a page the non-pinned list_time must not increase, and an ad
 * not already read in this pass must be no newer than the previous page's last non-pinned ad (the overlap's
 * repeats, and rows a burst of new ads pushed down, are exempt — they were read). One inversion and the
 * slice is 'unordered', never covered: the boundary, the anchors and the head re-read all stand on it.
 * HCMC apartments: o=4950 is ~109 h old,
 * o=9950 ~315 h, so the 7-day boundary sits near o≈7000, under the gateway's 10,000 `total` cap.
 * A slice ends at the first page on which EVERY non-pinned ad was listed before the cutoff (a pinned ad
 * is out of order by definition, so it can neither end a slice early nor keep one going for ever), or at
 * the end of the results. Three things move rows while the read is under way, and each is closed here:
 *  · a DELETION above the read point shifts every later row up — one row slips into a page already read.
 *    Pages therefore OVERLAP (NHATOT_WINDOW_OVERLAP rows), and each page must share at least one ad —
 *    same list_id AND same list_time — with the pages already read in this pass. Rows that were not
 *    re-listed keep their order, so every row above that shared ad was above it when it was read, and
 *    was read then: no gap is possible. No shared ad → the slice is refused ('gap'), never guessed.
 *    (Any earlier page, not only the last one: a burst of NEW ads pushes rows DOWN, and a page made
 *    wholly of rows read two pages back is repeats, not a gap.)
 *  · a NEW ad or a BUMP moves a row to the TOP, above the read point — the bumped row is missed where it
 *    was. After the slice, the head is re-read until a page holds an ad listed no later than the newest ad
 *    of the slice's FIRST page (the server's own clock, not ours): everything listed since is above it.
 *  · the 10,000 cap: a region whose window does not end inside it is re-read per district (the existing
 *    split), and that only counts when every district slice reached its boundary or end AND every area_v2
 *    seen in the region's read is one of the districts read.
 * ⛔ AN END OF RESULTS IS A CLAIM, NOT A FACT. A backend hiccup answers an empty or short 200 just as the
 * real end does (measured 2026-10-02: past its end the list answers `{"ads":[]}`, with no `total`), and
 * an accepted false end would let the expiry take every live row the read never reached. So an empty or
 * short page ends a slice only when (1) a re-request of the same offset answers the SAME rows, (2) the
 * slice saw a numeric `total` whenever it read any non-empty page (a non-empty answer carries one; a slice
 * that read rows and never got a count has nothing to check its end against — 'endUnconfirmed'), and (3)
 * when that `total` is under the 10,000 cap, the slice read at least that many distinct ads; a total AT
 * the cap with a short page below it is a contradiction. A city's apartment region that read nothing, or
 * nothing inside the window, proves nothing (nhatotFreshCoverage). A 200 whose `ads` is not an array is
 * an error at the fetch, never an empty page.
 * Anything else — a stop, a timeout that survived its retry, a gap, an inversion, an unresolved head, an
 * end that did not repeat, came with no count, or fell short of `total` — and the fresh set is NOT written.
 *
 * ─── THE INSTANT THE SET IS JUDGED AT ───────────────────────────────────────────────────────────
 * The set's `fetchedAt` — and so the --apply's create age limit and revival — is the read's START, not its
 * end. Every ad inside the window at the start was on the list when the read began, so it was read where
 * it stood or, re-listed meanwhile, by the head re-read. An ad listed AFTER the start (beyond the 5-minute
 * skew) cannot be judged at that instant: it goes to `unknown` (kept live), never to an item.
 */
import {
  APARTMENT_SUBCAT, EXTERNAL_ID_SHAPE, FRESH_DAYS, REVIVABLE_STATUSES, freshSetProblem, isInWindow, makeFreshSet,
  type FreshItem, type FreshSet,
} from './apartment-freshness'
import { pdpTombstoneTags } from './job-listing'
import {
  NHATOT_CITIES, NHATOT_LIST_ID_MAX, NHATOT_PAGE_MAX, NHATOT_SELLER_ID, NHATOT_TOTAL_CAP,
  stageNhatotAd, type NhatotCityKey, type NhatotStagedAd,
} from './nhatot-listing'

const DAY_MS = 86_400_000
/** Chợ Tốt's apartment category — the ONLY one the fresh set speaks for (its subcat is APARTMENT_SUBCAT). */
export const NHATOT_APARTMENT_CG = 1010
/** Rows each page shares with the one before: up to OVERLAP-1 deletions between two requests are absorbed. */
export const NHATOT_WINDOW_OVERLAP = 10
/** The read goes this much past the window, so our clock against the server's cannot cut it short. */
export const NHATOT_WINDOW_MARGIN_MS = 3_600_000
/** Head re-read pages before giving up (one page is ~50 min of HCMC listings; a slice reads in minutes). */
export const NHATOT_HEAD_MAX_PAGES = 10
export const NHATOT_DATE_KIND = 'list-time' as const

const iso = (ms: number | null) => (ms === null ? '?' : new Date(ms).toISOString())

/** The list_time a time-bounded read stops below: the read's start, minus the window, minus the margin. */
export function nhatotWindowCutoff(readStartedAt: number, windowDays: number): number {
  return readStartedAt - windowDays * DAY_MS - NHATOT_WINDOW_MARGIN_MS
}

/** One list row as the window logic sees it: its position facts, and the whitelisted ad (null = unstageable). */
export type NhatotWindowRow = { list_id: number | null; list_time: number | null; pinned: boolean; ad: NhatotStagedAd | null }
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A raw gateway row → its window facts. ⛔ Only `list_id`, `list_time` and the two sticky flags are read
 * here; everything published goes through stageNhatotAd's whitelist, as before.
 */
export function nhatotWindowRow(raw: unknown): NhatotWindowRow {
  const r = isObj(raw) ? raw : {}
  const id = r.list_id
  const list_id = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id <= NHATOT_LIST_ID_MAX ? id : null
  const t = r.list_time
  const list_time = typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null
  const pinned = r.is_sticky === true || (typeof r.sticky_ad_platinum === 'number' && r.sticky_ad_platinum > 0)
  return { list_id, list_time, pinned, ad: stageNhatotAd(raw) }
}

type Pos = Pick<NhatotWindowRow, 'list_id' | 'list_time' | 'pinned'>
/**
 * A page's anchor keys — `list_id@list_time` of its non-pinned, dated rows. A later page must share one.
 * The time is part of the key: an ad re-listed in between has moved to the top and anchors nothing.
 */
export function nhatotAnchors(rows: readonly Pos[]): string[] {
  return rows.filter((r) => !r.pinned && r.list_id !== null && r.list_time !== null).map((r) => `${r.list_id}@${r.list_time}`)
}
const anchored = (rows: readonly Pos[], seen: ReadonlySet<string>) => nhatotAnchors(rows).some((k) => seen.has(k))

/** Every non-pinned row listed before the cutoff — and at least one such row (a page of pins proves nothing). */
export function nhatotIsBoundaryPage(rows: readonly Pos[], cutoff: number): boolean {
  const own = rows.filter((r) => !r.pinned)
  return own.length > 0 && own.every((r) => r.list_time !== null && r.list_time < cutoff)
}

/** The newest non-pinned list_time on a page, or null. */
export function nhatotNewest(rows: readonly Pos[]): number | null {
  let best: number | null = null
  for (const r of rows) if (!r.pinned && r.list_time !== null && (best === null || r.list_time > best)) best = r.list_time
  return best
}

/** The list_time of a page's LAST non-pinned, dated row (in page order), or null — what the next page is held to. */
export function nhatotLastTime(rows: readonly Pos[]): number | null {
  for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].pinned && rows[i].list_time !== null) return rows[i].list_time
  return null
}

/**
 * Why a page is not in newest-first order, or null. Pinned and undated rows are skipped (a pin is out of
 * order by definition; an undated row cannot be compared — it already blocks the boundary). Two rules:
 *  · within the page, each non-pinned list_time is no newer than the one above it;
 *  · against the previous page (`prevLast` = its last non-pinned list_time; null on a first page), an ad
 *    NOT already read in this pass (`seen`, keyed list_id@list_time as the anchors are) is no newer than
 *    prevLast. The overlap's repeats — and rows pushed down by new ads, read on any earlier page — are
 *    newer than prevLast and are exempt; anything else newer than it was out of place.
 */
export function nhatotOrderProblem(p: { offset: number; rows: readonly Pos[]; prevLast: number | null; seen: ReadonlySet<string> | null }): string | null {
  let above: Pos | null = null
  for (const r of p.rows) {
    if (r.pinned || r.list_time === null) continue
    if (above !== null && r.list_time > above.list_time!) {
      return `the page at o=${p.offset} is not newest-first: ad ${r.list_id} (${iso(r.list_time)}) sits below ad ${above.list_id} (${iso(above.list_time)})`
    }
    above = r
    const repeat = r.list_id !== null && p.seen !== null && p.seen.has(`${r.list_id}@${r.list_time}`)
    if (p.prevLast !== null && r.list_time > p.prevLast && !repeat) {
      return `the page at o=${p.offset}: ad ${r.list_id} (${iso(r.list_time)}) was not read before and is newer than the previous page's last ad (${iso(p.prevLast)}) — the list is out of list_time order across pages`
    }
  }
  return null
}

export type NhatotWindowStep =
  | { kind: 'next'; offset: number }
  | { kind: 'boundary' }
  | { kind: 'end' }
  | { kind: 'capped' }
  | { kind: 'gap'; why: string }
  | { kind: 'unordered'; why: string }

/**
 * What one page of a time-bounded slice means. In order: a page anchored to nothing read before in this
 * pass (`seen`; null on the first page) is a GAP — and a boundary seen on it vouches for nothing; then the
 * ORDER (nhatotOrderProblem against `prevLast`, the previous page's last non-pinned list_time) — a page out
 * of order is 'unordered', and its boundary vouches for nothing either; then the boundary; then the cap
 * (a page reaching it, short or not: the gateway serves nothing past 10,000, so a short page there is the
 * cap, not the end); then a CLAIMED end of results (an empty or short page — readNhatotWindowSlice
 * corroborates it before it counts); else the next offset, overlapping.
 * ⚠️ `total` NEVER ENDS A READ. The gateway answers past its end with a short page (measured: Hà Nội
 * apartments, total 1,295, o=1280 → 15 rows), so the end is observed; a count that lagged the list would
 * end a read early. `total` may only REFUSE an end (nhatotEndProblem), never grant one.
 */
export function nhatotWindowStep(p: {
  offset: number; limit: number; rows: readonly Pos[]
  seen: ReadonlySet<string> | null; prevLast?: number | null; cutoff: number; overlap: number; cap?: number
}): NhatotWindowStep {
  const cap = p.cap ?? NHATOT_TOTAL_CAP
  if (p.seen !== null && (!p.rows.length || !anchored(p.rows, p.seen))) {
    return { kind: 'gap', why: `the page at o=${p.offset} shares no ad (same list_id and list_time) with the pages read before it — rows shifted up by ${p.overlap} or more between two requests` }
  }
  const disorder = nhatotOrderProblem({ offset: p.offset, rows: p.rows, prevLast: p.prevLast ?? null, seen: p.seen })
  if (disorder) return { kind: 'unordered', why: disorder }
  if (!p.rows.length) return { kind: 'end' }
  if (nhatotIsBoundaryPage(p.rows, p.cutoff)) return { kind: 'boundary' }
  if (p.offset + p.rows.length >= cap) return { kind: 'capped' }
  if (p.rows.length < p.limit) return { kind: 'end' }
  return { kind: 'next', offset: p.offset + p.rows.length - p.overlap }
}

/** Two answers for one offset are the same page: the same rows, in the same order, with the same list_time. */
export function nhatotSamePage(a: readonly Pos[], b: readonly Pos[]): boolean {
  return a.length === b.length && a.every((r, i) => r.list_id === b[i].list_id && r.list_time === b[i].list_time && r.pinned === b[i].pinned)
}

/**
 * Why a REPEATED empty/short page still cannot be accepted as the end of the list, or null. `total` is the
 * gateway's latest count for this slice (null = it never sent one — an empty page past the end carries
 * none, a non-empty answer does); `rowsRead` is every row the slice's requests answered; `distinct` is how
 * many distinct list_ids it read.
 *  · NO COUNT, BUT ROWS READ → 'endUnconfirmed': a slice that read a non-empty page and never saw a numeric
 *    total has nothing to hold its end to. (No rows and no count is an empty list — real for a district;
 *    nhatotFreshCoverage refuses it for a whole city.)
 *  · under the cap, a list that ended short of its own count lost rows; at the cap (the count is "10,000 or
 *    more"), any end below it is a contradiction → 'endContradicted'.
 */
export function nhatotEndProblem(p: { total: number | null; rowsRead: number; distinct: number; endAt: number; cap?: number }): { outcome: 'endUnconfirmed' | 'endContradicted'; why: string } | null {
  const cap = p.cap ?? NHATOT_TOTAL_CAP
  if (p.total === null) {
    if (p.rowsRead > 0) return { outcome: 'endUnconfirmed', why: `the list ended at o=${p.endAt} after ${p.rowsRead} rows read, and no answer carried a numeric \`total\` — an end with no count to hold it to is not confirmed` }
    return null
  }
  if (p.total >= cap) return { outcome: 'endContradicted', why: `the list ended at o=${p.endAt}, but the gateway counts ${p.total} (its cap: 10,000 or more) — a truncated answer, not the end` }
  if (p.distinct < p.total) return { outcome: 'endContradicted', why: `the list ended at o=${p.endAt} with ${p.distinct} distinct ads read, short of the gateway's own total ${p.total} — a truncated answer, not the end` }
  return null
}

export type NhatotWindowOutcome = 'boundary' | 'end' | 'capped' | 'gap' | 'unordered' | 'stopped' | 'headUnresolved' | 'endUnconfirmed' | 'endContradicted'
export type NhatotWindowResult = {
  outcome: NhatotWindowOutcome
  /** The window is covered: a boundary or a corroborated end was reached, every page anchored, and the head caught up. */
  covered: boolean
  pages: number
  headPages: number
  /** Re-requests of a page that claimed the end (0 or 1). */
  confirmPages: number
  /** Offset of the page the slice ended on. */
  lastOffset: number
  total: number | null
  rowsRead: number
  /** Distinct list_ids read (main pages, the end's re-request and the head re-read). */
  distinct: number
  /** Distinct NON-PINNED ads read whose list_time is at or after the cutoff. */
  inWindow: number
  headMark: number | null
  /** Every row read, in read order (main pages, then the head re-read) — later observations come later. */
  rows: NhatotWindowRow[]
  /** The evidence (covered) or the reason it is not. */
  why: string
  error: unknown
}

/**
 * Read one newest-first slice down to the window's cutoff (see the header for why it is whole).
 * `fetchPage` may throw: the read ends as 'stopped' with the error, and the rows read so far are kept.
 */
export async function readNhatotWindowSlice(
  fetchPage: (offset: number, limit: number) => Promise<{ rows: NhatotWindowRow[]; total: number | null }>,
  opts: { cutoff: number; overlap?: number; pageMax?: number; cap?: number; headMaxPages?: number },
): Promise<NhatotWindowResult> {
  const { cutoff, overlap = NHATOT_WINDOW_OVERLAP, pageMax = NHATOT_PAGE_MAX, cap = NHATOT_TOTAL_CAP, headMaxPages = NHATOT_HEAD_MAX_PAGES } = opts
  if (!(Number.isInteger(overlap) && overlap >= 1 && overlap < pageMax)) throw new Error(`overlap ${overlap} must be an integer in [1, ${pageMax})`)
  const rows: NhatotWindowRow[] = []
  let o = 0, pages = 0, headPages = 0, confirmPages = 0, rowsRead = 0, lastLen = 0
  let total: number | null = null, headMark: number | null = null
  /** Anchor keys of every page read so far in this pass (null before the first page). */
  let seen: Set<string> | null = null
  /** The previous page's last non-pinned list_time — the next page's new ads may be no newer (nhatotOrderProblem). */
  let prevLast: number | null = null
  let outcome: NhatotWindowOutcome = 'stopped'
  let why = ''
  let error: unknown = null
  const take = (page: { rows: NhatotWindowRow[]; total: number | null }) => {
    rowsRead += page.rows.length; rows.push(...page.rows)
    if (page.total !== null) total = page.total
  }
  try {
    for (;;) {
      const page = await fetchPage(o, pageMax)
      pages++; take(page); lastLen = page.rows.length
      if (pages === 1) headMark = nhatotNewest(page.rows)
      const step = nhatotWindowStep({ offset: o, limit: pageMax, rows: page.rows, seen, prevLast, cutoff, overlap, cap })
      if (step.kind === 'next') {
        seen ??= new Set(); for (const k of nhatotAnchors(page.rows)) seen.add(k)
        prevLast = nhatotLastTime(page.rows) ?? prevLast
        o = step.offset; continue
      }
      outcome = step.kind
      if (step.kind === 'gap' || step.kind === 'unordered') why = step.why
      if (step.kind === 'end') {
        /** ⛔ A claimed end counts only if the same offset answers the same rows again. */
        const again = await fetchPage(o, pageMax)
        confirmPages++; take(again)
        if (!nhatotSamePage(page.rows, again.rows)) {
          outcome = 'endUnconfirmed'
          why = `the page at o=${o} claimed the end (${page.rows.length} rows) and a re-request answered ${again.rows.length} different rows — an end of results must repeat`
        }
      }
      break
    }
    if (outcome === 'boundary' || outcome === 'end') {
      if (pages === 1) {
        // One page (re-requested and repeated, if it was an end) is one snapshot: no head to re-read.
      } else if (headMark === null) {
        outcome = 'headUnresolved'
        why = 'the first page held no non-pinned ad with a list_time — nothing to re-read the head against'
      } else {
        let ho = 0, caught = false
        /** The head re-read anchors to ITS OWN pages: the ads it is after were listed after the main pages were read. */
        let hseen: Set<string> | null = null
        let hprevLast: number | null = null
        while (!caught && headPages < headMaxPages) {
          const page = await fetchPage(ho, pageMax)
          headPages++; take(page)
          if (hseen !== null && (!page.rows.length || !anchored(page.rows, hseen))) {
            outcome = 'gap'
            why = `head re-read: the page at o=${ho} shares no ad with the pages before it`
            break
          }
          /** Its order is checked like the main pages' — "caught up" means nothing on a page out of order. */
          const disorder = nhatotOrderProblem({ offset: ho, rows: page.rows, prevLast: hprevLast, seen: hseen })
          if (disorder) { outcome = 'unordered'; why = `head re-read: ${disorder}`; break }
          if (page.rows.some((r) => !r.pinned && r.list_time !== null && r.list_time <= headMark!)) { caught = true; break }
          /** A short or empty head page that has not reached the mark is a truncated answer, never "caught up". */
          if (page.rows.length < pageMax) {
            outcome = 'headUnresolved'
            why = `head re-read: the page at o=${ho} answered ${page.rows.length} rows without reaching the first page's newest ad (${iso(headMark)})`
            break
          }
          hseen ??= new Set(); for (const k of nhatotAnchors(page.rows)) hseen.add(k)
          hprevLast = nhatotLastTime(page.rows) ?? hprevLast
          ho += page.rows.length - overlap
        }
        if (outcome !== 'gap' && outcome !== 'unordered' && outcome !== 'headUnresolved' && !caught) {
          outcome = 'headUnresolved'
          why = `head re-read: ${headPages} pages did not reach the first page's newest ad (${iso(headMark)}) — more listed during the read than the re-read allows`
        }
      }
    }
  } catch (e) {
    outcome = 'stopped'; error = e
    why = `stopped at o=${o}: ${e instanceof Error ? e.message : String(e)}`
  }
  const ids = new Set<number>(), fresh = new Set<number>()
  for (const r of rows) {
    if (r.list_id === null) continue
    ids.add(r.list_id)
    if (!r.pinned && r.list_time !== null && r.list_time >= cutoff) fresh.add(r.list_id)
  }
  if (outcome === 'end') {
    const problem = nhatotEndProblem({ total, rowsRead, distinct: ids.size, endAt: o + lastLen, cap })
    if (problem) { outcome = problem.outcome; why = problem.why }
  }
  const covered = outcome === 'boundary' || outcome === 'end'
  if (covered && !why) {
    const where = outcome === 'boundary'
      ? `boundary at o=${o}: every non-pinned ad on it listed before ${iso(cutoff)}`
      : `${rowsRead === 0 ? 'empty list' : `end of results at o=${o}+${lastLen}`}, repeated by a re-request${total !== null ? `, ${ids.size} distinct ads read ≥ total ${total}` : ''}`
    why = pages === 1
      ? `${where}, in a single page (one snapshot — no head to re-read)`
      : `${where}, after ${pages} pages each anchored to the ones before; head re-read ${headPages} page${headPages === 1 ? '' : 's'} back to ${iso(headMark)}`
  } else if (outcome === 'capped') {
    why = `reached the ${cap} cap at o=${o}${total !== null ? ` (total ${total})` : ''} with ads still inside the window, after ${pages} pages`
  }
  return { outcome, covered, pages, headPages, confirmPages, lastOffset: o, total, rowsRead, distinct: ids.size, inWindow: fresh.size, headMark, rows, why, error }
}

// ─── what the staged file records, and the proof built from it ─────────────────────────────────────

/** A time-bounded slice's evidence, as kept in the staged file's slice report. */
export type NhatotSliceWindow = {
  outcome: NhatotWindowOutcome
  covered: boolean
  pages: number
  headPages: number
  lastOffset: number
  why: string
  /** Rows the slice read (every request), and distinct non-pinned ads at or after the cutoff among them. */
  rowsRead: number
  inWindow: number
}
export type NhatotWindowSlice = {
  city: NhatotCityKey
  cg: number
  area: number | null
  window?: NhatotSliceWindow | null
  /** On a CAPPED region slice: the district ids it was re-read by (null = the district list failed). */
  districts?: number[] | null
  /** On a region slice: the area_v2 values its rows carried, and how many rows carried none. */
  areasSeen?: number[]
  arealess?: number
}
export type NhatotWindowParams = { maxAgeDays: number; readStartedAt: string; cutoff: string; overlap: number }

export const NHATOT_ALL_CITIES = Object.keys(NHATOT_CITIES) as NhatotCityKey[]

/**
 * Why `--fresh-out` cannot be honoured on this run, or null. Checked BEFORE any request: the set speaks for
 * the WHOLE seller (the expiry is seller-wide), so it must come from an unsampled, time-bounded read of
 * every city the importer serves, apartments included, at least FRESH_DAYS deep. `freshOut` / `save` are
 * the two output paths, canonicalised by the caller: one file cannot be both the set and the staged read.
 */
export function nhatotFreshOutProblem(o: {
  src: boolean; apply: boolean; retire: boolean; limit: number; caps: boolean
  maxAgeDaysGiven: boolean; maxAgeDays: number; cities: readonly NhatotCityKey[]; cgs: readonly number[]
  freshOut?: string | null; save?: string | null
}): string | null {
  if (o.retire) return '--fresh-out is written by the import stage run, not --retire'
  if (o.src || o.apply) return '--fresh-out is written by the run that READS the source (the stage run, --save) — not by a --src replay or --apply'
  if (o.limit) return '--fresh-out needs the whole window, and --limit is a sample'
  if (o.caps) return '--fresh-out needs the whole window, and --cap reads only the newest N'
  if (!o.maxAgeDaysGiven) return `--fresh-out needs a time-bounded read: pass --max-age-days ${FRESH_DAYS}`
  if (!(o.maxAgeDays >= FRESH_DAYS)) return `--max-age-days ${o.maxAgeDays} reads less than the ${FRESH_DAYS}-day window the fresh set must cover`
  const missing = NHATOT_ALL_CITIES.filter((c) => !o.cities.includes(c))
  if (missing.length) return `--fresh-out speaks for every Nhà Tốt row, and this run leaves out ${missing.join(', ')} — the expiry would take their live apartments; read every city (drop --city)`
  if (!o.cgs.includes(NHATOT_APARTMENT_CG)) return `--fresh-out lists apartments, and --cg leaves out ${NHATOT_APARTMENT_CG}`
  if (o.freshOut && o.save && o.freshOut === o.save) return `--fresh-out and --save are the same file (${o.save}) — the set would overwrite the staged read the --apply step needs`
  return null
}

/**
 * Did the read provably cover the window for apartments in every city? The coverage string is the
 * evidence (it goes into the set); a refusal names what is missing.
 */
export function nhatotFreshCoverage(input: {
  slices: readonly NhatotWindowSlice[]
  cities: readonly NhatotCityKey[]
  cgs: readonly number[]
  limit: number
  caps: boolean
  window: NhatotWindowParams | null | undefined
  fetchedAt: number
}): { ok: true; coverage: string } | { ok: false; why: string } {
  const w = input.window
  if (!w) return { ok: false, why: 'the read was not time-bounded (no --max-age-days)' }
  if (input.limit || input.caps) return { ok: false, why: 'the read was a sample (--limit/--cap)' }
  const cutoff = Date.parse(w.cutoff)
  if (!Number.isFinite(cutoff)) return { ok: false, why: `cutoff ${JSON.stringify(w.cutoff)} is not a date` }
  /** ⛔ The set is judged at the read's START (header): a later instant would claim ads listed during the read
   *  after their slice was done — ads this read never saw. */
  const started = Date.parse(w.readStartedAt)
  if (!Number.isFinite(started) || input.fetchedAt !== started) return { ok: false, why: `fetchedAt ${iso(input.fetchedAt)} is not the read's start (${JSON.stringify(w.readStartedAt)}) — the window is judged at the instant the read began` }
  if (cutoff > input.fetchedAt - FRESH_DAYS * DAY_MS) return { ok: false, why: `the read stopped at ${w.cutoff}, after the window's start (${iso(input.fetchedAt - FRESH_DAYS * DAY_MS)})` }
  if (!input.cgs.includes(NHATOT_APARTMENT_CG)) return { ok: false, why: `cg ${NHATOT_APARTMENT_CG} was not read` }
  const parts: string[] = []
  for (const city of NHATOT_ALL_CITIES) {
    if (!input.cities.includes(city)) return { ok: false, why: `${city} was not read` }
    const mine = input.slices.filter((s) => s.city === city && s.cg === NHATOT_APARTMENT_CG)
    const region = mine.find((s) => s.area === null)
    if (!region?.window) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: no time-bounded region slice` }
    /** ⛔ A city's apartment list is never empty and never wholly old: a read that says so read the wrong thing. */
    if (!(region.window.rowsRead > 0)) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: the region read 0 rows — an empty city list is a hiccup or a renumbered region, never evidence` }
    if (!(region.window.inWindow > 0)) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: the region read no non-pinned ad inside the window — nothing to vouch for` }
    if (region.window.covered) { parts.push(`${city}: ${region.window.why}`); continue }
    if (region.window.outcome !== 'capped') return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: ${region.window.outcome} — ${region.window.why}` }
    const districts = region.districts ?? []
    if (!districts.length) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: capped, and no district list to re-read it by` }
    if (region.arealess) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: capped, and ${region.arealess} rows carried no area_v2 — a per-district read cannot cover them` }
    const outside = (region.areasSeen ?? []).filter((a) => !districts.includes(a))
    if (outside.length) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: capped, and area_v2 ${outside.join(',')} seen in the region is not in the district list` }
    let pages = 0
    for (const d of districts) {
      const s = mine.find((x) => x.area === d)
      if (!s?.window) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}: district ${d} was not read` }
      if (!s.window.covered) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}/area ${d}: ${s.window.outcome} — ${s.window.why}` }
      /** An empty district is real only where the region read saw none of its ads. */
      if ((region.areasSeen ?? []).includes(d) && !(s.window.rowsRead > 0)) return { ok: false, why: `${city}/${NHATOT_APARTMENT_CG}/area ${d}: read 0 rows, but the region read saw its ads` }
      pages += s.window.pages + s.window.headPages
    }
    parts.push(`${city}: region ${region.window.why} → re-read by its ${districts.length} districts, every one to its boundary or end (${pages} pages incl. head re-reads), and all ${(region.areasSeen ?? []).length} area_v2 values seen in the region are among them`)
  }
  return {
    ok: true,
    coverage: `Nhà Tốt gateway, cg ${NHATOT_APARTMENT_CG} (apartments) in ${NHATOT_ALL_CITIES.join(', ')}, each list newest-first by list_time, read from ${w.readStartedAt} down to ${w.cutoff} (window ${FRESH_DAYS} d at fetch ${iso(input.fetchedAt)}; read ${w.maxAgeDays} d + margin); pages overlap ${w.overlap} rows — ${parts.join('; ')}`,
  }
}

/**
 * The fresh set: every APARTMENT ad (cg 1010) the read saw whose list_time is inside the window at
 * `fetchedAt` (the read's START) — whether or not eno has it, whatever the mapper would think of it. An ad
 * with no usable list_time, one listed after the start beyond the clock-skew allowance (re-listed during
 * the read: it cannot be judged at that instant), and a row that could not be staged at all go to
 * `unknown` (kept live, capped by freshSetProblem). `ads` holds the LATEST observation of each ad.
 * `skipped` = ids that cannot be named in a set of this source's shape (none exist in practice).
 */
export function nhatotBuildFreshSet(input: {
  ads: readonly NhatotStagedAd[]
  /** list_ids seen on apartment pages whose row could not be staged. */
  unjudged: readonly number[]
  fetchedAt: Date
  coverage: string
}): { set: FreshSet; skipped: number } {
  const shape = EXTERNAL_ID_SHAPE[NHATOT_SELLER_ID]
  const at = input.fetchedAt.getTime()
  const items = new Map<string, FreshItem>()
  const unknown = new Set<string>()
  let skipped = 0
  for (const ad of input.ads) {
    if (ad.category !== NHATOT_APARTMENT_CG) continue
    const id = `nhatot:${ad.list_id}`
    if (shape && !shape.test(id)) { skipped++; continue }
    if (ad.list_time === null) { unknown.add(id); continue }
    const d = new Date(ad.list_time)
    if (isInWindow(d, at)) {
      const had = items.get(id)
      if (!had || Date.parse(had.sourceDate) < ad.list_time) items.set(id, { externalId: id, sourceDate: d.toISOString(), dateKind: NHATOT_DATE_KIND })
    } else if (ad.list_time > at) {
      unknown.add(id)   // listed after the read's start, beyond the skew allowance: cannot be judged at fetchedAt
    }
  }
  for (const n of input.unjudged) {
    const id = `nhatot:${n}`
    if (shape && !shape.test(id)) { skipped++; continue }
    unknown.add(id)
  }
  for (const id of items.keys()) unknown.delete(id)
  const sorted = [...items.values()].sort((a, b) => a.externalId.localeCompare(b.externalId))
  return { set: makeFreshSet(NHATOT_SELLER_ID, input.fetchedAt, input.coverage, sorted, [...unknown].sort()), skipped }
}

/**
 * The whole stage-side decision: coverage, then the set, then the SAME validation the expiry will run on
 * it (freshSetProblem). Either a set that passes, or the reason none may be written.
 */
export function nhatotFreshDecision(staged: {
  fetchedAt: string
  params: { cities: NhatotCityKey[]; cgs: number[]; limit: number; caps?: Partial<Record<NhatotCityKey, number>>; window?: NhatotWindowParams | null }
  slices: readonly NhatotWindowSlice[]
  ads: readonly NhatotStagedAd[]
  unjudged?: readonly number[]
}, now: number): { ok: true; set: FreshSet; skipped: number } | { ok: false; why: string } {
  const fetchedAt = Date.parse(staged.fetchedAt)
  if (!Number.isFinite(fetchedAt)) return { ok: false, why: `fetchedAt ${JSON.stringify(staged.fetchedAt)} is not a date` }
  const cov = nhatotFreshCoverage({
    slices: staged.slices, cities: staged.params.cities, cgs: staged.params.cgs, limit: staged.params.limit,
    caps: !!staged.params.caps && Object.keys(staged.params.caps).length > 0, window: staged.params.window, fetchedAt,
  })
  if (!cov.ok) return cov
  const { set, skipped } = nhatotBuildFreshSet({ ads: staged.ads, unjudged: staged.unjudged ?? [], fetchedAt: new Date(fetchedAt), coverage: cov.coverage })
  const problem = freshSetProblem(JSON.parse(JSON.stringify(set)), now, NHATOT_SELLER_ID)
  if (problem) return { ok: false, why: `the set fails its own check: ${problem}` }
  return { ok: true, set, skipped }
}

// ─── --apply: an existing row the source shows fresh ─────────────────────────────────────────────

/** Is this subcategory the one the 7-day rule (and so revival) governs? Pinned to Chợ Tốt's 1010 mapping. */
export const nhatotIsApartment = (subcat: string | null) => subcat === APARTMENT_SUBCAT

/**
 * What --apply does to an EXISTING (not 'removed') row beyond its refreshable fields:
 *  · REVIVE — an apartment whose source date is inside the window at the STAGE's fetch time (the read's
 *    START — the set's fetchedAt), sitting in a
 *    status the 7-day rule (or a retire-to-stale) put it in → 'active'. Never 'hidden' (moderation, the
 *    retire pass's gone signal, the content screen), 'sold' or 'active'.
 *  · postedAt — the source date on a revival; otherwise only when the source date is NEWER than the stored
 *    one (re-posted). null = unchanged. The caller recomputes rankScore from it whenever it changes.
 */
export function nhatotExistingRowPlan(
  cur: { status: string; postedAt: Date },
  row: { postedAt: Date; subcategorySlug: string | null },
  stagedFetchedAt: number,
): { revive: boolean; postedAt: Date | null } {
  const fresh = nhatotIsApartment(row.subcategorySlug) && isInWindow(row.postedAt, stagedFetchedAt)
  const revive = fresh && (REVIVABLE_STATUSES as readonly string[]).includes(cur.status)
  if (revive) return { revive, postedAt: row.postedAt }
  return { revive, postedAt: row.postedAt.getTime() > cur.postedAt.getTime() ? row.postedAt : null }
}

// ─── --apply: the rollback lines (written only AFTER a write moved the row) ─────────────────────

/** A SQL string literal: a quote inside it is doubled. */
export const nhatotSqlLit = (x: string) => `'${x.replace(/'/g, "''")}'`
const sqlNum = (x: number) => {
  if (!Number.isFinite(x)) throw new Error(`rollback: ${x} is not a finite number`)
  return String(x)
}

/**
 * The ISR tombstone for one listing's PDP (en + vi) as a paste-safe statement — the same SQL and tags as
 * src/lib/pdp-tombstone.ts. Every rollback line carries one: a row a rollback flips keeps whatever its
 * page cached (a 404, or a live page) for 30 days otherwise.
 */
export function nhatotTombstoneSql(id: string): string {
  const tags = pdpTombstoneTags(id).map(nhatotSqlLit).join(',')
  return `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY[${tags}]) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
}

export type NhatotDateUndo = { id: string; oldPostedAt: Date; oldRankScore: number; newPostedAt: Date }

/**
 * Undo ONE revival this run made: the row's own old status and dates — guarded on the state the revival
 * created (still active, still the postedAt it set), so it can never re-expire a row another run or a
 * person has since revived or re-dated.
 */
export function nhatotRevivalRollbackSql(r: NhatotDateUndo & { oldStatus: string }): string {
  if (!(REVIVABLE_STATUSES as readonly string[]).includes(r.oldStatus)) throw new Error(`rollback: ${r.oldStatus} is not a status a revival comes from`)
  return `UPDATE "Listing" SET status = ${nhatotSqlLit(r.oldStatus)}, "postedAt" = ${nhatotSqlLit(r.oldPostedAt.toISOString())}, "rankScore" = ${sqlNum(r.oldRankScore)} WHERE id = ${nhatotSqlLit(r.id)} AND "sellerId" = ${nhatotSqlLit(NHATOT_SELLER_ID)} AND status = 'active' AND "postedAt" = ${nhatotSqlLit(r.newPostedAt.toISOString())};\n${nhatotTombstoneSql(r.id)}`
}

/** Undo ONE moved postedAt (a re-list): the old pair, only while the row still carries the date this run set. */
export function nhatotRepostRollbackSql(r: NhatotDateUndo): string {
  return `UPDATE "Listing" SET "postedAt" = ${nhatotSqlLit(r.oldPostedAt.toISOString())}, "rankScore" = ${sqlNum(r.oldRankScore)} WHERE id = ${nhatotSqlLit(r.id)} AND "sellerId" = ${nhatotSqlLit(NHATOT_SELLER_ID)} AND "postedAt" = ${nhatotSqlLit(r.newPostedAt.toISOString())} AND status <> 'removed';\n${nhatotTombstoneSql(r.id)}`
}
