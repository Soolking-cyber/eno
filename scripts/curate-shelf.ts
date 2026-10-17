/**
 * Trim a capped shelf to a hand-picked set — owner, 2026-10-17: "esims only leave best options up to 10max total 1-2
 * from each prvider, also car rental leave few from each shop best suitable options". The shelves, their storefronts
 * and their caps are SHELF_CAPS (src/lib/secondhand-showcase.ts); the weekly run (/api/cron/secondhand-showcase) then
 * keeps them at that size, trimming the newest extras.
 *
 *   npx tsx scripts/curate-shelf.ts --shelf esim --keep <id>,<id>,…            # DRY RUN — a read-only DB session
 *   npx tsx scripts/curate-shelf.ts --shelf car-rental --keep <id>,… --apply
 *   npx tsx scripts/curate-shelf.ts --rollback <journal.json> [--apply]
 *
 * Every row of the shelf's storefronts on that subcategory that is not kept — live, expired or stale — goes `hidden`:
 * ⛔ EXPIRED TOO, ON PURPOSE. The car pipeline (scripts/vehicle-rentals-status.ts) revives an expired car that is fresh
 * again (35 on 2026-10-17 alone) but never a hidden one, so an expired car left alone would be back within three days.
 * Hidden, never deleted (Law 122/2025: listings are kept ≥ 1 year); journaled first; --rollback puts each row back to its
 * own status and updatedAt while it still carries this run's stamp (the next car refresh may update hidden rows — undo
 * before it runs).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RawDb } from '../src/lib/secondhand-showcase-run'

const argv = process.argv.slice(2)
const value = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const APPLY = argv.includes('--apply')
const SHELF = value('shelf')
const KEEP = (value('keep') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const ROLLBACK = value('rollback')
const JOURNAL_DIR = value('journal-dir') ?? join(homedir(), 'eno-import-journals', 'secondhand')
for (const [i, a] of argv.entries()) {
  if (a.startsWith('--') && !['--apply', '--shelf', '--keep', '--rollback', '--journal-dir'].includes(a)) { console.error(`unknown argument ${a}`); process.exit(2) }
  if (!a.startsWith('--') && !['--shelf', '--keep', '--rollback', '--journal-dir'].includes(argv[i - 1] ?? '')) { console.error(`stray argument ${a}`); process.exit(2) }
}
if (!ROLLBACK && (!SHELF || !KEEP.length)) { console.error('--shelf <esim|car-rental> and --keep <id,…> are required (or --rollback <journal>)'); process.exit(2) }

// ⛔ BEFORE the database client loads: node-postgres (and Prisma's adapter) read PGOPTIONS when they connect.
if (!APPLY) process.env.PGOPTIONS = [process.env.PGOPTIONS, '-c default_transaction_read_only=on'].filter(Boolean).join(' ')

type Entry = { listingId: string; seller: string; title: string; fromStatus: string; fromUpdatedAt: string; stamp: string }

async function main() {
  const { db } = await import('../src/lib/db')
  const { tombstonePdps } = await import('../src/lib/pdp-tombstone')
  const { licenceClearedSql } = await import('../src/lib/licence-stamp')
  const { SHELF_CAPS } = await import('../src/lib/secondhand-showcase')
  const { STILL_PUBLISHABLE_SQL, noDecisionSinceSql } = await import('../src/lib/secondhand-showcase-run')
  const raw = db as unknown as RawDb
  try {
    if (ROLLBACK) {
      const doc = JSON.parse(readFileSync(ROLLBACK, 'utf8')) as { apply?: boolean; entries: Entry[] }
      if (!doc.apply) { console.error('that journal is a DRY RUN — nothing to undo'); process.exit(2) }
      // ⛔ Only the capped shelves' ownerless storefronts: a mistaken or edited journal never publishes a person's listing.
      const names = SHELF_CAPS.flatMap((c) => c.sellers)
      const ours = (n: number) => `"sellerId" IN (SELECT s.id FROM "Seller" s WHERE s."ownerId" IS NULL AND s.name = ANY($${n}::text[]))`
      const back: string[] = []
      const left: string[] = []
      for (const e of doc.entries) {
        if (!APPLY) { console.log(`  would put back ${e.listingId} → ${e.fromStatus}`); continue }
        // Back to its own status. A live row is a PUBLISH, written as its own statement (the tripwire sees it) with the
        // licence guard, and only while still fit to show with no compliance decision since (a report leaves updatedAt
        // alone); an expired or stale row is not a publish.
        const n = e.fromStatus === 'active'
          ? await raw.$executeRawUnsafe(
            `UPDATE "Listing" SET status = 'active', "updatedAt" = $2::timestamp
              WHERE id = $1 AND status = 'hidden' AND "updatedAt" = $3::timestamp AND ${licenceClearedSql()} AND ${ours(4)}
                AND ${STILL_PUBLISHABLE_SQL} AND ${noDecisionSinceSql('$3::timestamp')}`,
            e.listingId, e.fromUpdatedAt, e.stamp, names)
          : await raw.$executeRawUnsafe(
            `UPDATE "Listing" SET status = $2, "updatedAt" = $3::timestamp WHERE id = $1 AND status = 'hidden' AND "updatedAt" = $4::timestamp AND $2 IN ('expired', 'stale') AND ${ours(5)}`,
            e.listingId, e.fromStatus, e.fromUpdatedAt, e.stamp, names)
        ;(n ? back : left).push(e.listingId)
      }
      if (APPLY) {
        console.log(`PDP tombstones: ${await tombstonePdps(db, back)}`)
        console.log(`put back ${back.length}; left alone ${left.length} (changed since): ${left.join(', ') || '—'}`)
      }
      return
    }
    const cap = SHELF_CAPS.find((c) => c.shelf === SHELF)
    if (!cap) { console.error(`no such shelf: ${SHELF} (${SHELF_CAPS.map((c) => c.shelf).join(', ')})`); process.exit(2) }
    const sellers: { id: string; name: string }[] = []
    for (const name of cap.sellers) {
      // ⛔ OWNERLESS ONLY — the platform's own import storefronts; never a person's.
      const s = await raw.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Seller" WHERE name = $1 AND "ownerId" IS NULL`, name)
      if (s.length !== 1) { console.error(`${name}: ${s.length ? 'ambiguous' : 'no'} ownerless storefront — refusing`); process.exit(1) }
      sellers.push({ id: s[0].id, name })
    }
    // edition-lint-allow: the shelf's ownerless storefronts by id — an operator script's read, never rendered.
    const rows = await raw.$queryRawUnsafe<{ id: string; sellerId: string; status: string; title: string; upd: string }[]>(
      `SELECT l.id, l."sellerId", l.status, coalesce(l."titleVi", l.title) AS title, l."updatedAt"::text AS upd
         FROM "Listing" l WHERE l."sellerId" = ANY($1::text[]) AND l."subcategorySlug" = $2 AND l.status IN ('active', 'expired', 'stale')`,
      sellers.map((s) => s.id), cap.subcategory)
    const keep = rows.filter((r) => KEEP.includes(r.id))
    const missing = KEEP.filter((id) => !keep.some((r) => r.id === id && r.status === 'active'))
    if (missing.length) { console.error(`kept ids that are not live rows of this shelf: ${missing.join(', ')} — refusing`); process.exit(1) }
    const per = new Map<string, number>()
    for (const r of keep) per.set(r.sellerId, (per.get(r.sellerId) ?? 0) + 1)
    if (keep.length > cap.total || [...per.values()].some((n) => n > cap.perSeller)) {
      console.error(`the keep list breaks the shelf's cap (${cap.perSeller} per seller, ${cap.total} in all) — refusing`); process.exit(1)
    }
    const nameOf = (id: string) => sellers.find((s) => s.id === id)!.name
    const hide = rows.filter((r) => !KEEP.includes(r.id))
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${cap.shelf}: keep ${keep.length}, hide ${hide.length} (${['active', 'expired', 'stale'].map((s) => `${s} ${hide.filter((r) => r.status === s).length}`).join(', ')})`)
    for (const r of keep) console.log(`  = keep  ${r.id}  ${nameOf(r.sellerId).padEnd(14)} ${r.title.slice(0, 80)}`)
    const stamp = new Date().toISOString().replace('T', ' ').replace('Z', '')
    const entries: Entry[] = hide.map((r) => ({ listingId: r.id, seller: nameOf(r.sellerId), title: r.title.slice(0, 120), fromStatus: r.status, fromUpdatedAt: r.upd, stamp }))
    mkdirSync(JOURNAL_DIR, { recursive: true })
    const file = join(JOURNAL_DIR, `curate-${cap.shelf}-${stamp.replace(/[: .]/g, '-')}-${APPLY ? 'apply' : 'dry'}.json`)
    // Journal FIRST — every row it will touch, with its prior status and updatedAt.
    writeFileSync(file, JSON.stringify({ apply: APPLY, shelf: cap.shelf, keep: KEEP, entries }, null, 1))
    if (!APPLY) { console.log(`journal (dry) → ${file}`); return }
    const done: string[] = []
    const skipped: string[] = []
    for (let i = 0; i < hide.length; i += 500) {
      const part = hide.slice(i, i + 500)
      const r = await raw.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE "Listing" l SET status = 'hidden', "updatedAt" = $3::timestamp
           FROM unnest($1::text[], $2::text[]) AS j(id, upd)
          WHERE l.id = j.id AND l."updatedAt"::text = j.upd AND l.status IN ('active', 'expired', 'stale')
            AND EXISTS (SELECT 1 FROM "Seller" so WHERE so.id = l."sellerId" AND so."ownerId" IS NULL) RETURNING l.id`,
        part.map((x) => x.id), part.map((x) => x.upd), stamp)
      const ok = new Set(r.map((x) => x.id))
      for (const x of part) (ok.has(x.id) ? done : skipped).push(x.id)
    }
    const live = hide.filter((r) => r.status === 'active' && done.includes(r.id)).map((r) => r.id)
    console.log(`hidden ${done.length}; left alone ${skipped.length} (changed since the read)`)
    console.log(`PDP tombstones: ${await tombstonePdps(db, live)}`)
    writeFileSync(file, JSON.stringify({ apply: true, shelf: cap.shelf, keep: KEEP, entries: entries.filter((e) => done.includes(e.listingId)), skipped }, null, 1))
    console.log(`journal → ${file}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
