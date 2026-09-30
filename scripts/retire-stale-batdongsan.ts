/**
 * Take the Batdongsan.com.vn APARTMENT rentals off every public surface. Owner, 2026-09-30: "leave only
 * apartments that are available, i checked couple have expired or rented out" → asked, and chose
 * "Hide them all (Recommended)", apartments only.
 *
 *   DRY (read-only session):  set -a; . ./.env; set +a; npx tsx scripts/retire-stale-batdongsan.ts
 *   WRITE (journal first):    … scripts/retire-stale-batdongsan.ts --journal-dir <durable dir> --apply
 *
 * WHY ALL OF THEM, AND NOT "ONLY THE LET ONES": nobody can tell which are let. Every Batdongsan page
 * answers a Cloudflare interstitial (HTTP 403) to anything automated — re-confirmed 2026-09-30 — so no
 * liveness check is possible (import-batdongsan-rentals.ts, note 2). The rows are a snapshot taken
 * 2026-09-21 in a market that turns over in days, and the scrape held one usable photo each (the second
 * file was the agent's headshot, refused), below the three-photo floor the other importers publish at.
 *
 * ⛔ STATUS 'stale', NOT 'hidden', AND THE DIFFERENCE IS LOAD-BEARING. `hide-imageless-imports.ts
 * --restore` re-activates every hidden import row that HAS a photo — and each of these has one, so a
 * routine restore would republish all 10,843. 'stale' is this script's own marker: publicly it is
 * exactly as invisible as 'hidden' (listingIsViewable admits only active|sold; every feed pins
 * active), and no other script matches it. Rollback = the .sql written beside the journal.
 * ⛔ HIDES, NEVER DELETES; only `active` apartment-rental rows of the Batdongsan seller PINNED BY ID.
 */
import 'dotenv/config'
import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journalDirProblem } from '../src/lib/honeycomb-listing'

const SELLER_ID = 'bds-vn-import-seller-0001' // Batdongsan.com.vn — pinned by id
const SUB = 'apartment-rental'
const STALE = 'stale'
const BATCH = 500

const argv = process.argv.slice(2)
const str = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] ?? null : null }
const APPLY = argv.includes('--apply')
const JOURNAL_DIR = str('--journal-dir')

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}
function ensureJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.bds-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}

async function main() {
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  const journalDir = APPLY ? ensureJournalDir(JOURNAL_DIR!) : null
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
  try {
    const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { name: true, ownerId: true } })
    if (!seller || seller.name !== 'Batdongsan.com.vn' || seller.ownerId) throw new Error(`seller ${SELLER_ID} is not the ownerless Batdongsan.com.vn import seller — refusing`)

    const rows = await db.listing.findMany({
      where: { sellerId: SELLER_ID, subcategorySlug: SUB, status: 'active' },
      select: { id: true }, orderBy: { id: 'asc' },
    })
    const other = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active', NOT: { subcategorySlug: SUB } } })
    console.log(`batdongsan        ${rows.length} active apartment rentals → '${STALE}'   (${other} active non-apartment rows untouched)`)
    if (!APPLY) { console.log('\nDRY RUN — nothing changed. Re-run with --journal-dir <durable dir> --apply.'); return }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const JOURNAL = join(journalDir!, `bds-apartments-stale-${stamp}.ids`)
    const ROLLBACK = join(journalDir!, `bds-apartments-stale-${stamp}.rollback.sql`)
    console.log(`journal           ${JOURNAL}\nrollback          ${ROLLBACK}`)
    let done = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const ids = rows.slice(i, i + BATCH).map((r) => r.id)
      // Journal AND rollback first (fsync); the rollback only touches ids that are still 'stale'.
      recordDurably(JOURNAL, ids.join('\n'))
      recordDurably(ROLLBACK, `UPDATE "Listing" SET status='active' WHERE status='${STALE}' AND "sellerId"='${SELLER_ID}' AND id IN (${ids.map((x) => `'${x}'`).join(',')});`)
      const res = await db.listing.updateMany({
        where: { id: { in: ids }, sellerId: SELLER_ID, subcategorySlug: SUB, status: 'active' },
        data: { status: STALE },
      })
      done += res.count
    }
    console.log(`marked ${STALE}      ${done} of ${rows.length}`)
    if (done) console.log('NEXT: purge cached listing pages — node scripts/purge-isr-listings.mjs (PDPs are ISR for 30 days)')
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
