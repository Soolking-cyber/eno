/**
 * THE 7-DAY RULE FOR IMPORTED APARTMENT RENTALS — the pure half (no DB, no network).
 *
 * Owner, 2026-10-01: "we need only 7 days old apartments fetched weekly, remove else, only new active
 * apartments" → asked, and chose: an imported apartment stays live only while its SOURCE shows it posted
 * OR RE-POSTED within the last 7 days ("the date each site shows"); apartments only; refreshed weekly.
 *
 * Each source step writes a FRESH SET — every apartment ad of that source whose date is inside the window
 * at fetch time, including ads already in the DB — and scripts/expire-apartment-rentals.ts then marks
 * every live row of that seller that is NOT in the set EXPIRED_STATUS. The date per source is different.
 * Before this rule Listing.postedAt was create-only (for Batdongsan and Rever just the import time); the
 * importers now keep it at the LATEST source date they have seen (create, revival, a newer update), which
 * is what the expiry script's backstop reads. The source dates:
 *   · Batdongsan — the card's "Đăng N ngày trước" label (a renewal date), at its worst-case age.
 *   · Nhà Tốt    — `list_time` (the last re-list).
 *   · Muaban     — the detail page's `created_at`: its `publish_at` is a nightly automatic re-publish of
 *                  every ad, so "re-posted" there would mean "every ad, every night".
 *   · Honeycomb  — the sitemap `lastmod` (the agency re-touching the listing).
 *   · Rever      — the detail page's "Cập nhật" date, with its own "Sẵn sàng giao dịch" badge.
 *
 * ⛔ THE SET IS THE ONLY EVIDENCE AN EXPIRY ACTS ON, SO IT MUST PROVE IT IS WHOLE. A crawl that was
 * blocked half way produces a short set, and "not in the set" would then hide live flats. Hence: the set
 * says `complete: true` with the evidence in `coverage`, it is refused when older than a day, and
 * planExpiry refuses a set that shrank below MIN_SHARE of the last applied one.
 */
import { RENTAL_IMPORT_SELLERS } from './import-sellers'

export const FRESH_DAYS = 7
export const APARTMENT_SUBCAT = 'apartment-rental'
/**
 * ⛔ ITS OWN STATUS, NOT 'stale'. 'stale' is already written by retire-stale-batdongsan.ts (2026-09-30)
 * and retire-rever-rentals.ts (rented/gone), and each left a rollback .sql that flips its ids back while
 * they are still 'stale' — run after this rule, those files would republish rows it expired. A distinct
 * value also says WHY a row is down. Publicly it is as invisible as 'stale' or 'hidden': the PDP gate
 * admits active|sold only, every feed pins active, and nothing in src/ reads it. Not 'hidden' either —
 * hide-imageless-imports.ts --restore republishes every photo-bearing hidden import row.
 */
export const EXPIRED_STATUS = 'expired'
/** Statuses a row may come back FROM when its source shows it fresh again — never 'hidden'/'removed'. */
export const REVIVABLE_STATUSES = [EXPIRED_STATUS, 'stale'] as const
export const FRESH_SET_KIND = 'apartment-fresh-set'
export const FRESH_SET_VERSION = 1
/** A set describes one moment; the market turns over in days. */
export const FRESH_SET_MAX_AGE_MS = 24 * 3_600_000
/** Clock skew tolerated between the machine that fetched and the one that judges. */
const SKEW_MS = 5 * 60_000
const DAY_MS = 86_400_000
/** A set smaller than this share of the baseline reads as a blocked or partial crawl. */
export const MIN_SHARE = 0.6
/** The baseline is the LARGEST of this many last applied sets — so a slow decline cannot ratchet it down. */
export const BASELINE_RUNS = 4
/** A set may leave at most this share of its checked rows undetermined (timeouts, 5xx) and still count. */
export const MAX_UNKNOWN_SHARE = 0.05
/** Below this many items last time, a source is too small for a share to mean anything. */
export const SHARE_FLOOR = 20
/** With no applied history, an expiry may take at most this share of a source's live rows unforced. */
export const NO_HISTORY_MAX_SHARE = 0.5
/**
 * After the import step has run, at least this share of a set's ids must exist as rows of the seller (any
 * status) — the importer just created or refreshed them. Far fewer means the set and the database speak
 * different id spaces (a list_id/ad_id mix-up both shapes accept), and "not in the set" would then expire
 * nearly every live row while every count-based guard passes.
 */
export const MIN_KNOWN_SHARE = 0.3

/**
 * The exact externalId SHAPE each import seller writes. A set for one seller can never expire another's
 * rows, and a source that silently changed its id scheme (list_id → ad_id) is refused instead of
 * matching nothing and expiring every live row.
 */
export const EXTERNAL_ID_SHAPE: Record<string, RegExp> = {
  'bds-vn-import-seller-0001': /^bds:pr\d{6,10}$/,
  'cmub0wead0000zrq418bqq27m': /^rever:\d{13}_\d+$/,
  'nhatot-import-seller-0001': /^nhatot:\d{6,12}$/,
  'muaban-net-import-seller-0001': /^muaban:\d{6,12}$/,
  'honeycomb-import-seller-0001': /^honeycomb:\d{1,9}$/,
}
/** externalId prefix each import seller writes. */
export const EXTERNAL_ID_PREFIX: Record<(typeof RENTAL_IMPORT_SELLERS)[number], string> = {
  'bds-vn-import-seller-0001': 'bds:',
  'cmub0wead0000zrq418bqq27m': 'rever:',
  'nhatot-import-seller-0001': 'nhatot:',
  'muaban-net-import-seller-0001': 'muaban:',
  'honeycomb-import-seller-0001': 'honeycomb:',
}

export const DATE_KINDS = ['renewal-label', 'list-time', 'created', 'modified', 'updated'] as const
export type DateKind = (typeof DATE_KINDS)[number]

export interface FreshItem {
  externalId: string
  /** ISO instant — the source's posted/re-posted date (worst case where the source only gives a range). */
  sourceDate: string
  dateKind: DateKind
}

export interface FreshSet {
  kind: typeof FRESH_SET_KIND
  v: typeof FRESH_SET_VERSION
  sellerId: string
  fetchedAt: string
  windowDays: number
  complete: true
  /** Human-readable proof that the crawl covered the whole window (pages read, boundary reached, …). */
  coverage: string
  items: FreshItem[]
  /**
   * externalIds the step looked at but could not judge (a timeout, a 5xx, an unparsable page). They are
   * KEPT live this run — not knowing is not evidence of age — and the share is capped (MAX_UNKNOWN_SHARE).
   */
  unknown?: string[]
}

const isRentalSeller = (id: string): id is keyof typeof EXTERNAL_ID_PREFIX => id in EXTERNAL_ID_PREFIX

export function makeFreshSet(sellerId: string, fetchedAt: Date, coverage: string, items: FreshItem[], unknown: string[] = []): FreshSet {
  return { kind: FRESH_SET_KIND, v: FRESH_SET_VERSION, sellerId, fetchedAt: fetchedAt.toISOString(), windowDays: FRESH_DAYS, complete: true, coverage, items, unknown }
}

/** Is a source date inside the window, judged at `at`? Future dates (beyond skew) are refused, not trusted. */
export function isInWindow(sourceDate: Date, at: number, windowDays = FRESH_DAYS): boolean {
  const t = sourceDate.getTime()
  return Number.isFinite(t) && t <= at + SKEW_MS && at - t <= windowDays * DAY_MS
}

/**
 * Why this file must not be acted on, or null. Checked on read, never trusted from the writer: a hand-
 * edited or stale set is exactly how an expiry would hide the wrong rows.
 */
export function freshSetProblem(raw: unknown, now: number, expectSeller?: string): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not a JSON object'
  const s = raw as Record<string, unknown>
  if (s.kind !== FRESH_SET_KIND) return `kind is ${JSON.stringify(s.kind)}, expected "${FRESH_SET_KIND}"`
  if (s.v !== FRESH_SET_VERSION) return `version ${JSON.stringify(s.v)}, expected ${FRESH_SET_VERSION}`
  if (typeof s.sellerId !== 'string' || !isRentalSeller(s.sellerId)) return `seller ${JSON.stringify(s.sellerId)} is not a rental import seller`
  if (expectSeller !== undefined && s.sellerId !== expectSeller) return `set is for ${s.sellerId}, not ${expectSeller}`
  const fetched = typeof s.fetchedAt === 'string' ? Date.parse(s.fetchedAt) : NaN
  if (!Number.isFinite(fetched)) return 'fetchedAt is missing or not a date'
  if (fetched > now + SKEW_MS) return `fetchedAt ${s.fetchedAt} is in the future`
  if (now - fetched > FRESH_SET_MAX_AGE_MS) return `fetchedAt ${s.fetchedAt} is over ${FRESH_SET_MAX_AGE_MS / 3_600_000} h old — fetch again`
  if (s.windowDays !== FRESH_DAYS) return `windowDays ${JSON.stringify(s.windowDays)}, expected ${FRESH_DAYS}`
  if (s.complete !== true) return 'the set does not claim complete coverage — a partial crawl cannot drive an expiry'
  if (typeof s.coverage !== 'string' || !s.coverage.trim()) return 'coverage evidence is missing'
  if (!Array.isArray(s.items)) return 'items is not an array'
  const prefix = EXTERNAL_ID_PREFIX[s.sellerId]
  const seen = new Set<string>()
  for (const [i, it] of (s.items as unknown[]).entries()) {
    if (!it || typeof it !== 'object') return `item ${i} is not an object`
    const { externalId, sourceDate, dateKind } = it as Record<string, unknown>
    if (typeof externalId !== 'string' || !externalId.startsWith(prefix) || !EXTERNAL_ID_SHAPE[s.sellerId].test(externalId)) return `item ${i}: externalId ${JSON.stringify(externalId)} is not a ${prefix}… id of this source's shape`
    if (seen.has(externalId)) return `item ${i}: ${externalId} appears twice`
    seen.add(externalId)
    if (typeof dateKind !== 'string' || !(DATE_KINDS as readonly string[]).includes(dateKind)) return `item ${i}: dateKind ${JSON.stringify(dateKind)}`
    const d = typeof sourceDate === 'string' ? new Date(sourceDate) : new Date(NaN)
    // No slack: a day-granular or range-valued source must write its WORST case (the start of the day,
    // the far end of "N ngày trước"), so the window is judged the same strict way for every source.
    if (!isInWindow(d, fetched)) return `item ${i}: ${externalId} sourceDate ${JSON.stringify(sourceDate)} is outside the ${FRESH_DAYS}-day window at fetch`
  }
  const unknown = s.unknown === undefined ? [] : s.unknown
  if (!Array.isArray(unknown)) return 'unknown is not an array'
  for (const [i, u] of (unknown as unknown[]).entries()) {
    if (typeof u !== 'string' || !EXTERNAL_ID_SHAPE[s.sellerId].test(u)) return `unknown ${i}: ${JSON.stringify(u)} is not a ${prefix}… id of this source's shape`
    if (seen.has(u)) return `unknown ${i}: ${u} is also an item or listed twice`
    seen.add(u)
  }
  const judged = s.items.length + unknown.length
  if (unknown.length > 5 && unknown.length > MAX_UNKNOWN_SHARE * judged) return `${unknown.length} of ${judged} undetermined — over ${MAX_UNKNOWN_SHARE * 100}%, the crawl is not whole`
  return null
}

/**
 * The share-guard baseline from the counts of the last applied sets (newest last): the largest of the
 * last BASELINE_RUNS, so a run at 61% of the previous one cannot become next week's yardstick.
 */
export function baselineOf(counts: readonly number[]): number | null {
  const recent = counts.slice(-BASELINE_RUNS)
  return recent.length ? Math.max(...recent) : null
}

export interface ExpiryPlan {
  /** Listing ids to mark stale. */
  expire: string[]
  keep: number
  /** Active rows with no externalId — never expired (an import always has one), only reported. */
  noExternalId: number
  /** Non-null: do not apply. */
  refusal: string | null
}

/**
 * Which live rows leave. `baseline` is the item count of the last APPLIED set for this seller (null when
 * there has never been one). ⛔ Refuses a set that shrank below MIN_SHARE of the baseline, and a set that
 * would take EVERY live row of a source that is not tiny — the two shapes a blocked crawl produces —
 * unless `force` (an operator who has independent evidence, e.g. the one-off cleanup).
 */
export function planExpiry(input: {
  active: readonly { id: string; externalId: string | null }[]
  fresh: ReadonlySet<string>
  /** Looked at but undetermined — kept. */
  unknown?: ReadonlySet<string>
  baseline: number | null
  /** How many of the set's ids exist as rows of this seller in ANY status (null = not measured). */
  knownInDb?: number | null
  force?: boolean
  minShare?: number
}): ExpiryPlan {
  const { active, fresh, unknown = new Set<string>(), baseline, knownInDb = null, force = false, minShare = MIN_SHARE } = input
  const expire: string[] = []
  let keep = 0
  let noExternalId = 0
  for (const r of active) {
    if (!r.externalId) { noExternalId++; keep++; continue }
    if (fresh.has(r.externalId) || unknown.has(r.externalId)) keep++
    else expire.push(r.id)
  }
  let refusal: string | null = null
  if (!force) {
    const guarded = baseline !== null && baseline >= SHARE_FLOOR
    if (knownInDb !== null && fresh.size >= SHARE_FLOOR && knownInDb < MIN_KNOWN_SHARE * fresh.size) {
      refusal = `only ${knownInDb} of the set's ${fresh.size} ids exist as rows of this seller — the set and the database disagree on ids (run the import step first, or the id scheme changed)`
    } else if (guarded && fresh.size < minShare * baseline) {
      refusal = `the fresh set has ${fresh.size} items, under ${Math.round(minShare * 100)}% of the last applied ${baseline} — reads as a blocked or partial crawl`
    } else if (expire.length > 0 && expire.length === active.length && active.length >= SHARE_FLOOR) {
      refusal = `this would mark ALL ${active.length} live rows ${EXPIRED_STATUS} — pass --force only with independent evidence that none is fresh`
    } else if (!guarded && active.length >= SHARE_FLOOR && expire.length > NO_HISTORY_MAX_SHARE * active.length) {
      // No history to compare a short crawl against: a set that keeps 1 of 1,000 would otherwise pass.
      refusal = `no applied history for this seller and this would mark ${expire.length} of ${active.length} live rows ${EXPIRED_STATUS} — run with --force once, on independent evidence, to establish the baseline`
    }
  }
  return { expire, keep, noExternalId, refusal }
}
