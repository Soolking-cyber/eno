import 'dotenv/config'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'

/**
 * REMOVE IMAGES THAT ARE THE SAME PICTURE UNDER A DIFFERENT URL.
 *
 *   npx tsx scripts/dedupe-listing-images.ts --seller "BỀN COMPUTER"
 *   npx tsx scripts/dedupe-listing-images.ts --seller "BỀN COMPUTER" --apply
 *
 * ⛔ WHY THIS EXISTS: scripts/enrich-ben.ts hosted each product page's gallery starting at index 0,
 * and a page's first gallery image IS the feed's primary shot — already hosted when the listing was
 * imported. Re-hosting it produced a second copy at a new URL, so every enriched listing led with
 * the same photograph twice. Measured after the fact: 25 of 25 sampled listings had
 * `sha256(images[0]) === sha256(images[1])`. The enrichment script's own comment said not to do
 * this; the slice did it anyway.
 *
 * ⛔ HASHES, NOT URLS. The duplicates have different URLs by construction — that is the whole
 * failure — so comparing strings finds nothing. Only the bytes tell the truth.
 *
 * ⚠️ FIRST OCCURRENCE WINS, so the cover never moves. Order is otherwise preserved.
 * ⚠️ The orphaned objects are deleted from storage too, but only ones this pass removed AND that no
 * other listing still references — an image shared between two listings is not an orphan.
 */

const APPLY = process.argv.includes('--apply')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const SELLER = arg('seller')
if (!SELLER) { console.error('--seller "<name>" required'); process.exit(1) }
const SELLER_NAME: string = SELLER

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
const storage = APPLY && storageUrl && secret
  ? createClient(storageUrl, secret, { auth: { persistSession: false } }).storage.from('listings')
  : null

const hashOf = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return null
    return crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')
  } catch { return null }
}

/** `…/object/public/listings/affiliate/x.webp` → `affiliate/x.webp`, the key storage deletes by. */
const objectKey = (url: string): string | null => {
  const m = /\/object\/public\/listings\/(.+)$/.exec(url)
  return m ? m[1] : null
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — de-duplicating images for ${SELLER_NAME}\n`)

  const seller = await db.seller.findFirst({ where: { name: SELLER_NAME }, select: { id: true } })
  if (!seller) { console.error(`storefront "${SELLER_NAME}" not found`); process.exit(1) }
  const listings = await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, images: true },
    orderBy: { title: 'asc' },
  })

  /**
   * ⚠️ REFERENCES ARE COUNTED ACROSS THIS SELLER'S LISTINGS, NOT THE WHOLE CATALOGUE — the query
   * above is seller-scoped, and an earlier version of this comment claimed otherwise. Counting one
   * row alone would be plainly wrong (a file another listing shows would go), and this is the
   * cheap middle: it catches the realistic case, which is one merchant's own listings sharing a
   * shot.
   * ⚠️ WHY THAT IS SAFE HERE, MEASURED RATHER THAN ASSUMED: every uploaded object carries a random
   * per-upload suffix in its path, so two sellers cannot arrive at the same URL. After the first
   * run deleted 257 objects, 1,152 images sampled across ALL sellers still returned 200 — zero
   * broken. ⛔ If a future caller ever uploads deterministic paths, widen this count before running.
   */
  const refCount = new Map<string, number>()
  for (const l of listings) {
    let imgs: string[] = []
    try { imgs = JSON.parse(l.images || '[]') } catch { imgs = [] }
    for (const u of imgs) refCount.set(u, (refCount.get(u) ?? 0) + 1)
  }

  let touched = 0, removed = 0, deleted = 0, unreadable = 0
  for (const l of listings) {
    let imgs: string[] = []
    try { imgs = JSON.parse(l.images || '[]') } catch { imgs = [] }
    if (imgs.length < 2) continue

    const seen = new Map<string, string>()   // hash → the url that claimed it
    const keep: string[] = []
    const drop: string[] = []
    for (const u of imgs) {
      const h = await hashOf(u)
      // ⚠️ An image we cannot read is KEPT. A transient 500 must never be the reason a listing
      // loses a photo — the only safe direction when the evidence is missing.
      if (!h) { unreadable++; keep.push(u); continue }
      if (seen.has(h)) { drop.push(u); continue }
      seen.set(h, u)
      keep.push(u)
    }
    if (!drop.length) continue

    touched++; removed += drop.length
    console.log(`  ${String(imgs.length).padStart(2)} → ${String(keep.length).padStart(2)}   ${l.title.slice(0, 52)}`)

    if (APPLY) {
      await db.listing.update({ where: { id: l.id }, data: { images: JSON.stringify(keep) } })
      const orphans = drop.filter((u) => (refCount.get(u) ?? 0) <= 1).map(objectKey).filter((k): k is string => !!k)
      if (orphans.length && storage) {
        const { error } = await storage.remove(orphans)
        if (!error) deleted += orphans.length
      }
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${touched} listings changed · ${removed} duplicate images removed · ${deleted} objects deleted from storage · ${unreadable} images kept because they could not be read`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
