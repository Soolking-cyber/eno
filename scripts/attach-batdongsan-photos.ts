/**
 * Attach the downloaded Batdongsan property photos to their imported listings.
 * Owner, 2026-09-22: "its ok if its watermarked add our watermark on top", "all batdongsan
 * properties should have property image".
 *
 * Run (DRY by default):
 *   set -a; . ./.env; set +a; npx tsx scripts/attach-batdongsan-photos.ts \
 *     --src <all_rentals.json> --images <images dir> [--apply] [--limit N]
 *
 * ⛔ THE 200x200 FILES ARE THE ESTATE AGENT'S HEADSHOT AND ARE NEVER UPLOADED. 9,419 of the 31,734
 * downloaded files are `img_2.jpg` — a photograph of a real, identifiable person, which Vietnam's
 * PDPD (Decree 13/2023) treats as personal data requiring consent. This is the one part of this job
 * that is NOT the owner's risk to accept: the agent is a third party who never agreed to appear on
 * eno.vn. TWO independent guards, because the naming convention alone is not a fact about content:
 * the filename must not be `img_2`, AND the decoded dimensions must not be 200x200.
 *
 * ⛔ THE eno.vn MARK IS NEVER BURNED IN — THE APP DRAWS IT. First cut of this script baked the
 * wordmark into the pixels and stored under `listings/bds/`, and the owner caught it immediately:
 * "the watermarks dont land cleanly". A burned mark is sized off EACH FILE's own width and
 * anchored to EACH FILE's own corner, so the square card crop cuts it off, hides it or shrinks it
 * — the exact complaint that retired burned marks on 2026-09-13 ("one has big small other
 * missing"). `makeImageHost({ mark: 'overlay' })` stores the photo CLEAN under `affiliate/m/` with
 * the ink for BOTH frame fits and the pixel size encoded in the filename, and `ImageMark` then
 * draws it at one size and one corner everywhere. THREE things must be right or the mark silently
 * never appears: the folder, the filename shape, and clean pixels. Do not hand-roll this.
 *
 * ⚠️ THE RIVAL WATERMARK STAYS VISIBLE, and the owner chose that. 64.1% of these photos carry a
 * burned-in "Batdongsan.com.vn by PropertyGuru" or agency mark. Nothing can remove what is already
 * in the pixels; our overlay sits alongside it.
 *
 * ⚠️ WHY THE LOCAL FILES AND NOT THE CDN. batdongsan's image CDN only serves `crop/232x186`
 * (and some `crop/115x64`) — unusable in a card, which is why the first import shipped with no
 * images at all. The downloaded files are ~745x510, which is card-adequate. The cost is that these
 * are COPIES in our own storage rather than hotlinks, unlike the Rever import.
 *
 * ⚠️ RESUMABLE AND IDEMPOTENT: a listing that already has images is skipped, so a re-run after a
 * crash costs nothing and cannot double-upload. ~22,300 files, ≈0.93 GB stored, ≈90 min.
 */
import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { makeImageHost } from '../src/lib/host-product-image'

const SELLER_ID = 'bds-vn-import-seller-0001'
const BUCKET = 'listings'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
/** ⚠️ `SUPABASE_SECRET_KEY` — the name the app's own supabase-admin and
 *  fetch-vinwonders-images use. Guessing `SUPABASE_SERVICE_ROLE_KEY` left `storage` null and
 *  every upload counted as a per-image failure instead of refusing to run. */
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY
const storage = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }).storage.from(BUCKET)
  : null
/** ⛔ mark:'overlay' is the DEFAULT and must stay — see the header. */
const host = makeImageHost({ storage, storageUrl: SUPABASE_URL ?? '', bucket: BUCKET, edge: 1600, quality: 82, mark: 'overlay' })

const argv = process.argv
const APPLY = argv.includes('--apply')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] ? argv[i + 1] : d
}
const SRC = str('--src')
const IMAGES = str('--images')
const LIMIT = Number(str('--limit', '0'))

/** ⛔ Headshot guard #1 — the filename. #2 (decoded dimensions) is applied per file below. */
const isHeadshotName = (p: string) => /(^|\/)img_2\.jpe?g$/i.test(p)

async function dimsOf(buf: Buffer): Promise<{ w: number; h: number } | null> {
  try {
    const sharp = (await import('sharp')).default
    const m = await sharp(buf).metadata()
    return m.width && m.height ? { w: m.width, h: m.height } : null
  } catch { return null }
}

async function main() {
  if (!SRC || !IMAGES) throw new Error('--src <all_rentals.json> and --images <dir> are required')
  /**
   * ⛔ REFUSE TO START WITHOUT STORAGE, rather than reporting N per-image failures. The first run
   * of this script read the wrong env var name, so `storage` was null and the summary said
   * "failed: 12" — which reads like twelve bad JPEGs, not one missing credential. A precondition
   * that can only fail one way should say so once, up front.
   */
  if (APPLY && !storage) {
    throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  })

  const src: Record<string, any>[] = JSON.parse(readFileSync(SRC, 'utf8'))
  const byExternal = new Map(src.map((r) => [`bds:${r.code}`, r]))

  /** Only rows that still have NO images — this is what makes a re-run free. */
  const targets = await db.listing.findMany({
    where: { sellerId: SELLER_ID, OR: [{ images: '[]' }, { images: '' }] },
    select: { id: true, externalId: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  })

  const stat = { listings: 0, uploaded: 0, skippedHeadshot: 0, skipped200: 0, missingFile: 0, failed: 0, noneUsable: 0 }
  console.log(`seller rows without images   ${targets.length}`)
  console.log(`mode                         ${APPLY ? 'APPLY — UPLOADS + WRITES TO PRODUCTION' : 'DRY RUN'}`)

  for (const t of targets) {
    const row = t.externalId ? byExternal.get(t.externalId) : undefined
    if (!row) continue
    const paths: string[] = (row.local_images ?? []).filter((p: string) => !isHeadshotName(p))
    stat.skippedHeadshot += (row.local_images ?? []).length - paths.length

    const urls: string[] = []
    for (const rel of paths) {
      const abs = join(IMAGES, rel.replace(/^images\//, ''))
      if (!existsSync(abs)) { stat.missingFile++; continue }
      const buf = readFileSync(abs)
      const d = await dimsOf(buf)
      /**
       * ⛔ Headshot guard #2 — content, not naming — AND IT FAILS CLOSED. A 200x200 square is the
       * avatar transform. The first cut read `if (d && …)`, so a file sharp could not decode
       * skipped the check entirely and any headshot not named `img_2` would have been published.
       * A guard protecting a real person's likeness must refuse on doubt, not wave it through.
       * ⚠️ This guard is not theatre: on the full run it caught 2,496 avatars the FILENAME missed.
       */
      if (!d || (d.w === 200 && d.h === 200)) { stat.skipped200++; continue }
      if (!APPLY) { urls.push('(would upload)'); continue }
      const url = await host.fromBuffer(buf, t.externalId!.replace(/[^a-z0-9]/gi, '-'))
      if (!url) { stat.failed++; continue }
      urls.push(url)
      stat.uploaded++
    }

    if (!urls.length) { stat.noneUsable++; continue }
    stat.listings++
    if (APPLY) {
      await db.listing.update({ where: { id: t.id }, data: { images: JSON.stringify(urls) } })
      if (stat.listings % 250 === 0) console.log(`  ${stat.listings} listings · ${stat.uploaded} photos uploaded`)
    }
  }

  console.log(`\n${JSON.stringify(stat, null, 2)}`)
  if (!APPLY) console.log('\nDRY RUN — nothing uploaded, nothing written. Re-run with --apply.')
  else {
    const withImg = await db.listing.count({ where: { sellerId: SELLER_ID, NOT: { images: '[]' } } })
    const total = await db.listing.count({ where: { sellerId: SELLER_ID } })
    console.log(`\nbatdongsan listings with photos: ${withImg}/${total}`)
    console.log(`\nROLLBACK (clears the attachments, leaves the listings):`)
    console.log(`  UPDATE "Listing" SET images = '[]' WHERE "sellerId" = '${SELLER_ID}';`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
