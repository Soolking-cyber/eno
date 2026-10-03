/**
 * Recount `Brand.listingCount` from the live catalogue (src/lib/brand-recount.ts has the why).
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/recount-brand-listings.ts                                        # DRY RUN (read-only session)
 *   npx tsx scripts/recount-brand-listings.ts --apply --journal-dir <durable dir>    # journal first, then write
 *   npx tsx scripts/recount-brand-listings.ts --rollback <journal.json> [--apply]
 *
 * ⛔ THE JOURNAL ({slug, prior, next}) IS ON DISK BEFORE ANY WRITE, and the write lands only where the stored
 * count is still the journaled prior — a publish that bumps a brand between the read and the write is not
 * overwritten (that brand is reported and the next run settles it).
 * ⚠️ /brands is ISR (6 h): the deploy's new BUILD_ID resets it; without one, allow up to 6 h. Search
 * suggestions read the column live.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { rollbackPathArg } from '../src/lib/journaled-hide'
import {
  BRAND_RECOUNT_READ_SQL, BRAND_RECOUNT_ROLLBACK_SQL, BRAND_RECOUNT_SQL, brandColumns, brandCountChanges, laterRecountJournals, splitRecountRead,
  parseBrandRecountJournal, summarizeBrandChanges, type BrandRecountJournal,
} from '../src/lib/brand-recount'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (f: string) => { const i = argv.indexOf(f); const v = i >= 0 ? argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : null }
const JOURNAL_DIR = str('--journal-dir')
const { path: ROLLBACK, error: rollbackError } = rollbackPathArg(process.argv)
if (rollbackError) { console.error(rollbackError.replace('scripts/journals/<file>.json', '<brand-recount journal>.json')); process.exit(1) }

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }),
  log: ['warn', 'error'],
})

function durableDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  return abs
}

/** The file AND its directory entry are fsynced before the database is touched (commit-gate review). */
function writeDurably(file: string, text: string) {
  const fd = openSync(file, 'wx')
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  const dfd = openSync(dirname(file), 'r')
  try { fsyncSync(dfd) } finally { closeSync(dfd) }
}

async function recount() {
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  const dir = APPLY ? durableDir(JOURNAL_DIR!) : null
  const { brands, live } = splitRecountRead(await db.$queryRawUnsafe<{ slug: string; listingCount: number; live: number }[]>(BRAND_RECOUNT_READ_SQL))
  const changes = brandCountChanges(brands, live)
  const s = summarizeBrandChanges(changes)
  const positive = brands.filter((b) => Number(b.listingCount) > 0).length
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — Brand.listingCount := verified active listings per brandSlug\n`)
  console.log(`${brands.length} brands · ${positive} show a positive count today · Σ stored ${brands.reduce((n, b) => n + Number(b.listingCount), 0)} vs Σ live ${live.filter((l) => brands.some((b) => b.slug === l.slug)).reduce((n, l) => n + Number(l.n), 0)}`)
  console.log(`${s.brands} brand(s) change: ${s.down} down (${s.toZero} to zero), ${s.up} up · Σ over the changed brands ${s.priorTotal} → ${s.nextTotal}\n`)
  console.log('largest changes:')
  for (const c of changes.slice(0, 25)) console.log(`  ${c.slug.padEnd(28)} ${String(c.prior).padStart(6)} → ${String(c.next).padStart(6)}`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply --journal-dir <durable dir>.'); return }
  if (!changes.length) { console.log('\nnothing to change.'); return }

  const journal: BrandRecountJournal = { kind: 'brand-recount', createdAt: new Date().toISOString(), rows: changes }
  const file = join(dir!, `brand-recount-${journal.createdAt.replace(/[:.]/g, '-')}.json`)
  writeDurably(file, JSON.stringify(journal, null, 1))
  console.log(`\njournal written: ${file}`)
  const done = await db.$queryRawUnsafe<{ slug: string }[]>(BRAND_RECOUNT_SQL, ...brandColumns(changes))
  console.log(`UPDATED ${done.length} of ${changes.length} (a brand bumped since the read is skipped — re-run to settle it).`)
  console.log(`ROLLBACK: npx tsx scripts/recount-brand-listings.ts --rollback ${file} --apply`)
}

async function rollback(path: string) {
  const journal = parseBrandRecountJournal(readFileSync(path, 'utf8'))
  const dir = dirname(resolve(path))
  const siblings = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
    try { return { name: n, text: readFileSync(join(dir, n), 'utf8') } } catch { return { name: n, text: '' } }
  })
  const later = laterRecountJournals({ name: basename(path), createdAt: journal.createdAt }, siblings)
  if (later.length) throw new Error(`refusing — a LATER recount sits beside this journal (${later.join(', ')}); roll that back first, or this would write over it`)
  const cols = brandColumns(journal.rows)
  const still = await db.$queryRawUnsafe<{ slug: string }[]>(
    `SELECT b.slug FROM "Brand" b JOIN unnest($1::text[], $2::int[], $3::int[]) AS j(slug, prior, next) ON b.slug = j.slug WHERE b."listingCount" = j.next`, ...cols)
  console.log(`journal ${path}: ${journal.rows.length} brand(s) recounted at ${journal.createdAt}; ${still.length} still hold the recounted value → restorable`)
  if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); return }
  const done = await db.$queryRawUnsafe<{ slug: string }[]>(BRAND_RECOUNT_ROLLBACK_SQL, ...cols)
  console.log(`RESTORED ${done.length} brand count(s).`)
}

;(ROLLBACK ? rollback(ROLLBACK) : recount())
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
