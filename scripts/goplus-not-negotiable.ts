/**
 * GoPlus rooms → never negotiable, NOW — the one-off backfill for the rows the weekly import has not reached yet.
 *
 * Owner, 2026-11-20: "why people can send offer to goplus listings make them all non negotiable". The mapping copied
 * GoPlus's own `negotiable` flag, so the rooms GoPlus marks negotiable (15 of 5,379 on 2026-11-20) took offers on eno.
 * src/lib/goplus-listing.ts now maps every room to `negotiable: false` and the weekly import (scripts/apartments-weekly.sh,
 * `goplus`) writes it back to every row it refreshes — but that run is up to a week away. This script flips the rows
 * still stored negotiable today, and nothing else.
 *
 *   DRY (read-only transaction; prints the rows it would flip):
 *     set -a; . ./.env; set +a; npx tsx scripts/goplus-not-negotiable.ts
 *   WRITE (journal first, then one UPDATE, then the pages' ISR tombstones):
 *     … scripts/goplus-not-negotiable.ts --journal-dir <durable dir> --apply
 *   UNDO (exactly the journalled rows, only while they are still not negotiable):
 *     … scripts/goplus-not-negotiable.ts --rollback <journal-dir>/goplus-not-negotiable-<time>.applied.json --apply
 *
 * ⚠️ RAW SQL, NOT updateMany: Prisma's @updatedAt would move every row's updatedAt, which dates the sitemap and the rails.
 * Turning offers off is not a change a buyer sees in the listing, so its date stays.
 * ⚠️ ONLY THE GOPLUS STOREFRONT (the Handle `goplus`) and only rows stored negotiable — a listing of any other seller is never
 * touched, and the UPDATE re-checks both conditions, so a row that changed between the read and the write is skipped.
 * takesOffers() (src/lib/taxonomy.ts) is what refuses offers server-side once a row is false; the tombstones make the
 * cached pages drop their offer button (the PDP is ISR for 30 days; an operator script has no revalidatePath).
 * ⛔ ORDER: the GoPlus import (scripts/apartments-weekly.sh, launchd on the owner's Mac, from ~/eno-apartments-job) writes
 * `negotiable` on every refresh — move that checkout to a commit carrying the mapping fix FIRST, or its next run turns
 * these rows back on. --rollback is an undo of this script only; it goes against the owner's rule, so ask before using it.
 */
import 'dotenv/config'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { GOPLUS_HANDLE } from '../src/lib/goplus-listing'
import { tombstonePdps } from '../src/lib/pdp-tombstone'

const argv = process.argv.slice(2)
const KNOWN = new Set(['--apply', '--journal-dir', '--rollback'])
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) throw new Error(`unknown argument ${argv[i]} — known: ${[...KNOWN].join(' ')}`)
  if (argv[i] === '--journal-dir' || argv[i] === '--rollback') i++
}
const APPLY = argv.includes('--apply')
const valueOf = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? null : null }
const JOURNAL_DIR = valueOf('--journal-dir')
const ROLLBACK = valueOf('--rollback')
if (ROLLBACK && JOURNAL_DIR) throw new Error('--rollback reads its own journal; --journal-dir is for a forward run')
if (APPLY && !ROLLBACK && (!JOURNAL_DIR || JOURNAL_DIR.startsWith('--'))) throw new Error('--apply needs --journal-dir <durable dir>')

/** Durable means not a temp dir — judged on the REAL path (a symlink into /tmp is still /tmp), macOS's $TMPDIR included. */
function journalDirProblem(dir: string): string | null {
  const real = (() => { try { return realpathSync(dir) } catch { return resolve(dir) } })()
  return /^\/(private\/)?(tmp|var\/folders)\b/.test(real) ? `--journal-dir ${real} is a temp dir — use a durable one` : null
}
function fsyncDir(dir: string) { const fd = openSync(dir, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } }
function writeDurable(path: string, body: string) {
  const fd = openSync(path, 'wx')
  try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
}

type Journal = { at: string; sellerId: string; ids: string[] }

async function main() {
  const cs = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!cs) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ./.env; set +a` first')
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: cs, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }),
    log: ['warn', 'error'],
  })
  try {
    const h = await db.handle.findUnique({ where: { handle: GOPLUS_HANDLE }, select: { sellerId: true } })
    if (!h?.sellerId) throw new Error(`no storefront with the handle "${GOPLUS_HANDLE}"`)
    const sellerId = h.sellerId

    if (ROLLBACK) {
      const j = JSON.parse(readFileSync(ROLLBACK, 'utf8')) as Journal
      if (j.sellerId !== sellerId) throw new Error(`the journal is for seller ${j.sellerId}, the "${GOPLUS_HANDLE}" storefront is ${sellerId} — refusing`)
      console.log(`rollback: ${j.ids.length} row(s) journalled at ${j.at}`)
      if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); return }
      const n = await db.$executeRaw`UPDATE "Listing" SET negotiable = true WHERE id = ANY(${j.ids}::text[]) AND "sellerId" = ${sellerId} AND negotiable = false`
      console.log(`restored ${n} row(s) to negotiable · ${await tombstonePdps(db, j.ids)}`)
      return
    }

    const rows = await db.listing.findMany({ where: { sellerId, negotiable: true }, select: { id: true, title: true, status: true }, orderBy: { id: 'asc' } })
    console.log(`GoPlus storefront ${sellerId}: ${rows.length} row(s) stored negotiable`)
    for (const r of rows) console.log(`  ${r.id}  [${r.status}]  ${r.title.slice(0, 70)}`)
    if (!rows.length) { console.log('nothing to do'); return }
    // Offers already sent stay answerable: accept/decline (api/conversations/[id]/offer) check the listing is active, not
    // takesOffers — only a COUNTER (a new offer) is refused once a row is not negotiable.
    const pending = await db.message.count({ where: { kind: 'offer', offerStatus: 'pending', conversation: { listingId: { in: rows.map((r) => r.id) } } } })
    console.log(`pending offers on them: ${pending} (GoPlus can still accept or decline each; no counter after the flip)`)
    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --journal-dir <durable dir> --apply.'); return }

    mkdirSync(JOURNAL_DIR!, { recursive: true }) // first, so the temp-dir check reads the REAL path, symlinks followed
    const problem = journalDirProblem(JOURNAL_DIR!)
    if (problem) throw new Error(problem)
    const ids = rows.map((r) => r.id)
    const journalPath = join(JOURNAL_DIR!, `goplus-not-negotiable-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeDurable(journalPath, JSON.stringify({ at: new Date().toISOString(), sellerId, ids } satisfies Journal, null, 1))
    fsyncDir(JOURNAL_DIR!)
    console.log(`journal: ${journalPath}`)

    const flipped = (await db.$queryRaw<{ id: string }[]>`UPDATE "Listing" SET negotiable = false WHERE id = ANY(${ids}::text[]) AND "sellerId" = ${sellerId} AND negotiable = true RETURNING id`).map((r) => r.id)
    // The undo file holds only the rows THIS update changed (a row turned off by someone else in between is not ours to undo).
    const appliedPath = journalPath.replace(/\.json$/, '.applied.json')
    writeDurable(appliedPath, JSON.stringify({ at: new Date().toISOString(), sellerId, ids: flipped } satisfies Journal, null, 1))
    fsyncDir(JOURNAL_DIR!)
    console.log(`flipped ${flipped.length} row(s) to not negotiable · ${await tombstonePdps(db, flipped)}`)
    console.log(`undo (owner's call): npx tsx scripts/goplus-not-negotiable.ts --rollback ${appliedPath} --apply`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
