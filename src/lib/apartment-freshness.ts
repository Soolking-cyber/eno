/**
 * THE FRESHNESS RULE FOR IMPORTED APARTMENT RENTALS — the pure half (no DB, no network).
 *
 * Owner, 2026-10-01: "we need only 7 days old apartments fetched weekly, remove else, only new active
 * apartments" → asked, and chose: an imported apartment stays live only while its SOURCE shows it posted
 * OR RE-POSTED within the source's window ("the date each site shows"); apartments only; refreshed weekly.
 * The window is 7 days (FRESH_DAYS) for every source except Honeycomb, which has 30 since 2026-10-02
 * (WINDOW_DAYS_BY_SELLER — the ONE table every step reads; windowDaysFor).
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
 *   · Honeycomb  — the sitemap `lastmod` (the agency re-touching the listing). 30-day window.
 *   · Rever      — the detail page's "Cập nhật" date, with its own "Sẵn sàng giao dịch" badge.
 *
 * ⛔ THE SET IS THE ONLY EVIDENCE AN EXPIRY ACTS ON, SO IT MUST PROVE IT IS WHOLE. A crawl that was
 * blocked half way produces a short set, and "not in the set" would then hide live flats. Hence: the set
 * says `complete: true` with the evidence in `coverage`, it is refused when older than a day, and
 * planExpiry refuses a set that shrank below MIN_SHARE of the last applied one — or, for a ROLLING seller
 * (a window wider than the weekly cadence: Honeycomb), one missing over 1 − MIN_SHARE of the live rows last
 * seen dated inside the window (isRollingWindow — a rolling set shrinks by design, so its size proves nothing),
 * MIN_SHARE or more of them when they are fewer than SHARE_FLOOR (from CARRY_MIN_DATED up), or one that would
 * expire EVERY live row of a source that is not tiny while any of them is still dated inside the window.
 * ⛔ THE SET RECORDS ITS WINDOW (`windowDays`) AND IS REFUSED UNLESS THAT IS THE SELLER'S WINDOW HERE: a
 * 7-day set applied to Honeycomb would expire every 8–30-day-old flat; a 30-day set applied to a 7-day
 * source would keep flats the rule takes down.
 */
import { RENTAL_IMPORT_SELLERS } from './import-sellers'

/** The window of every source not in WINDOW_DAYS_BY_SELLER. */
export const FRESH_DAYS = 7
type RentalSellerId = (typeof RENTAL_IMPORT_SELLERS)[number]
/**
 * ⛔ THE WINDOW PER SOURCE — THE ONE TABLE. A seller not listed has FRESH_DAYS. Read through windowDaysFor
 * by: freshSetProblem (a set whose recorded window is not this one is refused, and so is an item outside
 * it), the Honeycomb stage (its --fresh-out guard, the detail read, the bulk re-save guard, the fresh set and
 * the apply's revival — src/lib/honeycomb-freshness.ts), and the expiry's backstop (backstopDaysFor).
 * ⚠️ A set records the window its STEP judged by (makeFreshSet's `windowDays`, FRESH_DAYS unless the step
 * passes its own), never a copy of this table: the other four sources' steps judge by FRESH_DAYS directly
 * (nhatot-fresh, muaban-net-map, rever-liveness, batdongsan-crawl), so listing one of them here without
 * changing its step makes its sets fail freshSetProblem — loudly — instead of passing a 7-day set off as a
 * wider one and expiring the rows the table says are still fresh.
 * ⚠️ A window wider than FRESH_DAYS also makes the seller ROLLING (isRollingWindow): its expiry is guarded
 * by carry-over, which reads each live row's postedAt as the source date its importer last saw — so that
 * seller's importer must keep postedAt AT the source date (create, revival, a newer date). Honeycomb's does
 * (honeycomb-freshness.ts datePlan; the create path's postedAt = the lastmod).
 *   · Honeycomb 30 (2026-10-02): an agency that re-touches a listing every few weeks, not weekly — its 7-day
 *     set held 0–7 ads, so the rule took nearly every Honeycomb flat down.
 */
export const WINDOW_DAYS_BY_SELLER: Readonly<Partial<Record<RentalSellerId, number>>> = Object.freeze({
  'honeycomb-import-seller-0001': 30,
})
/** The freshness window, in days, of a rental import seller (FRESH_DAYS unless WINDOW_DAYS_BY_SELLER says otherwise). */
export function windowDaysFor(sellerId: string): number {
  return (WINDOW_DAYS_BY_SELLER as Readonly<Record<string, number | undefined>>)[sellerId] ?? FRESH_DAYS
}
/**
 * ⛔ A ROLLING WINDOW: one WIDER than FRESH_DAYS, the weekly cadence's window. A cadence-window seller's
 * weekly sets are disjoint weeks of a steady market, so a set far smaller than the recent ones reads as a
 * blocked crawl — the COUNT guards (MIN_SHARE of the baseline, expire-ALL, no-history). A rolling seller's
 * sets OVERLAP: each is a 30-day sum over a source that re-touches in bursts, and it SHRINKS BY DESIGN as a
 * burst ages out. Honeycomb's real lastmods (staged 2026-10-02: 31 dated 09-08…09-18, nothing since) give
 * 31 → 6 → 0 at the next three weekly fetches with no crawl at fault; the count guards refused week 2 and
 * every week after (the baseline stays 31, since a refusal records none), the FAILED alert fired weekly, and
 * only the window + 7 backstop took the flats down, at 38–41 days. So a rolling seller is guarded by
 * CARRY-OVER instead (planExpiry `rollingFrom`): every live row whose last-seen source date is still inside
 * the window must be in the set, whatever the set's size — judged as a share from SHARE_FLOOR such rows, as a
 * majority from CARRY_MIN_DATED, and, at any count, never by emptying a source that is not tiny.
 */
export const isRollingWindow = (sellerId: string): boolean => windowDaysFor(sellerId) > FRESH_DAYS
/**
 * Where a rolling seller's window opens for a set fetched at `fetchedAt` (ms since epoch) — planExpiry's
 * `rollingFrom` — or null for a cadence-window seller (the count guards apply).
 */
export function rollingWindowFrom(sellerId: string, fetchedAt: string): number | null {
  if (!isRollingWindow(sellerId)) return null
  const t = Date.parse(fetchedAt)
  if (!Number.isFinite(t)) throw new Error(`rollingWindowFrom: fetchedAt ${JSON.stringify(fetchedAt)} is not a date`)
  return t - windowDaysFor(sellerId) * DAY_MS
}
/**
 * The backstop's slack past a source's window: the weekly job has expired a 7-day source's rows at 14 days
 * (7 + 7) when its refresh stops — the same slack for every source, so Honeycomb's is 30 + 7 = 37.
 */
export const BACKSTOP_SLACK_DAYS = 7
/** The age (postedAt, days) past which the weekly backstop expires a seller's live rows when its refresh stopped. */
export const backstopDaysFor = (sellerId: string): number => windowDaysFor(sellerId) + BACKSTOP_SLACK_DAYS
/** A weekly refresh plus a day of slack: past this, the source has missed a run. The job's cadence, not the window. */
export const BACKSTOP_MISSED_DAYS = 8
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
/**
 * ⛔ A ROLLING seller's carry-over guard BELOW SHARE_FLOOR (review of 2026-10-02): from this many live rows
 * last seen dated inside the window, MIN_SHARE or more of them missing from one set is refused.
 * Before it, under SHARE_FLOOR nothing was judged at all: 24 live Honeycomb rows, 6 dated inside the window,
 * every one of those pages answering 404 (a WordPress rewrite fault — the sitemap still listed them) gave a
 * set of 0 items and 0 undetermined, and the plan expired all 24, the 6 fresh flats included.
 *   · WHY 3: one or two rows missing is one or two flats let in a week — a share of them is noise. Three is
 *     the fewest at which "most of them vanished in the same read" is a pattern rather than a coincidence.
 *   · WHY MIN_SHARE (60%) MISSING, NOT "ALL": a fault that leaves one page answering (a page cache holding a
 *     few 200s — the detail pages are not cache-busted) would pass "all", and "all" leaves a cliff at the
 *     floor: 18 of 19 missing would be applied while 9 of 20 is refused. At ≥ 60% missing, the threshold
 *     joins the share rule above the floor (over 40% missing) without a jump — 2 of 3, 3 of 4 or 5, 12 of 19
 *     — and stays the more lenient of the two, as fewer rows are weaker evidence.
 *   · THE COST of a false refusal: it repeats each week until the missing rows age out of the window (their
 *     postedAt never moves), the backstop meanwhile taking the aged-out rows at the window + 7 days, and
 *     the weekly alert fires — an operator with independent evidence passes --force.
 */
export const CARRY_MIN_DATED = 3
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

/**
 * `windowDays` is the window the calling step JUDGED its items by (FRESH_DAYS unless it says otherwise) —
 * freshSetProblem then refuses the set unless that is the seller's window (windowDaysFor).
 */
export function makeFreshSet(sellerId: string, fetchedAt: Date, coverage: string, items: FreshItem[], unknown: string[] = [], windowDays: number = FRESH_DAYS): FreshSet {
  return { kind: FRESH_SET_KIND, v: FRESH_SET_VERSION, sellerId, fetchedAt: fetchedAt.toISOString(), windowDays, complete: true, coverage, items, unknown }
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
  // ⛔ Against the TABLE, never the set's own value: a 7-day set is no evidence for a 30-day seller, nor
  // the other way round.
  const windowDays = windowDaysFor(s.sellerId)
  if (s.windowDays !== windowDays) return `windowDays ${JSON.stringify(s.windowDays)}, expected ${windowDays} for ${s.sellerId} — a set judged by another window cannot drive this seller's expiry`
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
    if (!isInWindow(d, fetched, windowDays)) return `item ${i}: ${externalId} sourceDate ${JSON.stringify(sourceDate)} is outside the ${windowDays}-day window at fetch`
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
  /**
   * A rolling seller only (`rollingFrom` given): the live rows whose postedAt — the source date their importer
   * last saw — is still inside the window at this fetch, and how many of those this plan would expire.
   */
  carry: { dated: number; missing: number } | null
  /** Non-null: do not apply. */
  refusal: string | null
}

/**
 * Which live rows leave, and whether the set may be trusted to say so. Unless `force` (an operator who has
 * independent evidence, e.g. the one-off cleanup), it refuses:
 *   · always — a set whose ids mostly do not exist as rows of the seller (an id-space mismatch);
 *   · a CADENCE-window seller (no `rollingFrom`) — the count guards, the two shapes a blocked crawl produces:
 *     a set that shrank below MIN_SHARE of `baseline` (the largest of the last applied sets' counts, null
 *     when there has never been one), a set that would take EVERY live row of a source that is not tiny,
 *     and, with no baseline, one that would take over NO_HISTORY_MAX_SHARE of it;
 *   · a ROLLING seller (`rollingFrom` = rollingWindowFrom, the window's start at this set's fetch) — the
 *     CARRY-OVER guard instead, never the count guards (isRollingWindow says why): a live row whose postedAt
 *     is at or after `rollingFrom` was last seen dated inside this window, and a source date never moves
 *     back, so a whole read lists it again — it can drop out only because the source took it down. Under
 *     MIN_SHARE of those rows in the set (or undetermined) reads as a blocked or partial crawl; rows dated
 *     before `rollingFrom` aged out, and taking them is the rule working, however many there are.
 *     SHARE_FLOOR applies to that count as it does to the baseline — and ⛔ BELOW it, from CARRY_MIN_DATED
 *     such rows, MIN_SHARE or more of them missing is refused (a source fault: every page answering 404, a
 *     changed id scheme), so a small window is never left unguarded. ⛔ And the expire-ALL guard stands for
 *     a rolling seller too, with one exemption: a plan that takes EVERY live row of a source that is not
 *     tiny is refused while any of them is still dated inside the window — when none is, every row aged
 *     out and emptying the source is the rule working (Honeycomb's real lastmods do exactly that in their
 *     third week).
 */
export function planExpiry(input: {
  /** postedAt is read only for a rolling seller (`rollingFrom`), where every row with an externalId must carry it. */
  active: readonly { id: string; externalId: string | null; postedAt?: Date }[]
  fresh: ReadonlySet<string>
  /** Looked at but undetermined — kept. */
  unknown?: ReadonlySet<string>
  baseline: number | null
  /** How many of the set's ids exist as rows of this seller in ANY status (null = not measured). */
  knownInDb?: number | null
  force?: boolean
  minShare?: number
  /** A rolling seller: its window's start at this set's fetch (ms) — rollingWindowFrom. null/absent: a cadence-window seller. */
  rollingFrom?: number | null
}): ExpiryPlan {
  const { active, fresh, unknown = new Set<string>(), baseline, knownInDb = null, force = false, minShare = MIN_SHARE, rollingFrom = null } = input
  if (rollingFrom !== null && !Number.isFinite(rollingFrom)) throw new Error(`planExpiry: rollingFrom ${rollingFrom} is not a time`)
  const expire: string[] = []
  let keep = 0
  let noExternalId = 0
  const carry = rollingFrom === null ? null : { dated: 0, missing: 0 }
  for (const r of active) {
    if (!r.externalId) { noExternalId++; keep++; continue }
    const listed = fresh.has(r.externalId) || unknown.has(r.externalId)
    if (listed) keep++
    else expire.push(r.id)
    if (carry) {
      const t = r.postedAt instanceof Date ? r.postedAt.getTime() : NaN
      // ⛔ Never guessed: a row the guard cannot date would silently fall out of the count it protects.
      if (!Number.isFinite(t)) throw new Error(`planExpiry: live row ${r.id} has no postedAt — the carry-over guard needs every row's`)
      if (t >= rollingFrom!) { carry.dated++; if (!listed) carry.missing++ }
    }
  }
  let refusal: string | null = null
  if (!force) {
    const guarded = baseline !== null && baseline >= SHARE_FLOOR
    if (knownInDb !== null && fresh.size >= SHARE_FLOOR && knownInDb < MIN_KNOWN_SHARE * fresh.size) {
      refusal = `only ${knownInDb} of the set's ${fresh.size} ids exist as rows of this seller — the set and the database disagree on ids (run the import step first, or the id scheme changed)`
    } else if (carry) {
      const dated = `${carry.missing} of the ${carry.dated} live rows last seen dated inside the window (postedAt ≥ ${new Date(rollingFrom!).toISOString()}) are missing from the set`
      if (carry.dated >= SHARE_FLOOR) {
        if (carry.dated - carry.missing < minShare * carry.dated) {
          refusal = `${dated} — under ${Math.round(minShare * 100)}% of them listed again reads as a blocked or partial crawl`
        }
      } else if (carry.dated >= CARRY_MIN_DATED && carry.missing >= minShare * carry.dated) {
        refusal = `${dated} — ${Math.round(minShare * 100)}% or more of them gone in one read reads as a source fault (pages answering 404, a changed id scheme), not the market; pass --force only with independent evidence that they are down at the source`
      }
      if (!refusal && carry.dated > 0 && expire.length > 0 && expire.length === active.length && active.length >= SHARE_FLOOR) {
        refusal = `this would mark ALL ${active.length} live rows ${EXPIRED_STATUS} while ${carry.dated} of them were last seen dated inside the window (postedAt ≥ ${new Date(rollingFrom!).toISOString()}) — pass --force only with independent evidence that none is fresh`
      }
    } else if (guarded && fresh.size < minShare * baseline) {
      refusal = `the fresh set has ${fresh.size} items, under ${Math.round(minShare * 100)}% of the last applied ${baseline} — reads as a blocked or partial crawl`
    } else if (expire.length > 0 && expire.length === active.length && active.length >= SHARE_FLOOR) {
      refusal = `this would mark ALL ${active.length} live rows ${EXPIRED_STATUS} — pass --force only with independent evidence that none is fresh`
    } else if (!guarded && active.length >= SHARE_FLOOR && expire.length > NO_HISTORY_MAX_SHARE * active.length) {
      // No history to compare a short crawl against: a set that keeps 1 of 1,000 would otherwise pass.
      refusal = `no applied history for this seller and this would mark ${expire.length} of ${active.length} live rows ${EXPIRED_STATUS} — run with --force once, on independent evidence, to establish the baseline`
    }
  }
  return { expire, keep, noExternalId, carry, refusal }
}

/**
 * Why `days` cannot be this seller's --backstop-days, or null: a whole number of days past the seller's
 * window (windowDaysFor + at least one) — a backstop inside the window would expire rows the rule keeps.
 */
export function backstopDaysProblem(sellerId: string, days: number | null): string | null {
  const min = windowDaysFor(sellerId) + 1
  if (days === null || !Number.isInteger(days) || days < min) {
    return `--backstop-days for ${sellerId} must be an integer ≥ ${min} (its ${windowDaysFor(sellerId)}-day window plus at least a day)`
  }
  return null
}

/**
 * ⛔ THE BACKSTOP — ONLY FOR A SOURCE THAT STOPPED REFRESHING, AND ROW BY ROW. Acts only when the last
 * APPLIED fresh set (`lastFreshAt`, null = never) is more than BACKSTOP_MISSED_DAYS old, and then expires the
 * live rows whose postedAt is older than `days` (backstopDaysFor: the seller's window + BACKSTOP_SLACK_DAYS).
 */
export function planBackstop(o: {
  active: readonly { id: string; postedAt: Date }[]
  lastFreshAt: string | null
  now: number
  days: number
}): { act: false; missedDays: number } | { act: true; missedDays: number; cutoff: Date; expire: string[] } {
  const missedDays = o.lastFreshAt ? (o.now - Date.parse(o.lastFreshAt)) / DAY_MS : Infinity
  if (missedDays <= BACKSTOP_MISSED_DAYS) return { act: false, missedDays }
  const cutoff = new Date(o.now - o.days * DAY_MS)
  return { act: true, missedDays, cutoff, expire: o.active.filter((r) => r.postedAt < cutoff).map((r) => r.id) }
}
