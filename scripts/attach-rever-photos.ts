/**
 * Re-host the Rever reference listings' photos onto our own storage.
 * Owner, 2026-09-22: "1.100 rever yes rehost properly".
 *
 * Run (DRY by default):
 *   set -a; . ./.env; set +a; npx tsx scripts/attach-rever-photos.ts \
 *     --root /Users/mk1e3/rever_rentals_hcmc [--apply] [--limit N]
 *
 * ⛔ WHY: the 1,100 imported rows HOTLINK `photo.rever.vn` — 5,500 urls. Three costs, and the first
 * is the one the owner asked about: our watermark never appears, because `overlayMarkFromUrl()`
 * only fires for urls under `…/public/listings/affiliate/m/`. The others are that every visitor's
 * IP and Referer go to Rever, and that 1,100 live listings go blank the day Rever rotates a url or
 * blocks hotlinking. After this run the rows point at our own clean copies and the app draws the
 * mark.
 *
 * ⛔ THE MARK IS NEVER BURNED INTO THE PIXELS. `makeImageHost({ mark: 'overlay' })` stores the photo
 * CLEAN under `affiliate/m/` with the ink for both frame fits and the pixel size in the filename;
 * `ImageMark` then draws one mark at one size everywhere. A baked mark is sized off each file's own
 * width, so the square card crop cuts it off — the complaint that retired burned marks on
 * 2026-09-13 and again on 2026-09-22. Folder, filename shape and clean pixels must ALL be right or
 * the mark silently never appears. Do not hand-roll this.
 *
 * ⚠️ SOURCE IS THE LOCAL SCRAPE, NOT REVER'S CDN. Verified on 6 random pairs: the file on disk is
 * identical in dimensions and bytes to what `photo.rever.vn` serves today, so re-hosting from disk
 * is the same picture with zero load on them.
 *
 * ⛔ MAP BY URL, NEVER BY INDEX. `import-rever-rentals.ts:288` stores
 * `r.images.filter(allowedImage)`, so the DB array is a SUBSET of the scrape record's `images`,
 * while `local_images[j]` lines up with the UNFILTERED `images[j]`. Zipping the DB array against
 * `local_images` positionally therefore shifts photos onto the wrong listing the moment any url was
 * filtered — silently, and the cover photo is the one that moves. The lookup is
 * `j = rec.images.indexOf(dbUrl)` then `rec.local_images[j]`.
 * ✅ Verified across all 1,100 rows before writing this: 5,500/5,500 urls resolve to an existing
 * file, 0 length mismatches, 0 unmapped.
 *
 * ⛔ ALL-OR-NOTHING PER LISTING. Both plan reviewers refused the first design independently and
 * were right: "write if ≥1 upload succeeded" plus "skip rows already re-hosted" means a crash after
 * 2 of 5 uploads writes a 2-photo row that every later run then treats as DONE. The gallery would
 * be permanently short and nothing would ever say so. A row is rewritten only when EVERY one of its
 * photos uploaded; otherwise it is left exactly as it was and reported.
 *
 * ⛔ RAW SQL, BECAUSE `updatedAt` IS `@updatedAt` AND THE SITEMAP ORDERS BY IT. A Prisma `update`
 * would bump 1,100 rows, and `sitemap.xml/route.ts:57` emits `orderBy: { updatedAt: 'desc' }` under
 * a 45,000 cap — so this maintenance job would shove 1,100 affiliate pages to the top of the
 * sitemap, displace real sellers' listings, and tell Google they all just changed. Postgres does not
 * touch `updatedAt` on its own; only the Prisma client does.
 *
 * ⚠️ THE UPDATE IS CONDITIONAL ON THE OLD VALUE (`AND images = $old`) so an edit landing between
 * read and write is never clobbered — a row that changed is skipped and counted, not overwritten.
 *
 * ⚠️ THE JOURNAL AND MANIFEST LIVE IN /tmp, which macOS clears on reboot. They are the only record
 * of what to undo and which objects to sweep, so copy them somewhere durable if a rollback is still
 * a possibility tomorrow.
 * ⚠️ ONLY `status: 'active'` ROWS ARE TOUCHED. Hidden or retired Rever rows keep their hotlinks;
 * they are not public, and un-hiding one later leaves it looking like the pre-re-host state.
 *
 * ⚠️ WHAT THIS GIVES UP: a hotlink 404s when Rever delists a unit, which was a crude liveness
 * signal. Copies erase it. Retirement still comes from `import-rever-rentals.ts --retire`, which
 * reads a status file; nothing here replaces that.
 */
import 'dotenv/config'
import { readFileSync, existsSync, writeSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { makeImageHost } from '../src/lib/host-product-image'

/** ⛔ PINNED BY ID. `Seller.name` is user-settable and not unique — a name lookup could attach
 *  these to a real shop, who would then field the enquiries. */
const SELLER_ID = 'cmub0wead0000zrq418bqq27m'
const BUCKET = 'listings'
const REVER_HOST = 'photo.rever.vn'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
/** ⚠️ `SUPABASE_SECRET_KEY`, not `SUPABASE_SERVICE_ROLE_KEY` — guessing the latter leaves `storage`
 *  null and turns one missing credential into N per-image "failures". */
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY
const storage = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }).storage.from(BUCKET)
  : null
const host = makeImageHost({ storage, storageUrl: SUPABASE_URL ?? '', bucket: BUCKET, edge: 1600, quality: 82, mark: 'overlay' })

const argv = process.argv
const APPLY = argv.includes('--apply')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] ? argv[i + 1] : d
}
const ROOT = str('--root')
const LIMIT = Number(str('--limit', '0'))

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const BACKUP = `/tmp/rever-images-backup-${stamp}.jsonl`
const UPLOADED = `/tmp/rever-uploaded-objects-${stamp}.txt`

/**
 * Append + fsync BEFORE the row is touched, so a kill -9 cannot lose the value we are about to
 * overwrite. A buffered write would be exactly the wrong thing here.
 * ⚠️ fsync THE APPEND HANDLE, not a fresh read-only one. The first cut reopened the file `'r'` and
 * fsynced that — a different descriptor with no dirty pages of its own, so the durability this
 * function exists for was not actually being bought. A reviewer caught it.
 */
function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try {
    writeSync(fd, line + '\n')
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

async function main() {
  if (!ROOT) throw new Error('--root <scrape dir> is required')
  /** Refuse once, up front, rather than reporting N per-image failures. */
  if (APPLY && !storage) {
    throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  })

  const src: Record<string, any>[] = JSON.parse(readFileSync(join(ROOT, 'all_rentals.json'), 'utf8'))
  const byId = new Map(src.map((r) => [String(r.id), r]))

  /**
   * Only rows still fully on Rever. This is what makes a re-run free AND what makes all-or-nothing
   * safe: a row we rewrote no longer matches, and a row we skipped is still 100% rever, so it is
   * picked up next time with nothing half-done in between.
   */
  const rows = await db.listing.findMany({
    where: { sellerId: SELLER_ID, status: 'active', images: { contains: REVER_HOST } },
    select: { id: true, externalId: true, images: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  })

  const stat = {
    candidates: rows.length, rewritten: 0, uploaded: 0,
    skippedNoRecord: 0, skippedUnmapped: 0, skippedUploadFailed: 0, skippedRaced: 0, skippedMixed: 0, errored: 0,
  }
  console.log(`  rever rows still hotlinking   ${rows.length}`)
  console.log(`  mode                          ${APPLY ? 'APPLY — UPLOADS + WRITES TO PRODUCTION' : 'DRY RUN'}`)
  if (APPLY) console.log(`  rollback journal              ${BACKUP}\n  uploaded-object manifest      ${UPLOADED}`)

  for (const t of rows) {
   /**
    * ⚠️ ONE BAD ROW MUST NOT END THE RUN. A throw anywhere below — a corrupt JPEG sharp cannot
    * decode, a transient storage 5xx — would otherwise abandon every remaining listing, and the
    * operator would see a stack trace where a count belongs. The job is resumable by design
    * (candidates are "still hotlinking"), so the right response to one failure is to record it and
    * carry on. A reviewer raised this.
    */
   try {
    const oldRaw = t.images || '[]'
    const dbImgs: string[] = JSON.parse(oldRaw)
    /** A row part-way through a previous shape is not something to guess about — report it. */
    if (!dbImgs.length || !dbImgs.every((u) => u.includes(REVER_HOST))) { stat.skippedMixed++; continue }

    const rec = byId.get(String(t.externalId).replace(/^rever:/, ''))
    if (!rec) { stat.skippedNoRecord++; continue }
    const recImgs: string[] = rec.images ?? []
    const locals: string[] = rec.local_images ?? []

    /** Resolve EVERY url first. If any one cannot be mapped, this row is not touched at all. */
    const files: string[] = []
    for (const u of dbImgs) {
      const j = recImgs.indexOf(u)
      const rel = j >= 0 ? locals[j] : undefined
      const abs = rel ? join(ROOT, rel) : null
      if (!abs || !existsSync(abs)) break
      files.push(abs)
    }
    if (files.length !== dbImgs.length) { stat.skippedUnmapped++; continue }
    if (!APPLY) { stat.rewritten++; stat.uploaded += files.length; continue }

    /** Upload all before writing anything. A partial upload leaks orphans (logged) but never a
     *  short row. */
    const slug = String(t.externalId).replace(/[^a-z0-9]/gi, '-')
    const urls: string[] = []
    for (const abs of files) {
      const url = await host.fromBuffer(readFileSync(abs), slug)
      if (!url) break
      recordDurably(UPLOADED, url)
      urls.push(url)
    }
    if (urls.length !== files.length) { stat.skippedUploadFailed++; continue }

    /** ⚠️ BOTH values, and BEFORE the write. `old` is what rollback restores; `next` is what makes
     *  that rollback CONDITIONAL — a reviewer pointed out that journalling only the old value means
     *  a row whose UPDATE lost the race (or never ran) is still in the journal, and a blind replay
     *  would then overwrite whatever the real editor put there. Matching on `next` reverts exactly
     *  the rows this run wrote and nothing else. */
    const nextRaw = JSON.stringify(urls)
    recordDurably(BACKUP, JSON.stringify({ id: t.id, externalId: t.externalId, old: oldRaw, next: nextRaw }))
    /** ⛔ Raw SQL: keeps `updatedAt` still (sitemap orders by it) and makes the write conditional
     *  on the value we read, so a concurrent edit is skipped rather than clobbered. */
    const n = await db.$executeRaw`UPDATE "Listing" SET images = ${nextRaw} WHERE id = ${t.id} AND images = ${oldRaw}`
    if (n !== 1) { stat.skippedRaced++; continue }
    stat.rewritten++
    stat.uploaded += urls.length
    if (stat.rewritten % 100 === 0) console.log(`  ${stat.rewritten} listings · ${stat.uploaded} photos re-hosted`)
   } catch (e) {
    stat.errored++
    console.warn(`  ! ${t.externalId}: ${(e as Error).message.slice(0, 120)}`)
   }
  }

  console.log(`\n${JSON.stringify(stat, null, 2)}`)
  if (!APPLY) {
    console.log('\n  DRY RUN — nothing uploaded, nothing written. Re-run with --apply.')
  } else {
    const left = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active', images: { contains: REVER_HOST } } })
    console.log(`\n  rows still hotlinking rever: ${left}`)
    /**
     * ⛔ THE ROLLBACK IS PRINTED AS ONE PYTHON PROGRAM, NOT A SHELL `while read` LOOP. The first
     * version was the loop, and it failed on EVERY line: `read` without `-r` eats the backslashes
     * in the journal's escaped quotes, so `json.loads` threw before anything was restored. Both
     * reviewers flagged it and a test against a real journal confirmed it. A rollback that has
     * never been run is not a safety net, so this one is generated in a form that parses the file
     * itself and matches on `next`, restoring only rows still holding what this run wrote.
     */
    console.log(`\n  ROLLBACK — restores only the rows this run actually changed:`)
    console.log(`    python3 scripts/rever-rollback.py ${BACKUP} | psql "$DIRECT_URL" -v ON_ERROR_STOP=1`)
    console.log(`  ⚠️ Leave the uploaded objects in place until the edge cache expires, or pages`)
    console.log(`     cached against the new urls will 404. Manifest: ${UPLOADED}`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
