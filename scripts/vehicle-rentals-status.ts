/**
 * EXPIRE AND REVIVE IMPORTED VEHICLE ROWS — the write half of the every-3-days refresh. The rules (which car is
 * reliable, which bike is missing, the guards) are pure and tested in src/lib/vehicle-reliability.ts and
 * src/lib/vehicle-status-plan.ts; scripts/import-vehicle-rentals.ts --stage import plans with them and calls
 * applyMoves() here. Owner, 2026-10-13: "remove most of car rental leave only reliable fresh ones same with
 * motorbike rentals maybe 7-10 days old ones".
 *
 * WHAT IT WRITES: active → 'expired' (EXPIRED_STATUS — a 404 that keeps the row and users' saved lists) and
 * 'expired' → active (a revival). Nothing else: never hidden / removed / sold, never a DELETE (Law 122/2025).
 * ⛔ JOURNAL FIRST, EXACT ROLLBACK (the scripts/expire-rentals.ts pattern): every row's status and updatedAt are read
 * and written to the journal with the batch stamp T, fsynced (file and directory), BEFORE the first write; each write
 * is conditional on both and sets updatedAt = T. --rollback puts back only rows still exactly as this batch left
 * them (status and updatedAt = T) — anything touched since is left alone.
 * ⛔ EVERY MOVED PAGE IS TOMBSTONED, per chunk, before and after its write (src/lib/pdp-tombstone.ts): the PDP is ISR
 * for 30 days, so an expired row would keep rendering and a revived one keep its cached 404. Refused up front where
 * the tag table is missing, unless --allow-no-isr (a scratch database).
 * ⛔ ONE STATEMENT PER DIRECTION, WITH `status = 'active'` WRITTEN AS A LITERAL. A revival (and the rollback of an
 * expiry) puts a row back in front of the public, so both must stay visible to the publish-path audit
 * (src/lib/compliance/public-state-writes.test.ts reads SET clauses for that literal — a status passed as a
 * parameter would be invisible to it). Listed there as outside the seller identity gate: ownerless storefronts.
 *
 * ⚠️ A ROLLBACK HOLDS ONLY UNTIL THE NEXT RUN: the next refresh re-judges every row by the same rule and would move
 * them again. Unload the LaunchAgent (or fix the cause) before rolling back a batch that was wrong.
 *
 *   npx tsx scripts/vehicle-rentals-status.ts --rollback <journal.json> [--apply]   # DRY unless --apply
 *   npx tsx scripts/vehicle-rentals-status.ts --tombstone <journal.json>            # retry the PDP tombstones
 *   (set -a; . ~/eno.vn/.env; set +a first — the database is behind the :5433 tunnel, scripts/db-tunnel.sh)
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { PrismaClient } from '../src/generated/prisma/client'
import { EXPIRED_STATUS } from '../src/lib/apartment-freshness'
import { invokedDirectly } from '../src/lib/cli-entry'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { VEHICLE_SELLERS, type SellerKey } from '../src/lib/vehicle-rental-listing'
import { PRESENCE_KIND, PRESENCE_VERSION, parsePresenceEntry, type DbRow, type Move, type PresenceEntry } from '../src/lib/vehicle-status-plan'

type RawDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$queryRawUnsafe'>
export const STATUS_JOURNAL_KIND = 'vehicle-status'
type JournalRow = { id: string; externalId: string; seller: string; from: string; to: string; updatedAt: string; code: string; reason: string }
export type StatusJournal = { kind: typeof STATUS_JOURNAL_KIND; version: 1; createdAt: string; stamp: string; rows: JournalRow[] }
const CHUNK = 500
const chunks = <T>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, i * CHUNK + CHUNK))
const SELLER_IDS = Object.values(VEHICLE_SELLERS).map((s) => s.id)
/**
 * ⛔ RE-CHECKED IN EVERY WRITE, not only in the read: a pinned storefront still ownerless and the row still an
 * import (affiliateUrl). A storefront claimed between the read and the write must never get a row published by
 * a script (review 2026-10-13) — the claim does not move the row's updatedAt, so the status guard alone cannot see it.
 */
const STILL_IMPORTED = `l."sellerId" = ANY($5::text[]) AND l."affiliateUrl" IS NOT NULL AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL)`
const KEY_BY_ID = new Map<string, SellerKey>(Object.entries(VEHICLE_SELLERS).map(([k, v]) => [v.id, k as SellerKey]))

function fsyncDir(dir: string) {
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
/** Write-then-rename, fsynced: a crash leaves no file or the whole file. `exclusive` refuses to replace one. */
function writeDurably(path: string, body: string, exclusive = false) {
  const dir = resolve(path, '..')
  mkdirSync(dir, { recursive: true })
  if (exclusive && existsSync(path)) throw new Error(`${path} already exists — refusing to overwrite a journal`)
  const tmp = `${path}.tmp-${process.pid}`
  const fd = openSync(tmp, 'wx')
  try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, path)
  fsyncDir(dir)
}

// ── The presence history (one entry per applied run) ──────────────────────────────────────────────

export function loadPresenceEntries(dir: string): { entries: PresenceEntry[]; problems: string[] } {
  const entries: PresenceEntry[] = [], problems: string[] = []
  if (!existsSync(dir)) return { entries, problems }
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const e = parsePresenceEntry(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      if (e) entries.push(e)
      else problems.push(`${name}: not a ${PRESENCE_KIND} v${PRESENCE_VERSION} entry`)
    } catch (err) {
      problems.push(`${name}: ${(err as Error).message.slice(0, 120)}`)
    }
  }
  return { entries, problems }
}

export function writePresenceEntry(dir: string, entry: PresenceEntry): string {
  const path = join(resolve(dir), `${entry.recordedAt.replace(/[:.]/g, '-')}.json`)
  writeDurably(path, JSON.stringify(entry) + '\n', true)
  return path
}

// ── Rows ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every IMPORTED row of the vehicle storefronts, any status: pinned seller ids, an ownerless storefront, an
 * affiliateUrl (only the importer writes one), the rentals category. updatedAt as text, the exact value the
 * conditional write compares.
 */
export async function readVehicleRows(db: RawDb): Promise<(DbRow & { updatedAt: string })[]> {
  const rows = await db.$queryRawUnsafe<{ id: string; externalId: string | null; status: string; sellerId: string; subcat: string | null; updatedAt: string }[]>(
    `SELECT l.id, l."externalId", l.status, l."sellerId", l."subcategorySlug" AS subcat, l."updatedAt"::text AS "updatedAt"
     FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId"
     WHERE l."sellerId" = ANY($1::text[]) AND s."ownerId" IS NULL AND l."affiliateUrl" IS NOT NULL AND c.slug = 'rentals'
     ORDER BY l.id`, SELLER_IDS)
  return rows.map((r) => ({ id: r.id, externalId: r.externalId, status: r.status, seller: KEY_BY_ID.get(r.sellerId)!, subcat: r.subcat, updatedAt: r.updatedAt }))
}

async function isrTable(db: RawDb): Promise<boolean> {
  const [{ t }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
  return !!t
}

async function tombstoneAll(db: RawDb, ids: string[]) {
  if (!ids.length) return
  const msg = await tombstonePdps(db, ids)
  const written = Number(/^(\d+) tags/.exec(msg)?.[1] ?? NaN)
  if (written !== ids.length * 2 && !msg.startsWith('SKIPPED')) throw new Error(`tombstones incomplete (${msg}) — retry with: npx tsx scripts/vehicle-rentals-status.ts --tombstone <journal>`)
}

/**
 * Write the planned moves: journal first, then per chunk tombstone → conditional write → tombstone what moved.
 * Returns the ids that moved (a row changed between the read and the write is skipped, not forced).
 */
export async function applyMoves(
  db: RawDb, moves: readonly (Move & { updatedAt: string })[], opts: { journalDir: string; allowNoIsr?: boolean },
): Promise<{ moved: string[]; journal: string | null }> {
  if (!moves.length) return { moved: [], journal: null }
  // ⛔ Checked BEFORE any write: without the tag table an expired PDP keeps rendering from ISR for 30 days.
  const isr = await isrTable(db)
  if (!isr && !opts.allowNoIsr) throw new Error('no next_cache_tag table on this database — moved pages would keep their cached state; --allow-no-isr only on a scratch copy')
  const [{ now }] = await db.$queryRawUnsafe<{ now: string }[]>(`SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')::text AS now`)
  const createdAt = new Date().toISOString()
  const journal: StatusJournal = {
    kind: STATUS_JOURNAL_KIND, version: 1, createdAt, stamp: now,
    rows: moves.map((m) => ({ id: m.id, externalId: m.externalId, seller: m.seller, from: m.from, to: m.to, updatedAt: m.updatedAt, code: m.code, reason: m.reason })),
  }
  const path = join(resolve(opts.journalDir), `vehicle-status-${createdAt.replace(/[:.]/g, '-')}.json`)
  // ⛔ ON DISK — fsynced, file and directory — BEFORE A SINGLE ROW CHANGES: each chunk below commits on its own.
  writeDurably(path, JSON.stringify(journal, null, 1), true)
  console.log(`  journal               ${path} (${moves.length} rows, stamp ${now})`)
  console.log(`  ROLLBACK              npx tsx scripts/vehicle-rentals-status.ts --rollback ${path} --apply`)
  const moved: string[] = []
  for (const part of chunks(journal.rows)) {
    if (isr) await tombstoneAll(db, part.map((x) => x.id))
    const down = part.filter((x) => x.from === 'active' && x.to === EXPIRED_STATUS)
    const up = part.filter((x) => x.from === EXPIRED_STATUS && x.to === 'active')
    const ids: string[] = []
    if (down.length) {
      ids.push(...(await db.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE "Listing" l SET status = $3, "updatedAt" = $4::timestamp
         FROM unnest($1::text[], $2::text[]) AS j(id, upd)
         WHERE l.id = j.id AND l.status = 'active' AND l."updatedAt"::text = j.upd AND ${STILL_IMPORTED}
         RETURNING l.id`,
        down.map((x) => x.id), down.map((x) => x.updatedAt), EXPIRED_STATUS, now, SELLER_IDS)).map((x) => x.id))
    }
    if (up.length) {
      // The revival: back in front of the public — only from 'expired', only unchanged since this run read it.
      ids.push(...(await db.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE "Listing" l SET status = 'active', "updatedAt" = $4::timestamp
         FROM unnest($1::text[], $2::text[]) AS j(id, upd)
         WHERE l.id = j.id AND l.status = $3 AND l."updatedAt"::text = j.upd AND ${STILL_IMPORTED}
         RETURNING l.id`,
        up.map((x) => x.id), up.map((x) => x.updatedAt), EXPIRED_STATUS, now, SELLER_IDS)).map((x) => x.id))
    }
    moved.push(...ids)
    if (isr) await tombstoneAll(db, ids) // right after its write: a crash later leaves no moved row on its old cached page
  }
  return { moved, journal: path }
}

// ── CLI: rollback / tombstone retry ───────────────────────────────────────────────────────────────

function readJournal(path: string): StatusJournal {
  const j = JSON.parse(readFileSync(path, 'utf8')) as StatusJournal
  if (j.kind !== STATUS_JOURNAL_KIND || !Array.isArray(j.rows) || !j.stamp) throw new Error(`${path} is not a ${STATUS_JOURNAL_KIND} journal`)
  const bad = j.rows.find((r) => !/^c[a-z0-9]{20,30}$/.test(r.id) || ![`active>${EXPIRED_STATUS}`, `${EXPIRED_STATUS}>active`].includes(`${r.from}>${r.to}`) || !r.updatedAt)
  if (bad || new Set(j.rows.map((r) => r.id)).size !== j.rows.length) throw new Error(`${path}: a malformed or duplicate journal row — refusing`)
  return j
}

async function main() {
  const argv = process.argv.slice(2)
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const APPLY = argv.includes('--apply')
  const ROLLBACK = val('--rollback'), RETOMB = val('--tombstone')
  if ((ROLLBACK ? 1 : 0) + (RETOMB ? 1 : 0) !== 1) throw new Error('pick one of --rollback <journal> [--apply] | --tombstone <journal> (the plan + write run inside import-vehicle-rentals.ts --stage import)')
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL (or DATABASE_URL) is not set — source the .env first')
  const writes = APPLY || !!RETOMB
  const { PrismaClient: Client } = await import('../src/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const db = new Client({ adapter: new PrismaPg({ connectionString, options: `-c TimeZone=UTC${writes ? '' : ' -c default_transaction_read_only=on'}` }), log: ['warn', 'error'] })
  try {
    const j = readJournal((ROLLBACK ?? RETOMB)!)
    if (RETOMB) {
      for (const part of chunks(j.rows.map((r) => r.id))) await tombstoneAll(db, part)
      console.log(`tombstoned ${j.rows.length} pages (en/vi)`)
      return
    }
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — rollback of ${j.rows.length} moves stamped ${j.stamp}`)
    let restorable = 0
    const restored: string[] = []
    // Back to `from` only where the row is still exactly as this batch left it: status `to`, updatedAt = the stamp.
    const exactly = `l.id = j.id AND l.status = $3 AND l."updatedAt" = $4::timestamp AND ${STILL_IMPORTED}`
    for (const part of chunks(j.rows)) {
      const expired = part.filter((x) => x.to === EXPIRED_STATUS), revived = part.filter((x) => x.to === 'active')
      const ex = [expired.map((x) => x.id), expired.map((x) => x.updatedAt), EXPIRED_STATUS, j.stamp, SELLER_IDS] as const
      const rv = [revived.map((x) => x.id), revived.map((x) => x.updatedAt), 'active', j.stamp, SELLER_IDS] as const
      for (const args of [ex, rv]) {
        if (args[0].length) restorable += (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "Listing" l, unnest($1::text[], $2::text[]) AS j(id, upd) WHERE ${exactly}`, ...args))[0].n
      }
      if (!APPLY) continue
      // Tombstoned before the write as well as after (as applyMoves does): a crash between the two leaves no page on
      // the state the rollback just undid.
      await tombstoneAll(db, part.map((x) => x.id))
      const back: string[] = []
      // An expiry undone puts the row back in front of the public: the literal keeps it visible to the publish-path audit.
      if (expired.length) back.push(...(await db.$queryRawUnsafe<{ id: string }[]>(`UPDATE "Listing" l SET status = 'active', "updatedAt" = j.upd::timestamp FROM unnest($1::text[], $2::text[]) AS j(id, upd) WHERE ${exactly} RETURNING l.id`, ...ex)).map((x) => x.id))
      if (revived.length) back.push(...(await db.$queryRawUnsafe<{ id: string }[]>(`UPDATE "Listing" l SET status = $6, "updatedAt" = j.upd::timestamp FROM unnest($1::text[], $2::text[]) AS j(id, upd) WHERE ${exactly} RETURNING l.id`, ...rv, EXPIRED_STATUS)).map((x) => x.id))
      restored.push(...back)
      await tombstoneAll(db, back)
    }
    console.log(`  ${restorable} still exactly as the batch left them → restorable · ${j.rows.length - restorable} changed since → LEFT ALONE`)
    console.log(APPLY ? `RESTORED ${restored.length}.` : 'DRY RUN — nothing written.')
  } finally {
    await db.$disconnect()
  }
}

if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
