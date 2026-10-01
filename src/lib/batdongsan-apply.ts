/**
 * The DATED writes of scripts/import-batdongsan-rentals.ts — a revival ('expired'/'stale' → active, fresh
 * at the source again) and a re-post (postedAt moves forward to a newer source date) — sequenced so that a
 * crash, a failed tombstone or a later human decision can never leave a row worse than the journal says.
 * Pure of the database: the two writes themselves are passed in (they stay in the script, where the
 * public-state audit counts them).
 *
 *   1. the PLANNED change is journaled (fsync) before its write;
 *   2. only a write that MOVED the row (count 1) gets a rollback line — guarded on the exact state that
 *      write created (status 'active' and the new postedAt for a revival; the new postedAt and not
 *      'removed' for a re-post), so it can never undo a later moderator's 'removed'/'hidden', and carrying
 *      its own ISR tombstone so the page follows the rollback;
 *   3. a revived page is tombstoned AS IT LANDS (it was a cached 404 for up to 30 days of ISR), and every
 *      revived id a throw or a failed tombstone left owed is tried again before returning OR rethrowing.
 *      What is STILL owed reaches the caller either way — in the outcome, or ⛔ ON THE ERROR a throw
 *      propagates (owedTombstonesOf) — and the caller writes it to a .sql it can be repaired from.
 *
 * A RE-POST is a source date at least a day newer than the stored postedAt (isBdsRepost): the date is the
 * label's worst case, which shifts by hours with the read time, so a same-week re-run must not re-date
 * (and re-rank, and journal) every row it already dated.
 */
import { REVIVABLE_STATUSES } from './apartment-freshness'
import { pdpTombstoneTags } from './job-listing'

export interface BdsDatedChange {
  id: string
  externalId: string
  sellerId: string
  action: 'revive' | 'repost'
  oldStatus: string
  oldPostedAt: Date
  oldRankScore: number
  newPostedAt: Date
  newRankScore: number
}

/** A listing or seller id this script could have read from the database — anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const sqlLit = (x: string) => `'${x.replace(/'/g, "''")}'`
const ts = (d: Date) => {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) throw new Error(`refusing a rollback line with date ${String(d)}`)
  return sqlLit(d.toISOString())
}
/** float8 accepts 'NaN'/'Infinity' as text, and a quoted literal never meets JS exponent formatting halfway. */
const f8 = (n: number) => `${sqlLit(String(n))}::double precision`

/** The per-page ISR tombstone as SQL — the same tags and upsert as src/lib/pdp-tombstone.ts. */
export function bdsTombstoneSql(ids: readonly string[]): string {
  if (!ids.length) return ''
  for (const id of ids) if (!SAFE_ID.test(id)) throw new Error(`refusing a tombstone line for id ${JSON.stringify(id)}`)
  const tags = ids.flatMap(pdpTombstoneTags).map(sqlLit).join(',')
  return `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY[${tags}]) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`
}

/**
 * The SQL that undoes ONE dated write, written only after that write moved the row. ⛔ GUARDED ON THE STATE
 * THE WRITE CREATED: the row still holds the postedAt this run wrote and, for a revival, is still 'active'
 * (a re-post: is not 'removed') — a row a moderator removed or hid since is left alone. Then its own ISR
 * tombstone. Throws on a value that could not have come from the database rather than writing it into SQL.
 */
export function bdsRollbackSql(c: BdsDatedChange): string {
  if (!SAFE_ID.test(c.id)) throw new Error(`refusing a rollback line for id ${JSON.stringify(c.id)}`)
  if (!SAFE_ID.test(c.sellerId)) throw new Error(`refusing a rollback line for seller ${JSON.stringify(c.sellerId)}`)
  const sets = [`"postedAt"=${ts(c.oldPostedAt)}`, `"rankScore"=${f8(c.oldRankScore)}`]
  const where = [`id=${sqlLit(c.id)}`, `"sellerId"=${sqlLit(c.sellerId)}`, `"postedAt"=${ts(c.newPostedAt)}`]
  if (c.action === 'revive') {
    if (!(REVIVABLE_STATUSES as readonly string[]).includes(c.oldStatus)) throw new Error(`refusing a rollback line to status ${JSON.stringify(c.oldStatus)}`)
    sets.unshift(`status=${sqlLit(c.oldStatus)}`)
    where.push(`status='active'`)
  } else {
    where.push(`status<>'removed'`)
  }
  return `UPDATE "Listing" SET ${sets.join(', ')} WHERE ${where.join(' AND ')};\n${bdsTombstoneSql([c.id])}`
}

export interface BdsDatedIo {
  /** The guarded writes — true iff THIS write moved the row. */
  revive: (c: BdsDatedChange) => Promise<boolean>
  repost: (c: BdsDatedChange) => Promise<boolean>
  tombstone: (ids: readonly string[]) => Promise<unknown>
  /** Durable (fsync'd) appends. */
  journal: (line: string) => void
  rollback: (line: string) => void
  log: (line: string) => void
}

export interface BdsDatedOutcome {
  revived: string[]
  reposted: string[]
  /** Planned but not moved — the row left the planned state since it was read (a moderator, another run). */
  notMoved: number
  tombstoned: number
  /** Revived ids whose page still has no ISR tombstone — the caller must report them, with a repair file. */
  owed: string[]
}

const DAY_MS = 86_400_000
/** The smallest forward move that counts as a re-post — one day, the granularity of the source's labels. */
export const BDS_REPOST_MIN_MS = DAY_MS
/** A live row is RE-POSTED iff its source date is at least BDS_REPOST_MIN_MS newer than its stored postedAt. */
export function isBdsRepost(sourceDate: Date, storedPostedAt: Date): boolean {
  const gap = sourceDate.getTime() - storedPostedAt.getTime()
  return Number.isFinite(gap) && gap >= BDS_REPOST_MIN_MS
}

/** Where a propagating error carries the revived ids still owed their tombstone. */
const OWED = 'bdsOwedTombstones'
/** The revived ids a THROW from applyBdsDatedChanges left without their ISR tombstone ([] for any other error). */
export function owedTombstonesOf(e: unknown): string[] {
  const v = e !== null && typeof e === 'object' ? (e as Record<string, unknown>)[OWED] : undefined
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v] : []
}
/** The same error, carrying `owed` — wrapped (cause kept) only when it cannot carry a property itself. */
function withOwed(e: unknown, owed: readonly string[]): unknown {
  if (!owed.length) return e
  const carrier = e !== null && typeof e === 'object' && Object.isExtensible(e)
    ? e
    : new Error(`${e instanceof Error ? e.message : String(e)} (${owed.length} revived page(s) still owed their ISR tombstone)`, { cause: e })
  Object.defineProperty(carrier, OWED, { value: [...owed], enumerable: true, configurable: true })
  return carrier
}

const journalRecord = (c: BdsDatedChange) => ({
  id: c.id, externalId: c.externalId, action: c.action,
  oldStatus: c.oldStatus, oldPostedAt: c.oldPostedAt.toISOString(), oldRankScore: c.oldRankScore,
  newPostedAt: c.newPostedAt.toISOString(), newRankScore: c.newRankScore,
})

/**
 * Applies the planned changes in order; see the header for the sequence. A write's throw propagates —
 * after one more tombstone attempt, carrying whatever is still owed (owedTombstonesOf).
 */
export async function applyBdsDatedChanges(changes: readonly BdsDatedChange[], io: BdsDatedIo): Promise<BdsDatedOutcome> {
  const owed = new Set<string>()
  const out: BdsDatedOutcome = { revived: [], reposted: [], notMoved: 0, tombstoned: 0, owed: [] }
  let warned = false
  /** Tombstone everything owed; a failure leaves it owed (the next pay, or the finally, tries again). */
  const pay = async () => {
    if (!owed.size) return
    const ids = [...owed]
    try {
      await io.tombstone(ids)
      for (const id of ids) owed.delete(id)
      out.tombstoned += ids.length
    } catch (e) {
      if (!warned) io.log(`⚠️ ISR tombstone failed (${e instanceof Error ? e.message : String(e)}) — the page(s) stay owed and are tried again`)
      warned = true
    }
  }
  // ⛔ One change per id: a duplicate would re-plan a row the first change already moved, find it not
  // movable, and (before this) clear the tombstone the first one still owed.
  const once = new Set<string>()
  try {
    for (const c of changes) {
      if (once.has(c.id)) continue
      once.add(c.id)
      io.journal(JSON.stringify({ phase: 'planned', ...journalRecord(c) }))
      // Owed BEFORE the write: a revive that commits and then loses its reply (a dropped connection) throws
      // here, and the row would sit active on its cached 404 with nothing left to tombstone it.
      if (c.action === 'revive') owed.add(c.id)
      const moved = c.action === 'revive' ? await io.revive(c) : await io.repost(c)
      if (!moved) { owed.delete(c.id); out.notMoved++; io.journal(JSON.stringify({ phase: 'not-moved', id: c.id, action: c.action })); continue }
      if (c.action === 'revive') out.revived.push(c.id); else out.reposted.push(c.id)
      io.rollback(bdsRollbackSql(c))
      io.journal(JSON.stringify({ phase: 'done', id: c.id, action: c.action }))
      if (c.action === 'revive') await pay()
    }
  } catch (e) {
    // A throw part-way (a database timeout on a later row, a full disk) — the pages already revived still
    // render now. ⛔ What this last attempt cannot pay rides ON THE ERROR: the caller has no outcome to read.
    await pay()
    throw withOwed(e, [...owed])
  }
  await pay()
  out.owed = [...owed]
  return out
}
