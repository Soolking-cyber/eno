/**
 * THE DAILY 7-DAY SWEEP OF IMPORTED PROPERTY RENTALS — the pure half (no database, no clock of its own).
 *
 * Owner, 2026-10-13: "remove all rental properties that are 7 days older every 3 days it should check and
 * update up to 7 day old ones no older than 7 days". The property importers run every 3 days and create,
 * revive and re-date the ads their source shows posted or re-posted within FRESH_DAYS; this sweep runs EVERY
 * DAY (scripts/expire-rentals.ts --sweep, from scripts/apartments-weekly.sh) and takes down what aged past
 * FRESH_DAYS since: every `active`, ownerless, imported (`affiliateUrl` set) row of a rental import seller
 * (RENTAL_IMPORT_SELLERS) in a PLACE subcategory — apartment, house, room, office, or none (RENTAL_PLACES:
 * the rentals category minus vehicle hire) — whose postedAt is older than FRESH_DAYS, → EXPIRED_STATUS, the
 * status every property importer revives when its source shows the ad fresh again (REVIVABLE_STATUSES).
 *
 * ⚠️ DAILY, SO "7 DAYS" MEANS: a row leaves at the first sweep after it turns FRESH_DAYS old — live at most a day past
 * it. And the refresh is every 3 days: an ad its source re-posts between two refreshes keeps its old postedAt until
 * the next one, so the sweep can take it down a day or two before that refresh brings it back (revival) — the cadence
 * the owner chose ("every 3 days it should check"), not a fault.
 *
 * WHY postedAt IS THE AGE: every property importer keeps postedAt at the LATEST date its source showed for
 * the ad (create, revival, a newer re-post date) — Nhà Tốt list_time, Muaban created_at, Batdongsan's renewal
 * label (worst case), Honeycomb's sitemap lastmod, Rever's "Cập nhật". A row the source stopped re-dating ages
 * past the window and leaves; one the source re-posts is re-dated (or revived) by the next refresh.
 *
 * ⛔ UNATTENDED, SO ITS ONE REFUSAL IS WRITTEN DOWN HERE (sweepRefusal), PER GATE UNIT (planSweep), and nothing
 * else stops it. The sweep needs no `--expect` count: a day's departures are whatever crossed the line since
 * yesterday. A UNIT's rows (unitOf: a seller's, or for Muaban its apartments vs its other place rows) are held back —
 * the rest of the sweep still runs, and it exits SWEEP_REFUSED_EXIT so the job alerts — only when the sweep would take
 * MORE THAN SWEEP_MAX_SHARE of that unit's live rows at once (from SWEEP_MIN_LIVE of them) WHILE that unit's refresh
 * has not succeeded for over SWEEP_STALE_IMPORT_DAYS (or never). On a daily cadence a healthy source loses about a
 * seventh of its rows a day; nearly all of them in one go, with the refresh behind them dead for days, is a broken
 * pipeline or broken dates — emptying a storefront on that is a decision for a person (`--allow-mass-expiry`), not
 * for a timer. While a unit's refresh succeeds, every row its source still shows fresh was re-dated or revived by
 * it, so its rows go unguarded.
 * ⚠️ PER UNIT, NOT ONE NUMBER (2026-10-13 review): one refresh succeeding (Rever's cheap check, Muaban's houses) must
 * not vouch for rows another refresh keeps fresh (a Batdongsan scrape Cloudflare blocked for a week, Muaban's
 * apartment crawl).
 * ⚠️ IT DOES NOT SLOW A DRAIN: with a source dead, the daily sweep takes its rows as they age (a seventh a day) and
 * only the last slice trips the guard. That is the 7-day rule working; the dead source itself alerts daily (the job).
 */
import { FRESH_DAYS, SHARE_FLOOR } from './apartment-freshness'
import { RENTAL_IMPORT_SELLERS } from './import-sellers'

/** The age past which a live imported place row is expired — the 7-day rule's own window. */
export const SWEEP_DAYS = FRESH_DAYS
/** More than this share of a seller's live rows in ONE sweep is a mass expiry (held back while its imports are stale). */
export const SWEEP_MAX_SHARE = 0.95
/** Below this many live rows a share means nothing — the same floor as the fresh-set guards. */
export const SWEEP_MIN_LIVE = SHARE_FLOOR
/** No successful import for longer than this (a 3-day cadence plus a day) = that refresh is not running. */
export const SWEEP_STALE_IMPORT_DAYS = 4
/** The exit code of a sweep that held a seller back (the others' rows were still expired) — distinct from 1, a crash. */
export const SWEEP_REFUSED_EXIT = 3

const DAY_MS = 86_400_000
/** Clock skew tolerated between the machine that stamped an import and the one that sweeps. */
const SKEW_MS = 5 * 60_000

type RentalSellerId = (typeof RENTAL_IMPORT_SELLERS)[number]
/**
 * The 3-day job's gate units (scripts/apartments-weekly.sh SOURCES — one success stamp each, `last-success-<unit>`)
 * and the seller each refreshes. Muaban has two units (its apartments with their set; houses, rooms and offices).
 */
export const SOURCE_SELLERS: Readonly<Record<string, RentalSellerId>> = Object.freeze({
  nhatot: 'nhatot-import-seller-0001',
  muaban: 'muaban-net-import-seller-0001',
  'muaban-places': 'muaban-net-import-seller-0001',
  honeycomb: 'honeycomb-import-seller-0001',
  rever: 'cmub0wead0000zrq418bqq27m',
  batdongsan: 'bds-vn-import-seller-0001',
})

/**
 * One success stamp as the job writes it (scripts/apartments-gate.sh: "<epoch seconds> <ISO>") → epoch ms, or null
 * when it cannot be read — and null when it lies in the future (a clock that moved back): a time the guard would
 * misread is never trusted, and never an error that stops the sweep.
 */
export function parseStamp(text: string, now: number): number | null {
  const first = text.trim().split(/\s+/)[0] ?? ''
  if (!/^\d{9,11}$/.test(first)) return null
  const at = Number(first) * 1000
  return at > now + SKEW_MS ? null : at
}

/** Each unit's success stamp, from `last-success-<unit>` files (unit names not in SOURCE_SELLERS, and bad stamps, are left out). */
export function lastImportByUnit(stamps: readonly { unit: string; text: string }[], now: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of stamps) {
    const at = parseStamp(s.text, now)
    if (!(s.unit in SOURCE_SELLERS) || at === null) continue
    if (!out.has(s.unit) || at > out.get(s.unit)!) out.set(s.unit, at)
  }
  return out
}

/**
 * The gate unit whose refresh keeps a live row fresh — its seller's, and for Muaban its apartments' (`muaban`, the set's
 * crawl) or its other place rows' (`muaban-places`). null for a seller no unit refreshes (its rows are then guarded as
 * never imported).
 */
export function unitOf(sellerId: string, subcat: string | null): string | null {
  if (sellerId === SOURCE_SELLERS['muaban-places']) return subcat === 'apartment-rental' ? 'muaban' : 'muaban-places'
  return Object.keys(SOURCE_SELLERS).find((u) => SOURCE_SELLERS[u] === sellerId) ?? null
}

/**
 * ⛔ THE SWEEP'S ONE REFUSAL, for one seller's rows, or null. `live` = that seller's live rows in the sweep's scope,
 * `expire` = how many of them are older than SWEEP_DAYS, `lastImportAt` = its newest successful import (epoch ms;
 * null = none known), `allowMass` = an operator's `--allow-mass-expiry`.
 */
export function sweepRefusal(o: { live: number; expire: number; lastImportAt: number | null; now: number; allowMass: boolean }): string | null {
  if (!(Number.isInteger(o.live) && o.live >= 0 && Number.isInteger(o.expire) && o.expire >= 0 && o.expire <= o.live)) {
    throw new Error(`sweepRefusal: ${o.expire} of ${o.live} is not a count of live rows`)
  }
  if (o.allowMass || o.live < SWEEP_MIN_LIVE || o.expire <= SWEEP_MAX_SHARE * o.live) return null
  const ageDays = o.lastImportAt === null ? null : (o.now - o.lastImportAt) / DAY_MS
  if (ageDays !== null && ageDays <= SWEEP_STALE_IMPORT_DAYS) return null
  const since = ageDays === null ? 'no successful import is known' : `the last successful import was ${ageDays.toFixed(1)} days ago (${new Date(o.lastImportAt!).toISOString()})`
  return `this would expire ${o.expire} of its ${o.live} live rows (${((o.expire / o.live) * 100).toFixed(1)}%, over ${SWEEP_MAX_SHARE * 100}%) at once while ${since} — over ${SWEEP_STALE_IMPORT_DAYS} days: that reads as a broken refresh or broken postedAt dates, not the market. Held back. Fix the refresh, or re-run with --allow-mass-expiry once the dates are checked`
}

/** One guarded group of the sweep: a gate unit's rows (or, for a seller no unit refreshes, the seller's). */
export type SweepGroup = { unit: string | null; sellerId: string; live: number; expire: number; lastImportAt: number | null; refusal: string | null }

/**
 * THE SWEEP, PLANNED from ONE read of the live rows in scope (each marked `old` when its postedAt is past SWEEP_DAYS
 * — one query, so a group's `expire` can never exceed its `live` however a refresh moves rows meanwhile): per gate
 * unit (unitOf) its counts and refusal, and the ids to expire — the old rows of every group not held back.
 */
export function planSweep(o: {
  rows: readonly { id: string; sellerId: string; subcat: string | null; old: boolean }[]
  lastImport: ReadonlyMap<string, number>
  now: number
  allowMass: boolean
}): { groups: SweepGroup[]; expire: string[] } {
  const by = new Map<string, { unit: string | null; sellerId: string; live: number; old: string[] }>()
  for (const r of o.rows) {
    const unit = unitOf(r.sellerId, r.subcat)
    const key = unit ?? `seller:${r.sellerId}`
    const g = by.get(key) ?? { unit, sellerId: r.sellerId, live: 0, old: [] }
    g.live++
    if (r.old) g.old.push(r.id)
    by.set(key, g)
  }
  const groups: SweepGroup[] = []
  const expire: string[] = []
  for (const [, g] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lastImportAt = g.unit === null ? null : o.lastImport.get(g.unit) ?? null
    const refusal = sweepRefusal({ live: g.live, expire: g.old.length, lastImportAt, now: o.now, allowMass: o.allowMass })
    groups.push({ unit: g.unit, sellerId: g.sellerId, live: g.live, expire: g.old.length, lastImportAt, refusal })
    if (!refusal) expire.push(...g.old)
  }
  return { groups, expire }
}
