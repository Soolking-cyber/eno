/**
 * Is a Rever.vn rental still on the market? Read from the listing page's OWN status badge.
 *
 * ⛔ "THE PAGE CONTAINS 'Đã thuê'" IS WRONG, AND IT IS THE OBVIOUS TEST. Every Rever detail page
 * carries a strip of RELATED listings, and each related card prints its own status
 * (`<div class="status rever-color">Đã thuê</div>`). Measured 2026-09-30: a live town house page
 * held the phrase five times, all of it from its neighbours. A text search would hide live flats.
 *
 * ✅ THE LISTING'S OWN STATE is the one `class="label-…"` badge in its header: "Sẵn sàng giao dịch"
 * (ready to transact) while it is available, "Đã thuê" once it is let — confirmed on two listings
 * Rever's own cards flag as rented. The related cards use `class="status …"`, never `label-`.
 *
 * ⚠️ RETIRE ONLY ON A POSITIVE SIGNAL. Anything this does not recognise — no badge, two badges, a
 * new wording, a redirect to a search page, a timeout — is 'unknown' and hides nothing, the same
 * rule every other importer's retire pass follows (import-rever-rentals.ts, import-muaban-net.ts).
 */
import { APARTMENT_SUBCAT, EXTERNAL_ID_PREFIX, FRESH_DAYS, REVIVABLE_STATUSES, isInWindow, type FreshItem } from './apartment-freshness'
import { pdpTombstoneTags } from './job-listing'
import { browseRankScore } from './ranking-formula'

export type ReverVerdict = 'live' | 'rented' | 'gone' | 'unknown'
export interface ReverLiveness { verdict: ReverVerdict; http: number; label: string | null }

const LIVE = 'Sẵn sàng giao dịch'
const RENTED = 'Đã thuê'

/** Text of every `class="label-…"` badge on the page, NFC-normalised and trimmed. */
export function reverStatusLabels(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/class="label-[^"]*"\s*>\s*([^<]{2,60}?)\s*</g)) out.push(m[1].normalize('NFC').trim())
  return out
}

/**
 * ⚠️ A PRICE-DROP BADGE ("giảm 7%") SHARES THE `label-` CLASS and sits beside the status — measured on
 * 17% of live pages, 2026-09-30. It says nothing about availability, so it is set aside; left in, those
 * pages read as "two badges" and a let flat with a recent price cut would never be retired.
 */
const PRICE_DROP = /^giảm\s*\d+(?:[.,]\d+)?\s*%$/i

/** The verdict from an answered page's status badges — also used to re-judge a saved status file. */
export function verdictFromLabels(http: number, rawLabels: string[]): ReverLiveness {
  if (http === 404 || http === 410) return { verdict: 'gone', http, label: null }
  if (http !== 200) return { verdict: 'unknown', http, label: null }
  const all = rawLabels.map((l) => l.normalize('NFC').trim()).filter(Boolean)
  const labels = all.filter((l) => !PRICE_DROP.test(l))
  const label = all.join(' | ') || null
  if (labels.length !== 1) return { verdict: 'unknown', http, label }
  if (labels[0] === RENTED) return { verdict: 'rented', http, label }
  if (labels[0] === LIVE) return { verdict: 'live', http, label }
  return { verdict: 'unknown', http, label }
}

export function classifyReverLiveness(http: number, html: string): ReverLiveness {
  if (http !== 200) return verdictFromLabels(http, [])
  // A removed listing that redirects to a search page still answers 200 — it has no detail header.
  if (!/<h1[\s>]/.test(html)) return { verdict: 'unknown', http, label: null }
  return verdictFromLabels(http, reverStatusLabels(html))
}

// ── THE 7-DAY RULE FOR REVER (src/lib/apartment-freshness.ts) ─────────────────────────────────────────
//
// Rever lists no post date; the detail header carries "Cập nhật: dd/mm/yyyy" — the agency re-touching the
// listing, the only re-post signal it shows. A row is FRESH when that date is inside FRESH_DAYS at fetch
// time AND its own badge says available. Measured 2026-10-01: no new HCMC rental since 2026-06-12 and
// every live row's date 152+ days old, so there is no new-row import here — only a check of the rows eno
// already holds (active, and the expired/stale ones that may come back), one detail GET each.

/** Asia/Ho_Chi_Minh is UTC+7 all year (no DST since 1975). */
const HCMC_OFFSET_MS = 7 * 3_600_000
/** A check is COMPLETE when at least this share of its checked rows could be judged. */
export const REVER_MIN_ANSWERED = 0.98
/**
 * …OR when no more than this many live rows are undetermined, whatever the share — freshSetProblem's own
 * absolute floor (`unknown.length > 5 && …` refuses; five or fewer never does). Without it a small live
 * population (after the first expiry most Rever rows are down) could never be complete: 1 unanswered page
 * of 40 live rows is 97.5%, under the share, though the set it would write passes every check on read.
 */
export const REVER_UNKNOWN_FLOOR = 5
/**
 * ⛔ A MASS-FRESH CHECK IS A SITE CHANGE, NOT A MARKET. When at least `REVER_MASS_FRESH_SHARE` of at least
 * `REVER_MASS_FRESH_MIN` JUDGED live rows read fresh in one check, Rever has most likely started printing a
 * render or migration date in "Cập nhật" on every page — the fresh set and the re-date are both refused.
 */
export const REVER_MASS_FRESH_SHARE = 0.5
export const REVER_MASS_FRESH_MIN = 20

/**
 * The listing's own "Cập nhật" date as printed (`dd/mm/yyyy`), or null. Markup, confirmed 2026-10-01:
 *   <div class="listing-date-updated"><span>Cập nhật:</span><strong>08/09/2021</strong></div>
 * It sits in the listing's OWN header — the related cards carry no such block (one per page, measured).
 * ⚠️ EXACTLY ONE BLOCK OR NOTHING: two blocks means the markup moved, and guessing which one is the
 * listing's would be the same mistake as reading "Đã thuê" off a related card.
 */
export function reverUpdatedText(html: string): string | null {
  const found: string[] = []
  const re = /class="listing-date-updated(?:\s[^"]*)?"\s*>\s*<span>\s*([^<]*?)\s*<\/span>\s*<strong>\s*([^<]*?)\s*<\/strong>/g
  for (const m of html.matchAll(re)) {
    if (!/^cập nhật\s*:?$/i.test(m[1].normalize('NFC'))) continue
    found.push(m[2].normalize('NFC'))
  }
  return found.length === 1 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(found[0]) ? found[0] : null
}

/**
 * `dd/mm/yyyy` → the START of that day in Asia/Ho_Chi_Minh — the WORST case (oldest instant) a
 * day-granular date can mean, so the window is never judged in the row's favour. Null for anything that
 * is not a real calendar day (31/02, 00/10, a two-digit year).
 */
export function reverDayStart(text: string | null | undefined): Date | null {
  const m = typeof text === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim()) : null
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null
  const utc = Date.UTC(y, mo - 1, d)
  if (new Date(utc).getUTCDate() !== d) return null // 31/02 rolls into March
  return new Date(utc - HCMC_OFFSET_MS)
}

export interface ReverPageRead extends ReverLiveness {
  /** The page's own "Cập nhật" text — read only from an answered DETAIL page (the header classify needs). */
  updated: string | null
}

export function readReverPage(http: number, html: string): ReverPageRead {
  const v = classifyReverLiveness(http, html)
  return { ...v, updated: http === 200 && /<h1[\s>]/.test(html) ? reverUpdatedText(html) : null }
}

/** One line of the saved check file (`--save`), the evidence both the fresh set and `--src` are built from. */
export interface ReverCheckRecord {
  id: string
  externalId: string | null
  /** The row's status on eno when it was checked. */
  status: string | null
  url: string
  http: number
  label: string | null
  verdict: ReverVerdict
  updated: string | null
  checkedAt: string
  /** The row's postedAt on eno when it was checked (ISO) — tells a NEWLY fresh row from one already dated
   *  to its current "Cập nhật". Absent in checks saved before 2026-10-02 (read as newly fresh). */
  postedAt?: string | null
}

/**
 * A saved verdict re-judged with the CURRENT rule. A saved 'unknown' with no badge text was a redirect,
 * timeout or bare page — the re-judge may only ever SHARPEN a verdict it had the badges for (a price-drop
 * badge beside the status), never turn "no evidence" into "gone" from a status code alone.
 */
export function rejudgeSaved(r: Pick<ReverCheckRecord, 'http' | 'label' | 'verdict'>): ReverLiveness {
  return r.verdict === 'unknown' && !r.label
    ? { verdict: 'unknown', http: r.http, label: null }
    : verdictFromLabels(r.http, r.label ? r.label.split(' | ') : [])
}

/**
 * Parse a saved check (JSONL). ⛔ REFUSED WHOLE when any line is over `maxAgeH` old, in the future, or
 * undated — an old file must never be re-judged as if it were today's. Older files (before the 7-day rule)
 * carry no externalId/status/updated; those read as null, which can never make a row fresh.
 * Duplicate ids (two runs appended to one file) keep the LATEST check.
 */
export function parseSavedCheck(text: string, now: number, maxAgeH: number): ReverCheckRecord[] {
  const byId = new Map<string, ReverCheckRecord>()
  for (const [n, l] of text.split('\n').entries()) {
    if (!l.trim()) continue
    const r = JSON.parse(l) as Partial<ReverCheckRecord>
    if (typeof r.id !== 'string' || typeof r.url !== 'string') throw new Error(`line ${n + 1}: no id/url`)
    const at = typeof r.checkedAt === 'string' ? Date.parse(r.checkedAt) : NaN
    const ageH = (now - at) / 3_600_000
    if (!(ageH >= 0 && ageH <= maxAgeH)) throw new Error(`row ${r.id} was checked ${Number.isFinite(ageH) ? `${ageH.toFixed(1)} h ago` : 'at no valid time'} — re-run the check (max ${maxAgeH} h)`)
    const rec: ReverCheckRecord = {
      id: r.id,
      externalId: typeof r.externalId === 'string' ? r.externalId : null,
      status: typeof r.status === 'string' ? r.status : null,
      url: r.url,
      http: typeof r.http === 'number' ? r.http : 0,
      label: typeof r.label === 'string' ? r.label : null,
      verdict: r.verdict === 'live' || r.verdict === 'rented' || r.verdict === 'gone' ? r.verdict : 'unknown',
      updated: typeof r.updated === 'string' ? r.updated : null,
      checkedAt: r.checkedAt!,
      // ⛔ Carried through: the mass-fresh guard tells a NEWLY fresh row from a settled one by it, and the
      // apply must reach the very decision the check run reached from the same file.
      postedAt: typeof r.postedAt === 'string' && Number.isFinite(Date.parse(r.postedAt)) ? r.postedAt : null,
    }
    const prev = byId.get(rec.id)
    if (!prev || Date.parse(prev.checkedAt) <= at) byId.set(rec.id, rec)
  }
  return [...byId.values()]
}

export type ReverFreshness =
  | { kind: 'fresh'; sourceDate: Date }
  | { kind: 'not-fresh'; why: 'old' | 'rented' | 'gone' }
  | { kind: 'unknown'; why: string }

/**
 * One row against the window, judged at `at` (the set's fetchedAt). A let or gone listing is not fresh
 * whatever its date; a date older than the window is not fresh whatever its badge; fresh needs BOTH a
 * date inside the window and the listing's own "Sẵn sàng giao dịch". Anything else — no date on a live
 * page, an unread badge on a recent page, a date in the future, a fetch that failed — is undetermined.
 */
export function judgeReverFreshness(r: Pick<ReverCheckRecord, 'http' | 'label' | 'verdict' | 'updated'>, at: number): ReverFreshness {
  const v = rejudgeSaved(r)
  if (v.verdict === 'gone') return { kind: 'not-fresh', why: 'gone' }
  if (v.verdict === 'rented') return { kind: 'not-fresh', why: 'rented' }
  // The date is evidence only from an answered page (readReverPage reads it from a 200 detail page only).
  const day = v.http === 200 ? reverDayStart(r.updated) : null
  if (!day) return { kind: 'unknown', why: v.verdict === 'live' ? 'no Cập nhật date on the page' : `no answer (http ${v.http})` }
  if (!isInWindow(day, at)) {
    // isInWindow refuses both ends; only the OLD end is evidence. A future date is a clock or markup oddity.
    return day.getTime() > at ? { kind: 'unknown', why: `Cập nhật ${r.updated} is in the future` } : { kind: 'not-fresh', why: 'old' }
  }
  return v.verdict === 'live' ? { kind: 'fresh', sourceDate: day } : { kind: 'unknown', why: `recent but the badge is unread (${v.label ?? 'none'})` }
}

export interface ReverFreshDecision {
  /** The latest check in the records — the instant the whole set is judged at (the strictest one). */
  fetchedAt: Date | null
  /** Per listing id, every checked status — the apply revives from this. */
  byId: Map<string, ReverFreshness>
  /** Fresh rows of EVERY status: a row the apply revives must be in the set, or the expiry takes it again. */
  items: FreshItem[]
  /**
   * externalIds of rows LIVE when checked that could not be judged — kept live by the expiry, never
   * revived. An undetermined expired/stale row is NOT listed: the expiry acts on live rows only, so it
   * could keep nothing up, and listing it would only spend freshSetProblem's undetermined cap.
   */
  unknown: string[]
  counts: {
    checked: number
    /** Of `checked`, the rows that were live (`active`) when checked — the coverage denominator. */
    live: number
    fresh: number; old: number; rented: number; gone: number
    /** Live rows undetermined (in `unknown`). */
    unknown: number
    /** Expired/stale rows undetermined — left down, not in `unknown`. */
    unknownDown: number
    /** Of the rows live when checked: judged fresh, and judged at all (fresh or not-fresh) — the mass-fresh guard. */
    liveFresh: number
    liveJudged: number
    noReverId: number
  }
  /** Share of the LIVE checked rows that were judged (1 when none was live — nothing for the expiry to act on). */
  answeredShare: number
  complete: boolean
  /**
   * massFreshRefusal over the rows live when checked, or null. When set, the check writes NO fresh set and
   * the apply re-dates nothing (both exit COVERAGE_REFUSED): the same records give the same answer to both.
   */
  massFresh: string | null
  coverage: string
}

const REVER_PREFIX = EXTERNAL_ID_PREFIX['cmub0wead0000zrq418bqq27m']
const isReverId = (x: string | null): x is string => typeof x === 'string' && x.startsWith(REVER_PREFIX) && x.length > REVER_PREFIX.length
/**
 * Was the row LIVE when it was checked? Only those can be acted on by the expiry, so only those count
 * toward coverage. A line with no status (a pre-7-day-rule file) reads as live: the stricter reading.
 */
const wasLiveWhenChecked = (r: Pick<ReverCheckRecord, 'status'>) => r.status === null || r.status === 'active'

/** One record per listing id: the LATEST check (two runs appended to one file, or a re-check). */
function latestById(records: readonly ReverCheckRecord[]): Map<string, ReverCheckRecord> {
  const latest = new Map<string, ReverCheckRecord>()
  for (const r of records) {
    const prev = latest.get(r.id)
    if (!prev || Date.parse(prev.checkedAt) <= Date.parse(r.checkedAt)) latest.set(r.id, r)
  }
  return latest
}

/**
 * The fresh decision over one check — the SAME function for the check run (which writes the fresh set)
 * and the `--src` apply (which revives from it), so the two can never disagree about a row.
 * ⚠️ JUDGED AT THE LAST CHECK, not at each row's own: a row checked at the start of a 40-minute run is
 * judged 40 minutes older than it was — never younger — so an item can only be in the set if it is still
 * inside the window at the set's fetchedAt, which is what freshSetProblem re-checks. The apply rebuilds
 * this from the same saved records, so its revive/re-date decisions are judged at that same instant.
 * `scope` states what was checked (the coverage evidence). COMPLETE needs at least one checked row (an
 * empty check proves nothing) and ≥ REVER_MIN_ANSWERED of the rows LIVE WHEN CHECKED judged — the only
 * rows "not in the set" can expire. Expired/stale rows are judged too (fresh ones go into `items`, since
 * the apply revives them) but are not in the denominator: Rever removing a long-dead listing (a redirect,
 * a bare page) must not stall the whole source's set (verifier, 2026-10-01).
 */
export function reverFreshDecision(records: readonly ReverCheckRecord[], scope: string): ReverFreshDecision {
  const rows = [...latestById(records).values()]
  const times = rows.map((r) => Date.parse(r.checkedAt)).filter(Number.isFinite)
  const at = times.length ? Math.max(...times) : NaN
  const first = times.length ? Math.min(...times) : NaN
  const counts = { checked: 0, live: 0, fresh: 0, old: 0, rented: 0, gone: 0, unknown: 0, unknownDown: 0, liveFresh: 0, liveJudged: 0, noReverId: 0 }
  const byId = new Map<string, ReverFreshness>()
  const items: FreshItem[] = []
  const unknown: string[] = []
  for (const r of rows) {
    // A row outside Rever's id space can never be in a valid set (freshSetProblem) — reported, not judged.
    if (!isReverId(r.externalId)) { counts.noReverId++; continue }
    counts.checked++
    const live = wasLiveWhenChecked(r)
    if (live) counts.live++
    const j: ReverFreshness = Number.isFinite(Date.parse(r.checkedAt)) ? judgeReverFreshness(r, at) : { kind: 'unknown', why: 'no check time' }
    byId.set(r.id, j)
    // The mass-fresh guard counts only NEWLY fresh live rows — a "Cập nhật" later than the postedAt eno holds.
    // Once the rule works, most live rows are fresh BY DESIGN (that is why they are live); counting those
    // would refuse every week and leave date-expired rows public. A site-wide date change, the thing the
    // guard is for, moves every live row's date past its postedAt at once.
    if (live && j.kind !== 'unknown') {
      counts.liveJudged++
      const held = r.postedAt ? Date.parse(r.postedAt) : NaN
      if (j.kind === 'fresh' && !(Number.isFinite(held) && j.sourceDate.getTime() <= held)) counts.liveFresh++
    }
    if (j.kind === 'fresh') { counts.fresh++; items.push({ externalId: r.externalId, sourceDate: j.sourceDate.toISOString(), dateKind: 'updated' }) }
    else if (j.kind === 'not-fresh') counts[j.why]++
    else if (live) { counts.unknown++; unknown.push(r.externalId) }
    else counts.unknownDown++
  }
  const answeredShare = counts.live ? (counts.live - counts.unknown) / counts.live : 1
  // The absolute floor is freshSetProblem's: five or fewer undetermined never fails the set on read.
  // ⛔ A row outside Rever's id space was never judged: the expiry would read its absence from the set as
  // "not fresh". Every Rever row carries a rever:<epochMs>_<n> id (measured: 975/975), so any such row
  // means something changed — refuse the set rather than expire what was never looked at.
  const complete = counts.checked > 0 && counts.noReverId === 0 && (counts.unknown <= REVER_UNKNOWN_FLOOR || answeredShare >= REVER_MIN_ANSWERED)
  const massFresh = massFreshRefusal(counts.liveFresh, counts.liveJudged)
  const span = times.length ? `${new Date(first).toISOString()} → ${new Date(at).toISOString()}` : 'no check times'
  const share = counts.live
    ? `${(answeredShare * 100).toFixed(1)}% of the ${counts.live} rows live when checked answered (needs ≥ ${REVER_MIN_ANSWERED * 100}%, or ≤ ${REVER_UNKNOWN_FLOOR} undetermined)`
    : 'no row was live when checked — nothing for the expiry to act on'
  const coverage = `${scope}; one detail GET per row, ${span}: ${counts.checked} checked (${counts.live} live, ${counts.checked - counts.live} expired/stale) — ${counts.fresh} fresh (Cập nhật within ${FRESH_DAYS} days AND own badge "Sẵn sàng giao dịch"), ${counts.old} updated over ${FRESH_DAYS} days ago, ${counts.rented} let, ${counts.gone} gone (404/410), ${counts.unknown} live rows undetermined (kept live), ${counts.unknownDown} expired/stale rows undetermined (left down) — ${share}${counts.noReverId ? `; ${counts.noReverId} rows without a ${REVER_PREFIX} id left out` : ''}`
  return { fetchedAt: Number.isFinite(at) ? new Date(at) : null, byId, items, unknown, counts, answeredShare, complete, massFresh, coverage }
}

/**
 * ⛔ See REVER_MASS_FRESH_SHARE. `fresh` of `judged` rows LIVE when checked (fresh + not-fresh; an
 * undetermined row is no evidence either way, so it never dilutes the share). At or above the share, past
 * the sample, the run is refused: a reason string, else null.
 */
export function massFreshRefusal(fresh: number, judged: number, minShare = REVER_MASS_FRESH_SHARE, minSample = REVER_MASS_FRESH_MIN): string | null {
  if (judged < minSample || fresh / judged < minShare) return null
  return `${fresh}/${judged} judged live rows (${Math.round((fresh / judged) * 100)}%) read as updated within ${FRESH_DAYS} days in one check — a site-wide "Cập nhật" change, not a market event; refusing the fresh set and the re-date (look at a few pages by hand)`
}

// ── THE APPLY PLAN (--src --apply) ────────────────────────────────────────────────────────────────────

/** The columns of a Listing row the apply decides on. */
export interface ReverApplyRow {
  id: string
  externalId: string | null
  status: string
  affiliateUrl: string | null
  subcategorySlug: string | null
  postedAt: Date
}

export interface ReverApplyPlan<R extends ReverApplyRow> {
  /** Live rows Rever shows let or gone → 'stale'. */
  hide: { row: R; url: string; verdict: 'rented' | 'gone' }[]
  /** Expired/stale rows Rever shows fresh → 'active', postedAt = sourceDate. */
  revive: { row: R; url: string; sourceDate: Date }[]
  /** Live rows Rever shows updated STRICTLY after their postedAt → postedAt = sourceDate. Empty under massFresh. */
  repost: { row: R; url: string; sourceDate: Date }[]
  /** Re-dates the mass-fresh guard refused (decision.massFresh): counted, never written. */
  repostRefused: number
  /** Revivals the mass-fresh guard refused — a revival rests on nothing but the same date. Counted, never written. */
  reviveRefused: number
  /** Verdicts of the rows live NOW (a row whose URL or externalId moved since the check is 'unknown'). */
  tally: { live: number; rented: number; gone: number; unknown: number }
  /** Fresh decision of the rows expired/stale NOW (a moved row is 'unknown'). */
  down: { fresh: number; 'not-fresh': number; unknown: number }
  /** Rows with no record in the check, or of a status this never touches (hidden, removed, sold, …). */
  untouched: number
  /** massRetireRefusal's denominator: live rows with an answer. */
  answered: number
  /** massReviveRefusal's denominator: expired/stale rows judged fresh or not-fresh. */
  reviveJudged: number
}

const isRevivable = (s: string) => (REVIVABLE_STATUSES as readonly string[]).includes(s)

/**
 * WHICH ROWS THE APPLY CHANGES — pure, so the guarantees are tested rather than resting on a findMany
 * filter and a where clause (verifier, 2026-10-01). `rows` are the Listing rows as they are NOW; `records`
 * the saved check; `decision` reverFreshDecision over those same records.
 *   · Only `active` rows can be hidden or re-dated, only REVIVABLE_STATUSES rows revived. A hidden,
 *     removed or sold row — or any other status, or a non-apartment row — is never touched.
 *   · ⛔ The verdict belongs to the URL AND externalId that were checked: a row repointed since (either
 *     moved) is judged by nothing. The retire keeps its old tolerance of a record with no externalId (a
 *     line written before the 7-day rule) — a revive or re-date needs both to match exactly.
 *   · Re-date only when the source date is STRICTLY newer than postedAt (postedAt only moves forward),
 *     and never when the decision carries massFresh (the re-dates are counted in repostRefused instead).
 *   · Under massFresh nothing is REVIVED either (reviveRefused): a revival rests on that same date.
 */
export function planReverApply<R extends ReverApplyRow>(
  rows: readonly R[],
  records: readonly ReverCheckRecord[],
  decision: Pick<ReverFreshDecision, 'byId' | 'massFresh'>,
): ReverApplyPlan<R> {
  const byId = latestById(records)
  const plan: ReverApplyPlan<R> = {
    hide: [], revive: [], repost: [], repostRefused: 0, reviveRefused: 0,
    tally: { live: 0, rented: 0, gone: 0, unknown: 0 },
    down: { fresh: 0, 'not-fresh': 0, unknown: 0 },
    untouched: 0, answered: 0, reviveJudged: 0,
  }
  for (const r of rows) {
    const rec = byId.get(r.id)
    const live = r.status === 'active'
    if (!rec || !r.affiliateUrl || r.subcategorySlug !== APARTMENT_SUBCAT || !(live || isRevivable(r.status))) { plan.untouched++; continue }
    const url = r.affiliateUrl
    const sameUrl = rec.url === url
    const sameId = rec.externalId !== null && rec.externalId === r.externalId
    if (live) {
      if (!sameUrl || !(rec.externalId === null || sameId)) { plan.tally.unknown++; continue }
      const v = rejudgeSaved(rec)
      plan.tally[v.verdict]++
      if (v.verdict === 'rented' || v.verdict === 'gone') { plan.hide.push({ row: r, url, verdict: v.verdict }); continue }
      const f = sameId ? decision.byId.get(r.id) : undefined
      // Re-posted on Rever since postedAt last moved: keep postedAt at the LATEST source date (the backstop keys on it).
      // ⛔ Under massFresh no date moves: a render date on every page would otherwise re-date every live row.
      if (f?.kind === 'fresh' && f.sourceDate.getTime() > r.postedAt.getTime()) {
        if (decision.massFresh) plan.repostRefused++
        else plan.repost.push({ row: r, url, sourceDate: f.sourceDate })
      }
    } else {
      const f = sameUrl && sameId ? decision.byId.get(r.id) : undefined
      plan.down[f?.kind ?? 'unknown']++
      // ⛔ Under massFresh the "Cập nhật" date is not evidence (a render date on every page): no revival either.
      if (f?.kind === 'fresh') {
        if (decision.massFresh) plan.reviveRefused++
        else plan.revive.push({ row: r, url, sourceDate: f.sourceDate })
      }
    }
  }
  plan.answered = plan.tally.live + plan.tally.rented + plan.tally.gone
  plan.reviveJudged = plan.down.fresh + plan.down['not-fresh']
  return plan
}

/** A SQL string literal, quotes doubled — for the rollback files. */
export const sqlLiteral = (x: string) => `'${x.replace(/'/g, "''")}'`

/**
 * The condition every rollback line carries beside its status/postedAt guard: the row has not been written
 * since THIS write (`updatedAt` is what the write returned). ⛔ Since the 7-day rule a row can cycle
 * stale → active → stale (retired, revived, retired again): status alone would let an old rollback file
 * flip a LATER retirement back. Throws on an invalid date — an unguarded rollback line is never written.
 */
export function updatedAtGuardSql(updatedAt: Date): string {
  if (!(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) throw new Error(`no valid updatedAt (${String(updatedAt)}) — refusing to write an unguarded rollback line`)
  return `"updatedAt"<=${sqlLiteral(updatedAt.toISOString())}`
}

/**
 * The per-page ISR tombstone a rollback line carries for the rows it flips back — the same tags and
 * upsert as tombstonePdps (src/lib/pdp-tombstone.ts), as plain SQL a human runs with psql. Without it a
 * row a rollback brings back keeps its cached 404 for 30 days (or one it takes down keeps rendering).
 */
export function isrTombstoneSql(ids: readonly string[]): string {
  const tags = ids.flatMap(pdpTombstoneTags).map(sqlLiteral).join(',')
  return `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY[${tags}]) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
}

/**
 * ⛔ A MASS REVIVAL IS A SITE CHANGE, NOT A MARKET. Every revivable Rever row was 152+ days stale when
 * this shipped; if Rever started printing today's date on every page (a render date, a migration), each
 * of them would come back at once and stay up. Past `minSample` judged revivable rows, a revived share
 * above `maxShare` refuses the run (`--force-mass-revive` overrides, after a human has looked).
 */
export function massReviveRefusal(revive: number, judged: number, maxShare = 0.5, minSample = 20): string | null {
  if (judged < minSample || revive / judged <= maxShare) return null
  return `${revive}/${judged} judged expired/stale rows (${Math.round((revive / judged) * 100)}%) read as fresh again — more like a site change than re-posts; refusing to revive them (look at a few pages by hand, then --force-mass-revive)`
}

/**
 * The rankScore a row gets when its postedAt moves to a Rever date (a revival, or a newer "Cập nhật"):
 * browseRankScore from that SOURCE date — never "now" — with the row's own trust, demand and featured
 * inputs, i.e. exactly what the nightly SQL recompute (rankScoreExprSql) gives the row. The Rever
 * importer itself writes no rankScore at create (the column default, then that recompute), so the
 * recompute is the one formula to match.
 */
export function reverRepostRank(
  row: { sellerTrustScore: number; featured: boolean; views: number; contactCount: number },
  postedAt: Date,
  now: number,
): number {
  return browseRankScore({ sellerTrustScore: row.sellerTrustScore, postedAt, featured: row.featured, views: row.views, contactCount: row.contactCount }, now)
}
