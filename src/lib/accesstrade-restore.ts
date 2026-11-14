import { decodeEntities } from './feed-text'
import { restorableWhere } from './journaled-hide'
import { LICENCE_HELD_NOTE, licenceClearedSql } from './licence-stamp'
import { isUsedTitle } from './used-signal'

/**
 * ── BRINGING BACK THE ACCESSTRADE USED SHELVES (owner, 2026-11-14: "import all 2nd hand one with comission") ──
 *
 * The 2026-10-13 removal ("remove all accesstrade products") hid CellphoneS' used shelf and Điện Thoại Vui through
 * the journaled hide (scripts/hide-accesstrade.ts). Replaying that whole journal would republish a month-old
 * catalogue: units sold since, at the price they had in October — and the nightly job could not retire them,
 * because it refuses to retire more than a tenth of a shop's live rows in one night (api/cron/affiliate-prices).
 * So scripts/restore-accesstrade-used.ts restores a SUBSET, chosen here:
 *   · the row is still exactly what the hide left (journaledRestore's own condition, re-checked in the write);
 *   · its SKU is in TODAY's datafeed, with a usable price and a repairable affiliate link;
 *   · the shop still calls it second-hand (usedForShelf on today's feed name and page — the importer's rule,
 *     on the importer's input) and our row is stored as condition 'used';
 *   · the restock screen does not refuse its text (src/lib/restock-screen.ts, applied by the script).
 * ⛔ AND IT COMES BACK AT TODAY'S PRICE, IN THE SAME STATEMENT THAT RESTORES IT (plan review, codex + opus, 2026-11-14):
 * a restore that left the October price for a later refresh published wrong prices for as long as that took, and the
 * PDP cache kept them longer still.
 * ⚠️ A journaled `sold` row goes back to `sold`, not straight to active: the nightly restock (screened) flips it once
 * the timer runs. Rows not picked stay hidden and keep their 10-13 rollback.
 */

/**
 * ⛔ "USED" FOR THESE SHELVES = the shop's own used cue (isUsedTitle, the repo's one rule, unchanged) AND no trade-in
 * wording — "thu cũ" / "đổi cũ" with any separator ("Thu cũ đổi mới", "Thu cũ, đổi mới", "thu cũ trợ giá"), which
 * shops print on NEW stock (commit gate, opus + codex rounds 7–16). A shelf rule, not a change to used-signal.ts:
 * it can only leave a row OUT (the safe direction), and every path of these two shelves uses it — the importer, the
 * restore and the nightly walk. Measured 2026-11-14: no row of either feed carries such wording.
 */
const TRADE_IN_WORDING = /(?<![\p{L}\p{N}])(?:thu|đổi)[\s\p{P}]*cũ(?![\p{L}\p{N}])/iu
export function usedForShelf(name: string, url: string): boolean {
  const n = decodeEntities(name).normalize('NFC')
  return isUsedTitle(n, null, url) && !TRADE_IN_WORDING.test(n)
}

export type RestoreJournalRow = { id: string; sellerId?: string | null; priorStatus: string; updatedAt?: string }

/** A journaled row as it stands now, read by id. `updatedAt` is `"updatedAt"::text`, the journal's own format. */
export type HeldRow = { id: string; sellerId: string; externalId: string | null; status: string; updatedAt: string; condition: string | null }

/** Today's datafeed entry for a SKU (fetchFeedPrices). */
export type FeedItem = { price: number; affiliateUrl: string | null; name: string; url: string }

export type RestorePick = { id: string; sellerId: string; prior: string; upd: string; price: number; affiliateUrl: string }

export const SKIP_REASONS = ['not_found', 'not_this_shop', 'unstamped', 'changed_since_hide', 'not_used_in_db', 'no_external_id', 'not_in_feed', 'not_used', 'no_link'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/**
 * Which journaled rows may come back, and why each other one may not. `feeds` is keyed by sellerId: a journal row
 * of any other storefront is never picked. Pure — the script screens the picks and writes them.
 */
export function pickRestores(
  journal: readonly RestoreJournalRow[],
  held: ReadonlyMap<string, HeldRow>,
  feeds: ReadonlyMap<string, ReadonlyMap<string, FeedItem>>,
): { picks: RestorePick[]; skipped: Record<SkipReason, number> } {
  const skipped = Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<SkipReason, number>
  const picks: RestorePick[] = []
  for (const j of journal) {
    const row = held.get(j.id)
    if (!row) { skipped.not_found++; continue }
    const feed = feeds.get(row.sellerId)
    if (!feed || (j.sellerId && j.sellerId !== row.sellerId)) { skipped.not_this_shop++; continue }
    if (!j.updatedAt) { skipped.unstamped++; continue }
    // The cheap pre-check; the write re-states it (restorableWhere), so a row touched in between is still refused.
    if (row.status !== 'hidden' || row.updatedAt !== j.updatedAt) { skipped.changed_since_hide++; continue }
    // ⛔ This restores a USED shelf: a row stored as anything but 'used' is not brought back by it (opus, diff review).
    if (row.condition !== 'used') { skipped.not_used_in_db++; continue }
    if (!row.externalId) { skipped.no_external_id++; continue }
    const item = feed.get(row.externalId)
    // fetchFeedPrices drops a row with no usable price, so "not in the map" also covers a zero or missing price.
    if (!item) { skipped.not_in_feed++; continue }
    if (!usedForShelf(item.name, item.url)) { skipped.not_used++; continue }
    if (!item.affiliateUrl) { skipped.no_link++; continue }
    picks.push({ id: j.id, sellerId: row.sellerId, prior: j.priorStatus, upd: j.updatedAt, price: item.price, affiliateUrl: item.affiliateUrl })
  }
  return { picks, skipped }
}

/**
 * The restore: the journal's own condition (still hidden, untouched since, no compliance decision since the hide,
 * still an ownerless storefront) AND today's price and link, one statement per chunk.
 * $1 ids · $2 prior statuses · $3 journaled updatedAt · $4 the hide journal's createdAt · $5 prices · $6 links.
 * ⚠️ `previousPrice` / `priceDropAt` are NOT written, for the reason applyPriceChanges gives: a merchant's shelf price
 * is not a seller's drop, and those columns fire saved-search alert mail.
 * ⚠️ `updatedAt` in UTC explicitly — the column is a timestamp without time zone that Prisma fills in UTC, and a bare
 * now() would take the session's zone (opus, diff review).
 */
export const RESTORE_PRICED_SQL =
  // ⛔ A publish drops the licence hold's mark, as every publish of an existing row does (CLAUDE.md; opus, gate round 6) —
  // only the mark: verificationNotes carries nothing else a restore may wipe.
  `UPDATE "Listing" l SET status = j.prior, price = j.price, "affiliateUrl" = j.url, "updatedAt" = (now() AT TIME ZONE 'UTC'), ` +
  `"verificationNotes" = NULLIF(l."verificationNotes", '${LICENCE_HELD_NOTE}') ` +
  `FROM unnest($1::text[], $2::text[], $3::text[], $5::double precision[], $6::text[]) AS j(id, prior, upd, price, url) ` +
  // ⛔ AND the licence check's guard, as every publish of an existing row (CLAUDE.md, licence check; commit gate, opus
  // 2026-11-14): the parameterised status is invisible to compliance/public-state-writes.test.ts, so it is spelled here.
  `WHERE ${restorableWhere('$4')} AND ${licenceClearedSql('l.')} RETURNING l.id, l.status, l."updatedAt"::text AS "updatedAt"`

/**
 * ⛔ THE USED SHELF STAYS USED (commit gate, codex 2026-11-14). The nightly job reprices and restocks by SKU, so a SKU the
 * shop now sells as NEW would keep our 'used' label with the new product's price and link. For a used-only campaign
 * (retired-imports.ts) this judges every feed row by the importer's own rule and hands back the SKUs it refuses; the
 * route takes their rows out of the reconcile and moves the active ones to `sold` (reversible: see there).
 *   · a priced row it refuses leaves `prices` (never repriced or restocked as used);
 *   · a row with NO name is no evidence either way: it leaves `prices` too and is NOT handed back, so its listing is left
 *     exactly as it is — no new price, no restock, no retire (codex, gate round 4: kept, it could be restocked as used);
 *   · `unpriced` — rows the walk dropped for an unusable price — are judged by name as well (codex, gate round 4).
 * Mutates `prices`.
 */
export function keepUsedRows(prices: Map<string, FeedItem>, unpriced: ReadonlyMap<string, { name: string; url: string }> = new Map()): Set<string> {
  const notUsed = new Set<string>()
  const refuses = (item: { name: string; url: string }) => !usedForShelf(item.name, item.url)
  for (const [sku, item] of prices) {
    if (!item.name.trim()) { prices.delete(sku); continue }
    if (refuses(item)) { prices.delete(sku); notUsed.add(sku) }
  }
  for (const [sku, item] of unpriced) if (item.name.trim() && refuses(item)) notUsed.add(sku)
  return notUsed
}

/**
 * The way back for this restore AND for the used-only import's created rows: hide each row only while it is
 * still exactly what that run left (status and `"updatedAt"::text`), in an ownerless storefront. Like the 10-13
 * hide it leaves `updatedAt` alone, and like every takedown that files no report it drops the licence hold's mark
 * (CLAUDE.md; opus, gate round 20). $1 ids · $2 statuses · $3 updatedAt.
 */
const UNDO_WHERE =
  `l.id = j.id AND l.status = j.st AND l."updatedAt"::text = j.upd ` +
  `AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL)`
export const UNDO_SQL =
  `UPDATE "Listing" l SET status = 'hidden', "verificationNotes" = NULLIF(l."verificationNotes", '${LICENCE_HELD_NOTE}') ` +
  `FROM unnest($1::text[], $2::text[], $3::text[]) AS j(id, st, upd) WHERE ${UNDO_WHERE} RETURNING l.id`
/** The dry run's count — the same condition as the write, so the preview cannot promise more than --apply hides. */
export const UNDO_COUNT_SQL =
  `SELECT count(*)::int AS n FROM "Listing" l, unnest($1::text[], $2::text[], $3::text[]) AS j(id, st, upd) WHERE ${UNDO_WHERE}`

/**
 * `--undo --hide <id,…>` (codex, gate rounds 7 + 18): a row a crashed run may have left WITHOUT a stamp, hidden only
 * by the id a human names after reading the list — no seller, SKU or time window proves which run made it. Still only
 * a live row (active or sold — never a `removed` tombstone, opus round 8), in an ownerless storefront. Like UNDO_SQL it
 * leaves updatedAt alone. $1 ids.
 */
export const PENDING_UNDO_SQL =
  `UPDATE "Listing" l SET status = 'hidden', "verificationNotes" = NULLIF(l."verificationNotes", '${LICENCE_HELD_NOTE}') ` +
  `WHERE l.id = ANY($1::text[]) AND l.status IN ('active', 'sold') ` +
  `AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL) RETURNING l.id`

/** The journals --undo accepts: this script's own, and import-accesstrade.ts' created ids. */
export const UNDOABLE_KINDS = ['restore-accesstrade-used', 'import-accesstrade-created'] as const
/**
 * `rows`: what the run wrote, each with the status and `"updatedAt"::text` it left — read at the write (RETURNING, or the
 * created row read straight after its create), never re-read later, so a human's edit since is never adopted as ours.
 * `pending`: ids a write was about to touch when the journal was last saved — written BEFORE the write, so a crash between
 * the commit and the stamp still leaves the ids on disk. `pendingExternalIds` (+ `sellerId`): the importer's equivalent —
 * the SKUs it was about to create, since the database assigns the id. --undo never hides a pending row; it lists it.
 */
export type UndoJournal = {
  kind: (typeof UNDOABLE_KINDS)[number]; createdAt: string; rows: { id: string; status: string; updatedAt: string }[]
  pending?: string[]; pendingExternalIds?: string[]; sellerId?: string | null
  /** When the journal was last written — printed beside each pending candidate, for the person choosing --hide ids. */
  savedAt?: string
}

export function isUndoJournal(j: unknown): j is UndoJournal {
  const o = j as Partial<UndoJournal> | null
  return !!o && (UNDOABLE_KINDS as readonly string[]).includes(String(o.kind)) && typeof o.createdAt === 'string' && Array.isArray(o.rows)
    && o.rows.every((r) => r && typeof r.id === 'string' && typeof r.status === 'string' && typeof r.updatedAt === 'string' && r.updatedAt.length > 0)
    && (o.pending === undefined || (Array.isArray(o.pending) && o.pending.every((id) => typeof id === 'string')))
    && (o.savedAt === undefined || typeof o.savedAt === 'string')
    && (o.pendingExternalIds === undefined || (Array.isArray(o.pendingExternalIds) && o.pendingExternalIds.every((id) => typeof id === 'string')
      && (o.pendingExternalIds.length === 0 || typeof o.sellerId === 'string')))
}
