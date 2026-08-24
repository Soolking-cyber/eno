/**
 * Pull the partner's own product photography, square it, and store it in our listings bucket.
 *
 *   npx tsx scripts/fetch-vinwonders-images.ts            # DRY RUN — fetches + reports, uploads nothing
 *   npx tsx scripts/fetch-vinwonders-images.ts --apply    # uploads and writes the URLs into the data file
 *
 * ⚠️ RIGHTS ARE THE OWNER'S CALL, NOT THIS SCRIPT'S. These are VinWonders' promotional images,
 * pulled from the partner's own public booking API. Affiliate programmes normally grant creative
 * use for exactly this purpose; the owner confirmed on 2026-08-24. If that ever changes, delete the
 * uploaded objects and the URLs in data/vinwonders-destinations.json.
 *
 * ⛔ IMAGES MUST LIVE ON OUR OWN STORAGE, NOT HOTLINKED. The CSP pins `img-src` to our Supabase
 * origin, so a booking-static.vinpearl.com URL would render as a broken image — and hotlinking
 * would also put our page's load-time and their bandwidth in each other's hands.
 *
 * ⚠️ SQUARE, BECAUSE THE CARD IS SQUARE. listing-card.tsx renders `aspect-square`, so a 1920x900
 * hero would be centre-cropped by CSS at display time with no say over what survives. Cropping here
 * makes the stored asset match the surface it is designed for, and keeps the gallery and the card
 * showing the same framing.
 *
 * ⚠️ NO WATERMARK, UNLIKE storeListingImage's DEFAULT — deliberately. The eno wordmark exists so a
 * SELLER's photo stays attributable when it is scraped and re-shared. These are the partner's own
 * creatives; stamping our mark on them claims authorship we do not have, and modifying a partner's
 * artwork is a separate permission from displaying it. Encoding otherwise matches
 * src/lib/core/media.ts (WebP q82, longest edge 1600, immutable one-year cache).
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const MAX_PER_PRODUCT = 5
const EDGE = 1600          // matches MAX_EDGE in src/lib/core/media.ts
const WEBP_QUALITY = 82    // matches WEBP_QUALITY there too
const BUCKET = 'listings'
const API = 'https://booking-tour-api.vinpearl.com/api/bwc/vinwonder'

const dataPath = new URL('../data/vinwonders-destinations.json', import.meta.url)
const data = JSON.parse(readFileSync(dataPath, 'utf8'))

const IMG_RE = /"(?:fileUri|thumbImage|imageUrl|image)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi

/** Every distinct image the partner publishes for one supplier code, best-effort across both
 *  endpoints — `vinwonderinfo` carries the ticket galleries, `supplierInfo` the venue hero, and
 *  two of the seventeen (Grand Park, the Ocean City theatre) return nothing from the first. */
async function partnerImages(code: string): Promise<string[]> {
  const urls = new Set<string>()
  for (const path of [`vinwonderinfo?PageIndex=1&PageSize=100&SupplierCode=${code}`, `supplierInfo/${code}`]) {
    try {
      const res = await fetch(`${API}/${path}`)
      if (!res.ok) continue
      const text = await res.text()
      for (const m of text.matchAll(IMG_RE)) {
        const raw = m[1].trim()
        if (!raw) continue
        const abs = raw.startsWith('http') ? raw : `https://${raw.replace(/^\/+/, '')}`
        // ⚠️ ENCODE THE PATH. The partner's filenames contain spaces and Vietnamese diacritics
        // ("…_Ảnh màn hình 2025-08-06 lúc 10.32.05.png"), and fetch() rejects a raw space. encodeURI
        // leaves an already-encoded URL alone, so this is safe to apply unconditionally.
        urls.add(encodeURI(abs))
      }
    } catch { /* one endpoint failing must not lose the other's images */ }
  }
  return [...urls]
}

/**
 * Centre-cropped square WebP.
 *
 * ⛔ THE SIDE IS DERIVED FROM THE SHORT EDGE, NOT SET TO `EDGE` WITH `withoutEnlargement`. That
 * obvious spelling silently does not produce a square: measured on the partner's own 1920x900
 * theatre hero, `resize({ width: 1600, height: 1600, fit: 'cover', withoutEnlargement: true })`
 * returned **1600x900** — the flag forbids the upscale the square would have required, so sharp
 * scales the width and leaves the aspect alone. It would have shipped ~60 non-square images that
 * the square card then crops again at display time.
 *
 * `min(width, height, EDGE)` crops to the largest square the source actually contains and never
 * enlarges, so no flag is needed and the result is square by construction. `cover` keeps the
 * subject filling the frame; `contain` would letterbox a wide hero into white bars.
 */
async function toSquareWebp(buf: Buffer): Promise<Buffer> {
  const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate()
  // After .rotate() the metadata reflects the EXIF-corrected orientation, so a portrait phone
  // photo is not measured on its stored (landscape) dimensions.
  const meta = await img.metadata()
  const side = Math.min(meta.width ?? EDGE, meta.height ?? EDGE, EDGE)
  return img
    .resize({ width: side, height: side, fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const key = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!url || !key)) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required to upload.')
  process.exit(1)
}
if (APPLY && /supabase\.co$/.test(new URL(url!).hostname)) {
  console.error(`Refusing to upload to ${url} — that is the retired Cloud project.`)
  process.exit(1)
}
const storage = APPLY ? createClient(url!, key!, { auth: { persistSession: false } }).storage.from(BUCKET) : null

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — target ${url ?? '(none)'}, max ${MAX_PER_PRODUCT} per product\n`)
  let totalUploaded = 0
  const empty: string[] = []

  for (const dest of data.destinations) {
    if (!dest.bookingCode) { console.log(`  skip  ${dest.slug} — no booking code`); continue }
    const found = await partnerImages(dest.bookingCode)
    const picked = found.slice(0, MAX_PER_PRODUCT)
    if (!picked.length) { empty.push(dest.name); console.log(`  ⛔ ${dest.slug.padEnd(30)} no images found`); continue }

    if (!APPLY) {
      console.log(`  ${dest.slug.padEnd(30)} ${found.length} found -> would store ${picked.length}`)
      continue
    }

    const stored: string[] = []
    for (const src of picked) {
      try {
        const res = await fetch(src)
        if (!res.ok) { console.log(`      fetch ${res.status} ${src.slice(0, 70)}`); continue }
        const out = await toSquareWebp(Buffer.from(await res.arrayBuffer()))
        const name = `partner/${dest.slug}-${stored.length + 1}-${Date.now().toString(36)}.webp`
        // upsert:false + a unique name => the object is immutable, so it earns a one-year cache.
        const { error } = await storage!.upload(name, out, {
          contentType: 'image/webp', upsert: false, cacheControl: '31536000',
        })
        if (error) { console.log(`      upload failed: ${error.message}`); continue }
        stored.push(`${url}/storage/v1/object/public/${BUCKET}/${name}`)
      } catch (e) {
        console.log(`      ${(e as Error).message.slice(0, 70)}`)
      }
    }
    dest.images = stored
    totalUploaded += stored.length
    console.log(`  ${dest.slug.padEnd(30)} ${found.length} found -> stored ${stored.length}`)
  }

  if (empty.length) console.log(`\n  no images for: ${empty.join(', ')}`)

  if (APPLY) {
    writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n')
    console.log(`\nUploaded ${totalUploaded} image(s); data/vinwonders-destinations.json updated.`)
  } else {
    console.log('\nDry run only. Re-run with --apply to upload and write the URLs.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
