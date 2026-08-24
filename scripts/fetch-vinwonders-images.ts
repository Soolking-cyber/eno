/**
 * Pull VinWonders' official product images, deduplicate them, watermark them, and store them.
 *
 *   npx tsx scripts/fetch-vinwonders-images.ts            # DRY RUN — fetches + reports, stores nothing
 *   npx tsx scripts/fetch-vinwonders-images.ts --apply    # stores and writes the URLs into the data file
 *
 * ⚠️ RIGHTS ARE THE OWNER'S CALL, NOT THIS SCRIPT'S. These are VinWonders' promotional images,
 * pulled from the partner's own booking API. We publish them as an affiliate of that partner.
 *
 * ⛔ WHY THIS WAS REWRITTEN (owner, 2026-08-24: "some vinwonders products have duplicate images…
 * up to 10 for each" and "add our watermark"). The first version took the first N urls the API
 * mentioned and uploaded them raw. Two things were wrong with that:
 *
 *   1. THE SAME PHOTO ARRIVES UNDER SEVERAL KEYS. One ticket's payload lists a file as
 *      `thumbImage` and again as `fileUri`, sometimes with a different query string, so "the
 *      first five urls" could be three photos. The gallery showed the same train twice, which is
 *      what the owner spotted. URL-uniqueness cannot see it; only the PIXELS can, so this
 *      deduplicates on a perceptual hash of the decoded image.
 *   2. NO WATERMARK. Every other listing photo on the site is stamped; these were not, so a
 *      partner ticket's gallery was the one place a screenshot carried no eno mark at all.
 *
 * ⚠️ THE WATERMARK IS THE APP'S OWN, NOT A COPY. It cannot call storeListingImage — that module
 * and everything sharp-shaped beneath it is `server-only`, a boundary a plain script cannot cross,
 * and the last script that tried grew its own wordmark and drifted to stamping "eno" instead of
 * "eno.vn". So the parts that must not disagree — the path data, the box, the placement rule and
 * the ink threshold — are imported from src/lib/core/watermark-mark.ts, which exists for exactly
 * this. Only the sharp calls are local, and those were always going to be.
 *
 * ⚠️ THE INK IS MEASURED, NOT FIXED WHITE. scripts/watermark-existing.mjs stamps fixed white and
 * warns in its own comments that a bright photo then gets a mark you cannot see. Half this
 * catalogue is water parks and pale sky, so this probes the patch the mark will cover and asks
 * inkForLuminance for the same answer the app would give.
 *
 * The SQUARE crop is this script's own: the card grid is square and the partner ships 16:9 heroes.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { watermarkSvg, watermarkPlacement, inkForLuminance } from '../src/lib/core/watermark-mark'
import { hammingHex } from '../src/lib/image-hash-url'

const APPLY = process.argv.includes('--apply')
const MAX_PER_PRODUCT = 10
const EDGE = 1600          // matches MAX_EDGE in src/lib/core/media.ts
const WEBP_QUALITY = 82    // matches WEBP_QUALITY there too
const BUCKET = 'listings'

/**
 * How close two hashes may be and still count as the same picture.
 *
 * dHash is a 64-bit fingerprint; identical files score 0, and a re-encode or a resize of the same
 * photo lands within a few bits. Genuinely different photos of the same park sit far above this.
 * ⚠️ MEASURED, NOT PICKED: on this catalogue every true duplicate pair scored 0-2 and the closest
 * pair of DIFFERENT photos scored 14. Six is comfortably inside that gap. Raising it starts
 * discarding real photos — two views of the same blue water park slide are not one photo.
 */
const DUPLICATE_MAX_DISTANCE = 6
/** Spacing between requests to the partner's static host — it 429s a tight loop. */
const REQUEST_SPACING_MS = 350

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required to upload.')
  process.exit(1)
}
// ⛔ The retired hosted project must never receive an upload again — see the box migration.
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) {
  console.error(`Refusing to upload to ${storageUrl} — that is the retired Cloud project.`)
  process.exit(1)
}
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null

const dataPath = join(process.cwd(), 'data/vinwonders-destinations.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8'))

const IMG_RE = /"(?:fileUri|thumbImage|imageUrl|image)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
const STATIC_HOST = 'https://booking-static.vinpearl.com/'


/**
 * Turn one of the partner's image references into a fetchable https url.
 *
 * ⛔ THE API MIXES THREE SHAPES, AND ONLY TWO ARE OBVIOUS. Alongside a full `https://…` url and a
 * bare `filename.jpg`, `fileUri` often holds `booking-static.vinpearl.com/tours/…` — the host WITH
 * NO SCHEME. Prefixing the static host to that produced
 * `https://booking-static.vinpearl.com/booking-static.vinpearl.com/tours/…`, which 404s. Measured:
 * it is the majority shape in these payloads, so the naive prefix loses most of the catalogue.
 *
 * ⚠️ encodeURI, NOT encodeURIComponent — many filenames are Vietnamese with spaces, and
 * encodeURIComponent would escape the slashes too and produce a different 404.
 */
export function absoluteImageUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+/, '')
  if (/^https?:\/\//i.test(trimmed)) return encodeURI(trimmed)
  if (/^booking-static\.vinpearl\.com\//i.test(trimmed)) return encodeURI(`https://${trimmed}`)
  return encodeURI(STATIC_HOST + trimmed)
}

/**
 * Fetch with a small delay and one retry on 429.
 *
 * ⚠️ THE PARTNER RATE-LIMITS, AND IT LOOKS LIKE "NO IMAGES" RATHER THAN AN ERROR. A run without
 * this returned 429 text/html for all 329 urls and reported every product as having zero usable
 * images — a completely empty catalogue that the script would happily have written over live
 * galleries had the guard below not required a non-empty result.
 */
async function politeFetch(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS * (attempt + 1)))
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 4_000)); continue }
      return res
    } catch { /* a timeout or DNS blip is exactly what the second attempt is for */ }
  }
  return null
}

/** Every image url the partner's API mentions for a booking code, in first-seen order. */
async function partnerImages(code: string): Promise<string[]> {
  const urls = new Set<string>()
  for (const endpoint of [
    `https://booking-tour-api.vinpearl.com/api/bwc/vinwonder/vinwonderinfo?SupplierCode=${code}`,
    `https://booking-tour-api.vinpearl.com/api/bwc/vinwonder/supplierInfo/${code}`,
  ]) {
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      const body = await res.text()
      for (const m of body.matchAll(IMG_RE)) {
        urls.add(absoluteImageUrl(m[1]))
      }
    } catch { /* one endpoint failing must not lose the other's images */ }
  }
  return [...urls]
}


/**
 * Crop to the largest centred square the source contains, as a lossless PNG for storeListingImage.
 *
 * ⛔ THE SIDE IS DERIVED FROM THE SHORT EDGE, NOT SET TO `EDGE` WITH `withoutEnlargement`. That
 * pairing looks equivalent and is not: with a source shorter than EDGE on one axis, sharp honours
 * `withoutEnlargement` by scaling the width and leaving the aspect alone. Measured on the
 * partner's 1920×900 hero, it produced 1600×900 — not square. It would have shipped ~60
 * non-square images into a square grid. `min(width, height, EDGE)` crops to the largest square
 * the source actually contains and never invents pixels.
 */
async function toSquarePng(buf: Buffer): Promise<{ png: Buffer; side: number }> {
  const sharp = (await import('sharp')).default
  const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate()
  const meta = await img.metadata()
  const side = Math.min(meta.width ?? EDGE, meta.height ?? EDGE, EDGE)
  const png = await img
    .resize({ width: side, height: side, fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer()
  return { png, side }
}

/** 64-bit dHash: shrink to 9x8 greyscale, one bit per "is this pixel brighter than its right
 *  neighbour". Stable across resize/recompress, sharply different between different photos.
 *  ⚠️ THIS IS NOT THE APP'S HASH AND MUST NOT BE READ AS ONE. image-hash.ts hashes the
 *  UNCROPPED normalized image; this hashes the SQUARE CROP, so the two pipelines fingerprint
 *  different pictures and their values are not comparable. It rides in the filename only to match
 *  storeListingImage's naming convention and to make cross-product duplicates auditable from the
 *  urls alone — nothing reads it back as an app-computed hash. The COMPARISON (hammingHex) is
 *  imported from the isomorphic module so at least the distance arithmetic is shared. */
async function perceptualHash(png: Buffer): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default
    const px = await sharp(png).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
    if (px.length < 9 * 8) return null
    let hex = '', nibble = 0, count = 0
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        nibble = (nibble << 1) | (px[row * 9 + col] > px[row * 9 + col + 1] ? 1 : 0)
        if (++count === 4) { hex += nibble.toString(16); nibble = 0; count = 0 }
      }
    }
    return hex
  } catch { return null }
}

/** Stamp the eno.vn wordmark bottom-right and encode WebP — the app's geometry and ink rule. */
async function stampAndEncode(png: Buffer, side: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const { markWidth, left, top, region } = watermarkPlacement(side, side)
  let mean: number | null = null
  try {
    const { channels } = await sharp(png).extract(region).greyscale().stats()
    mean = (channels[0]?.mean ?? 0) / 255
  } catch { /* inkForLuminance(null) is white, the safe default for an average photo */ }
  const mark = watermarkSvg(markWidth, inkForLuminance(mean))
  return sharp(png).composite([{ input: mark.svg, left, top }]).webp({ quality: WEBP_QUALITY }).toBuffer()
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — up to ${MAX_PER_PRODUCT} per product, duplicates dropped at distance <= ${DUPLICATE_MAX_DISTANCE}\n`)
  let totalStored = 0, totalDupes = 0, totalCross = 0
  const thin: string[] = []
  /**
   * Every hash claimed so far, ACROSS products.
   *
   * ⛔ PER-PRODUCT DEDUP IS NOT ENOUGH, MEASURED ON THE FIRST RUN OF THIS REWRITE. Six of
   * VinWonders Vu Yen's seven photos were pixel-identical to Aquafield Ocean City's, so a Hai Phong
   * theme park advertised a Hanoi spa. The two payloads share ZERO urls — the partner publishes the
   * same picture for both venues under different filenames, which only a perceptual match can see.
   * First product to claim a photo keeps it; a later one moves on to its next candidate.
   */
  const claimed: string[] = []

  for (const dest of data.destinations) {
    if (!dest.bookingCode) { console.log(`  skip  ${dest.slug} — no booking code`); continue }
    const candidates = await partnerImages(dest.bookingCode)

    const kept: { url: string; hash: string; png: Buffer; side: number }[] = []
    let dupes = 0, cross = 0, failed = 0
    for (const src of candidates) {
      if (kept.length >= MAX_PER_PRODUCT) break
      try {
        const res = await politeFetch(src)
        if (!res || !res.ok) { failed++; if (failed <= 2) console.log(`      fetch ${res?.status ?? 'net'} ${src.slice(0, 80)}`); continue }
        const { png, side } = await toSquarePng(Buffer.from(await res.arrayBuffer()))
        const hash = await perceptualHash(png)
        // ⚠️ A HASH WE COULD NOT COMPUTE IS NOT A LICENCE TO KEEP THE IMAGE. Treating null as
        // "unique" is how a duplicate slips through on the one file sharp cannot decode; skip it.
        if (!hash) { failed++; continue }
        if (kept.some((k) => hammingHex(k.hash, hash) <= DUPLICATE_MAX_DISTANCE)) { dupes++; continue }
        if (claimed.some((h) => hammingHex(h, hash) <= DUPLICATE_MAX_DISTANCE)) { cross++; continue }
        claimed.push(hash)
        kept.push({ url: src, hash, png, side })
      } catch (e) { failed++; if (failed < 3) console.log(`      ERR ${(e as Error).message.slice(0, 120)}`) }
    }

    totalDupes += dupes
    totalCross += cross
    if (kept.length < 3) thin.push(`${dest.name} (${kept.length})`)

    if (!APPLY) {
      console.log(`  ${dest.slug.padEnd(30)} ${String(candidates.length).padStart(3)} urls -> ${String(kept.length).padStart(2)} unique  (${dupes} dupes, ${cross} another product's, ${failed} unusable)`)
      continue
    }

    const stored: string[] = []
    for (const k of kept) {
      try {
        const out = await stampAndEncode(k.png, k.side)
        // The perceptual hash rides in the filename, matching storeListingImage's convention, so
        // the duplicate guard can read it back off the stored URL without a database column.
        const name = `partner/${dest.slug}-${stored.length + 1}-${Date.now().toString(36)}-h${k.hash}.webp`
        // upsert:false + a unique name => the object is immutable, so it earns a one-year cache.
        const { error } = await storage!.upload(name, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
        if (error) { console.log(`      upload failed: ${error.message}`); continue }
        stored.push(`${storageUrl}/storage/v1/object/public/${BUCKET}/${name}`)
      } catch (e) { console.log(`      ${(e as Error).message.slice(0, 70)}`) }
    }
    // ⚠️ ONLY REPLACE WHAT WE ACTUALLY REPLACED. Writing an empty array because the partner API
    // was briefly down would strip a live product's gallery to nothing.
    if (stored.length) { dest.images = stored; totalStored += stored.length }
    console.log(`  ${dest.slug.padEnd(30)} ${String(candidates.length).padStart(3)} urls -> ${String(kept.length).padStart(2)} unique -> stored ${stored.length}  (${dupes} dupes, ${cross} another product's)`)
  }

  if (thin.length) console.log(`\n  ⚠️ fewer than 3 images, the partner API has no more: ${thin.join(', ')}`)
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${totalStored} stored, ${totalDupes} in-product duplicates and ${totalCross} cross-product duplicates dropped`)

  if (APPLY) {
    writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n')
    console.log('data/vinwonders-destinations.json updated — run scripts/set-vinwonders-images.ts to push them to the listings.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
