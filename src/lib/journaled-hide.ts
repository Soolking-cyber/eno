import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * ── THE JOURNALED, REVERSIBLE HIDE OF AN IMPORTED ROW ───────────────────────────────────────────────
 *
 * The one write path for hiding a LIVE listing for a content-policy reason outside the app:
 * scripts/hide-ad-banned.ts (the advertising-ban sweep) and ImportScreen.applyHides
 * (src/lib/import-screen.ts, an importer refusing a row it already published). Both hide, and
 * `scripts/hide-ad-banned.ts --rollback <journal>` undoes either.
 *
 * ⛔ ONLY AN OWNERLESS STOREFRONT'S IMPORTED OR LINKED ROW (2026-10-01, review). `hidden` is a SELLER
 * state — a seller can relist it in one click — and nothing here writes an audit row or tells anyone,
 * so on a real person's own post it would be an unannounced, unaudited takedown the seller could
 * silently undo. User posts are screened at publish (publish-guard.ts) and policed by reports and
 * moderation; this path is for the platform's own imports. The guard is in the SQL of every statement
 * (`IMPORTED_ROW`), not only in the callers' reads. Measured 2026-10-01 (read-only): all 111,007 live
 * rows in ownerless storefronts carry an externalId or affiliateUrl, and no ownerless storefront
 * with a guest phone holds a live row — the import predicate costs nothing today and keeps a guest's
 * own post out if one ever exists.
 *
 * ⛔ THE JOURNAL RECORDS THE EXACT STATE THE HIDE WROTE OVER, AND THE ROLLBACK RESTORES ONLY THAT STATE.
 * Each row's status AND `updatedAt` are read immediately before the hide and written to the journal
 * BEFORE any row changes; the hide itself is conditional on both still being what the journal says.
 * The hide and the restore are raw SQL, so neither bumps `updatedAt` (Prisma's @updatedAt is
 * client-side; there is no trigger on "Listing" — checked 2026-10-01). Every app write to a listing
 * goes through Prisma and DOES bump it — a moderator's hide, an unverify, an edit, a tombstone — so a
 * row whose `updatedAt` no longer matches the journal was touched by someone else after the hide, and
 * --rollback leaves it alone. A later compliance_audit row on the listing (a takedown, a removal)
 * excludes it too. A journal row without the stamp is never restored.
 */

/** The minimal database surface — a PrismaClient satisfies it. */
export type HideDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export type HideJournalRow = {
  id: string
  /** The status the hide wrote over ('active' | 'sold') — what --rollback puts back. */
  priorStatus: string
  /** `"updatedAt"::text` at the moment of the hide. --rollback restores only while it is unchanged. */
  updatedAt?: string
  rule: string
  matched: string | null
  title: string
}

export type HideJournal = {
  kind: 'hide-ad-banned' | 'import-screen-hide'
  createdAt: string
  importer?: string
  rows: HideJournalRow[]
}

export type HideCandidate = Omit<HideJournalRow, 'priorStatus' | 'updatedAt'>

/** An ownerless storefront's imported or linked row — the only rows this module ever writes. */
const IMPORTED_ROW = `s."ownerId" IS NULL AND (l."externalId" IS NOT NULL OR l."affiliateUrl" IS NOT NULL)`

/** The state the journal records: live, imported, read immediately before the hide. */
export const SNAPSHOT_SQL =
  `SELECT l.id, l.status, l."updatedAt"::text AS "updatedAt" FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" ` +
  `WHERE l.id = ANY($1::text[]) AND l.status IN ('active','sold') AND ${IMPORTED_ROW}`

/** The hide — conditional on the journaled status AND updatedAt, per row, in one statement. */
export const HIDE_SQL =
  `UPDATE "Listing" l SET status = 'hidden' FROM "Seller" s, unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) ` +
  `WHERE l.id = j.id AND s.id = l."sellerId" AND ${IMPORTED_ROW} AND l.status = j.prior AND l."updatedAt"::text = j.upd ` +
  `RETURNING l.id`

/** Still exactly what the hide left: hidden, untouched since (updatedAt), no compliance decision since. */
const RESTORABLE =
  `l.id = j.id AND l.status = 'hidden' AND l."updatedAt"::text = j.upd ` +
  `AND NOT EXISTS (SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = l.id AND a."occurredAt" >= $4::timestamp) ` +
  // ⛔ Still an ownerless storefront: a claim changes Seller.ownerId without touching the listing's
  // updatedAt, and a rollback must never republish a row inside a storefront a person now owns (codex).
  `AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL)`

export const RESTORABLE_SQL =
  `SELECT l.id FROM "Listing" l, unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) WHERE ${RESTORABLE}`

export const RESTORE_SQL =
  `UPDATE "Listing" l SET status = j.prior FROM unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) ` +
  `WHERE ${RESTORABLE} RETURNING l.id`

const CHUNK = 500
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}
const columns = (rows: { id: string; priorStatus: string; updatedAt?: string }[]) =>
  [rows.map((r) => r.id), rows.map((r) => r.priorStatus), rows.map((r) => r.updatedAt ?? '')] as const

/**
 * Hide `candidates`: snapshot → journal (on disk, BEFORE any write) → conditional hide. A candidate
 * that is no longer live, or is not an ownerless imported row, is skipped and not journaled.
 * `journalPath` is written only when there is something to hide.
 */
export async function journaledHide(
  db: HideDb,
  candidates: HideCandidate[],
  journal: { path: string; kind: HideJournal['kind']; importer?: string },
): Promise<{ journal: string | null; journaled: number; hidden: string[] }> {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const snap = new Map<string, { status: string; updatedAt: string }>()
  for (const ids of chunks([...byId.keys()])) {
    const rows = await db.$queryRawUnsafe<{ id: string; status: string; updatedAt: string }[]>(SNAPSHOT_SQL, ids)
    for (const r of rows) snap.set(r.id, { status: r.status, updatedAt: r.updatedAt })
  }
  const rows: HideJournalRow[] = []
  for (const [id, c] of byId) {
    const s = snap.get(id)
    if (s) rows.push({ ...c, priorStatus: s.status, updatedAt: s.updatedAt })
  }
  if (!rows.length) return { journal: null, journaled: 0, hidden: [] }
  const j: HideJournal = { kind: journal.kind, createdAt: new Date().toISOString(), ...(journal.importer ? { importer: journal.importer } : {}), rows }
  // ⛔ ON DISK BEFORE A SINGLE ROW CHANGES — a failed write throws here and nothing is hidden.
  mkdirSync(dirname(journal.path), { recursive: true })
  writeFileSync(journal.path, JSON.stringify(j, null, 2))
  const hidden: string[] = []
  for (const part of chunks(rows)) {
    const done = await db.$queryRawUnsafe<{ id: string }[]>(HIDE_SQL, ...columns(part))
    hidden.push(...done.map((r) => r.id))
  }
  return { journal: journal.path, journaled: rows.length, hidden }
}

/**
 * Undo a journal: restore each row's prior status — ONLY while the row is still exactly what the hide
 * left (see the header). `apply: false` reports what would be restored and writes nothing.
 */
export async function journaledRestore(
  db: HideDb,
  journal: Pick<HideJournal, 'createdAt' | 'rows'>,
  opts: { apply: boolean },
): Promise<{ total: number; unstamped: number; restorable: string[]; restored: string[] }> {
  const stamped = journal.rows.filter((r) => typeof r.updatedAt === 'string' && r.updatedAt.length > 0)
  const restorable: string[] = []
  const restored: string[] = []
  for (const part of chunks(stamped)) {
    const args = [...columns(part), journal.createdAt]
    restorable.push(...(await db.$queryRawUnsafe<{ id: string }[]>(RESTORABLE_SQL, ...args)).map((r) => r.id))
    if (opts.apply) restored.push(...(await db.$queryRawUnsafe<{ id: string }[]>(RESTORE_SQL, ...args)).map((r) => r.id))
  }
  return { total: journal.rows.length, unstamped: journal.rows.length - stamped.length, restorable, restored }
}

/** `--rollback <path>`: the path, or an error message when it is missing or is another flag. */
export function rollbackPathArg(argv: readonly string[]): { path: string | null; error: string | null } {
  const at = argv.indexOf('--rollback')
  if (at < 0) return { path: null, error: null }
  const next = argv[at + 1]
  if (!next || next.startsWith('--')) return { path: null, error: '--rollback needs a journal path: --rollback scripts/journals/<file>.json [--apply]' }
  return { path: next, error: null }
}
