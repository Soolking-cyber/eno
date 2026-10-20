/**
 * DELETE THE GoPLUS FIRST IMPORT'S UNMARKED PHOTO COPIES — once no listing references them.
 *
 *   DRY (read-only DB session; lists storage; deletes nothing):
 *     set -a; . ./.env; set +a; npx tsx scripts/goplus-legacy-photos.ts
 *   DELETE (journal first):
 *     … scripts/goplus-legacy-photos.ts --journal-dir <durable dir> --apply
 *
 * Owner, 2026-10-20: "why goplus apartments dont have eno.vn wordmark". The first GoPlus import (2026-10-20, before
 * aa7eaacf1) stored its photos UNMARKED under listings/partner/goplus/<source key>-h<dHash>.webp. The importer now stores
 * them in the app-drawn overlay folder (goplus-listing.ts goplusOverlaySlug) and re-hosts a legacy gallery once
 * (goplusPhotoAction). The migrated rooms leave their legacy copies behind — ~2.5 GB, still publicly fetchable at their
 * old URLs WITHOUT the eno.vn mark. This removes them, and only them.
 *
 * ⛔ ONLY OBJECTS NOTHING REFERENCES, decided in ONE database pass: every Listing image/video URL, every Seller avatar or
 * banner and every Profile avatar that contains `/listings/partner/goplus/` is read once (the same five columns
 * core/storage-purge.ts isStillReferenced checks, so this never disagrees with the app's own erasure rule); an object
 * whose public path appears there is KEPT. Everything else under the folder is deleted. Not the nightly tombstone sweep:
 * that runs five full-table `contains` scans PER OBJECT — ~85,000 scans for ~17,000 photos.
 * ⛔ REFUSED WHILE AN OLD-CODE IMPORT RUNS: the first import (old code) is the only writer of this folder; a run in progress
 * can reference a legacy object between this script's read and its delete. `pgrep -f import-goplus` must find nothing.
 * ⛔ ONLY THIS FOLDER, ONLY THE IMPORTER'S NAME SHAPE (`<16 hex>[-h<16 hex>].webp`): a different name is never touched.
 * Journal: every name is fsynced to <journal-dir>/goplus-legacy-photos-<time>.txt BEFORE its batch is deleted. There is
 * no undo — the overlay copies are what the listings show; these are the unmarked duplicates the owner asked to drop.
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { GOPLUS_PHOTO_PREFIX } from '../src/lib/goplus-listing'

const argv = process.argv.slice(2)
const KNOWN = new Set(['--apply', '--journal-dir'])
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) throw new Error(`unknown argument "${argv[i]}"`)
  if (argv[i] === '--journal-dir') i++
}
const APPLY = argv.includes('--apply')
const JI = argv.indexOf('--journal-dir')
const JOURNAL_DIR = JI >= 0 ? argv[JI + 1] : null
if (APPLY && (!JOURNAL_DIR || JOURNAL_DIR.startsWith('--'))) throw new Error('--apply needs --journal-dir <durable dir>')
/** Durable means not a temp dir — judged on the REAL path (a symlink into /tmp is still /tmp), macOS's $TMPDIR included. */
function journalDirProblem(dir: string): string | null {
  const real = (() => { try { return realpathSync(dir) } catch { return resolve(dir) } })()
  return /^\/(private\/)?(tmp|var\/folders)\b/.test(real) ? `--journal-dir ${real} is a temp dir — use a durable one` : null
}

/** The importer's legacy object name: `<16 hex source key>[-h<16 hex dHash>].webp` (the only shape ever written there). */
const LEGACY_NAME = /^[0-9a-f]{16}(?:-h[0-9a-f]{16})?\.webp$/

/** true = an import is running; ⛔ any failure to ASK (pgrep missing, an error) also refuses — never "none running". */
function importRunning(): boolean {
  try { return execFileSync('pgrep', ['-f', 'import-goplus'], { encoding: 'utf8' }).trim().length > 0 } catch (e) {
    if ((e as { status?: number }).status === 1) return false // pgrep's documented "no process matched"
    throw new Error(`could not check for a running import (${(e as Error).message}) — refusing`)
  }
}
function fsyncDir(dir: string) { const fd = openSync(dir, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } }

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY
  const cs = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url || !key || !cs) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL unset — `set -a; . ./.env; set +a` first')
  if (APPLY && importRunning()) throw new Error('an import-goplus run is in progress — wait for it to finish (it may reference a legacy photo between the read and the delete)')

  const folder = `${GOPLUS_PHOTO_PREFIX}/`
  const marker = `/storage/v1/object/public/listings/${folder}`
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: cs, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    // ── ONE pass over the five columns the app's own erasure rule checks ──
    const like = `%${marker}%`
    const rows = await db.$queryRaw<{ v: string | null }[]>`
      SELECT images AS v FROM "Listing" WHERE images LIKE ${like}
      UNION ALL SELECT video FROM "Listing" WHERE video LIKE ${like}
      UNION ALL SELECT "avatarUrl" FROM "Seller" WHERE "avatarUrl" LIKE ${like}
      UNION ALL SELECT "bannerUrl" FROM "Seller" WHERE "bannerUrl" LIKE ${like}
      UNION ALL SELECT "avatarUrl" FROM "Profile" WHERE "avatarUrl" LIKE ${like}`
    const referenced = new Set<string>()
    const nameRe = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([0-9a-f]{16}(?:-h[0-9a-f]{16})?\\.webp)`, 'g')
    for (const r of rows) for (const m of (r.v ?? '').matchAll(nameRe)) referenced.add(m[1])

    // ── the folder, paged ──
    const all: { name: string; size: number }[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.storage.from('listings').list(GOPLUS_PHOTO_PREFIX, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`storage list failed at offset ${offset}: ${error.message}`)
      if (!data?.length) break
      for (const o of data) all.push({ name: o.name, size: Number((o.metadata as { size?: number } | null)?.size ?? 0) })
      if (data.length < 1000) break
    }
    const ours = all.filter((o) => LEGACY_NAME.test(o.name))
    const strange = all.length - ours.length
    const drop = ours.filter((o) => !referenced.has(o.name))
    const bytes = drop.reduce((a, o) => a + o.size, 0)
    console.log(`folder            listings/${folder}: ${all.length} objects (${strange} in another name shape — never touched)`)
    console.log(`referenced        ${referenced.size} legacy photos still referenced (kept)`)
    console.log(`${APPLY ? 'DELETE' : 'would delete'}      ${drop.length} unreferenced legacy photos · ${(bytes / 1e9).toFixed(2)} GB`)
    // So whoever runs it can see the matching works before --apply.
    for (const o of drop.slice(0, 5)) console.log(`  e.g. delete  ${GOPLUS_PHOTO_PREFIX}/${o.name}`)
    const keptSample = ours.find((o) => referenced.has(o.name))
    if (keptSample) console.log(`  e.g. keep    ${GOPLUS_PHOTO_PREFIX}/${keptSample.name} (a listing still shows it)`)
    if (!APPLY) { console.log('\nDRY RUN — nothing deleted. Re-run with --journal-dir <durable dir> --apply.'); return }

    mkdirSync(resolve(JOURNAL_DIR!), { recursive: true })
    const jp = journalDirProblem(JOURNAL_DIR!)
    if (jp) throw new Error(jp)
    const dir = realpathSync(resolve(JOURNAL_DIR!))
    const journal = join(dir, `goplus-legacy-photos-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
    let deleted = 0, failed = 0
    for (let i = 0; i < drop.length; i += 100) {
      const batch = drop.slice(i, i + 100).map((o) => `${GOPLUS_PHOTO_PREFIX}/${o.name}`)
      // ⛔ On disk, fsynced, BEFORE the batch goes.
      // …and before EACH batch, no import may have started since the read (a reviewer's catch: one check was a TOCTOU).
      if (importRunning()) throw new Error(`an import-goplus run started — stopped after ${deleted} deletions; re-run when it is done`)
      const first = i === 0
      const fd = openSync(journal, 'a'); try { writeSync(fd, batch.join('\n') + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
      if (first) fsyncDir(dir) // the journal's directory entry too, the first time the file appears
      const { data, error } = await sb.storage.from('listings').remove(batch)
      if (error) { failed += batch.length; console.warn(`  ! batch at ${i}: ${error.message}`); continue }
      deleted += data?.length ?? 0
    }
    console.log(`DELETED           ${deleted}${failed ? ` · ${failed} FAILED (re-run: a deleted object is simply gone from the list)` : ''} · journal ${journal}`)
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
