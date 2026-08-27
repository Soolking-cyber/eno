import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'

/**
 * SET THE SUPPLIED COVER AS EACH VINWONDERS LISTING'S FIRST IMAGE.
 *
 *   npx tsx scripts/set-vinwonders-covers.ts --dir /Users/me/VinWonders_Covers
 *   npx tsx scripts/set-vinwonders-covers.ts --dir ... --apply
 *
 * The covers arrive as large PNGs named `REGION_Park.png`. They go through the same resize,
 * watermark and WebP encode every other listing image does, and are PREPENDED — the first image is
 * what a card shows, which is the whole point of a cover.
 *
 * ⚠️ PREPENDED, NOT REPLACING. Eleven of the seventeen parks already have 5–10 photos and those stay,
 * just after the cover. Owner confirmed the card image changing is intended ("yes all").
 */

const APPLY = process.argv.includes('--apply')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const DIR = arg('dir')
if (!DIR) { console.error('--dir <folder> required'); process.exit(1) }
// ⚠️ Re-bound after the guard: `DIR` stays `string | undefined` to the checker inside the closures
// below, because narrowing does not survive into a nested function scope.
const COVERS: string = DIR
const SELLER = 'VinWonders'

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from('listings') : null
/** Covers are hero images, not thumbnails — 1600 is the listing-photo edge the app uses elsewhere. */
const host = makeImageHost({ storage, storageUrl: storageUrl ?? '', bucket: 'listings', edge: 1600, prefix: 'covers' })

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Region prefix → words that appear in a listing title for that place. */
const REGION: Record<string, string[]> = {
  HCM: ['ho chi minh', 'grand park'],
  HN: ['ocean city', 'ha noi', 'hanoi'],
  NT: ['nha trang', 'hon tam'],
  PQ: ['phu quoc'],
  HP: ['vu yen', 'hai phong'],
  HT: ['ha tinh'],
  NA: ['cua hoi', 'nghe an'],
  'HA-DN': ['nam hoi an', 'hoi an', 'da nang'],
}

/**
 * ⛔ THREE COVERS THE SCORER CANNOT REACH, AND THEY ARE WRITTEN DOWN RATHER THAN SCORED LOWER.
 * Each names its park by region code alone, so no word in the filename appears in the listing title
 * and the region hint on its own is a weak signal:
 *   HN_Aquarium-KE  — "KE" is VinKE; the title carries neither "Ocean City" nor "Hanoi"
 *   HT_VinWonders   — HT is Ha Tinh, but the listing is called "Water Park", not "VinWonders"
 *   HN_VinWonders   — the only VinWonders park left once the others are assigned
 * Lowering the threshold to catch them would also admit matches nobody checked. These three were
 * confirmed by the owner; an explicit table is the honest way to record a human decision.
 */
const OVERRIDES: Record<string, string> = {
  'HN_Aquarium-KE': 'VinKE & Vinpearl Aquarium',
  'HT_VinWonders': 'Ha Tinh Water Park',
  'HN_VinWonders': 'VinWonders Wave Park & Water Park',
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${SELLER} covers from ${COVERS}\n`)

  const seller = await db.seller.findFirst({ where: { name: SELLER }, select: { id: true } })
  if (!seller) { console.error(`storefront "${SELLER}" not found`); process.exit(1) }
  const rows = await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, images: true },
    orderBy: { title: 'asc' },
  })
  const listings = rows.map((r) => ({ ...r, t: norm(r.title) }))

  const files = fs.readdirSync(COVERS).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()

  /**
   * ⛔ SCORE EVERY PAIR, THEN ASSIGN BEST-FIRST. Walking the files in order and letting each take its
   * best remaining listing produced four wrong answers: "HN_Aquarium-KE" took "Grand World Ocean
   * City" on a weak match, so when "HN_Grand World" — a strong one for that same listing — came
   * along it was gone, and two Phu Quoc covers ended up with nothing. A strong match must never be
   * displaced by a weak one that happened to be considered first.
   */
  type Pair = { file: string; id: string; title: string; score: number }
  const pairs: Pair[] = []
  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, '')
    const forced = OVERRIDES[base]
    const [prefixRaw, ...rest] = base.split('_')
    const hints = (REGION[prefixRaw.toUpperCase()] ?? []).map(norm)
    const name = norm(rest.join(' '))
    for (const l of listings) {
      if (forced) { if (l.title === forced) pairs.push({ file: f, id: l.id, title: l.title, score: 99 }); continue }
      let score = 0
      if (hints.some((h) => l.t.includes(h))) score += 3
      for (const w of name.split(' ').filter((w) => w.length > 2)) if (l.t.includes(w)) score += 2
      if (score >= 5) pairs.push({ file: f, id: l.id, title: l.title, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const takenFile = new Set<string>(), takenListing = new Set<string>()
  const plan: Pair[] = []
  for (const p of pairs) {
    if (takenFile.has(p.file) || takenListing.has(p.id)) continue
    takenFile.add(p.file); takenListing.add(p.id); plan.push(p)
  }

  let done = 0, failed = 0
  for (const p of plan) {
    const l = listings.find((x) => x.id === p.id)!
    let current: string[] = []
    try { current = JSON.parse(l.images || '[]') } catch { current = [] }

    /**
     * ⛔ RE-RUNNABLE. Without this a second run prepends a SECOND cover and the listing carries the
     * same picture twice, with the older copy now in slot two — and nothing about the output would
     * say so. The `covers/` prefix is what this script uploads under and nothing else writes, so a
     * lead image already in that folder means the job is done for this row. A reviewer caught it
     * after the first run had already succeeded, which is exactly when it would have bitten.
     */
    if (current[0]?.includes('/covers/')) {
      console.log(`  ${p.file.padEnd(26)} → ${l.title.padEnd(36)} already has a cover, skipped`)
      continue
    }

    let hosted: string | null = null
    if (APPLY) {
      const buf = fs.readFileSync(path.join(COVERS, p.file))
      hosted = await host.fromBuffer(buf, norm(l.title).replace(/ /g, '-').slice(0, 40) || 'cover')
      if (!hosted) { failed++; console.log(`  FAILED  ${p.file}`); continue }
      await db.listing.update({ where: { id: l.id }, data: { images: JSON.stringify([hosted, ...current]) } })
    }
    done++
    const mb = (fs.statSync(path.join(COVERS, p.file)).size / 1024 / 1024).toFixed(1)
    console.log(`  ${p.file.padEnd(26)} → ${l.title.padEnd(36)} ${current.length} img → ${current.length + 1}   ${mb}MB${p.score === 99 ? '  (confirmed)' : ''}`)
  }

  const noCover = listings.filter((l) => !takenListing.has(l.id))
  const spare = files.filter((f) => !takenFile.has(f))
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${done} covers set, ${failed} failed`)
  if (noCover.length) console.log(`listings with no cover: ${noCover.map((l) => l.title).join(', ')}`)
  if (spare.length) console.log(`covers with no listing: ${spare.join(', ')}`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
