import { cardMarkRegion, inkForGreyPixels, inkForLuminance, watermarkPlacement, watermarkSvg } from './core/watermark-mark'
import { overlayImagePath } from './image-mark-url'

/**
 * FETCH A MERCHANT'S PRODUCT SHOT, WATERMARK IT, AND PUT IT IN OUR OWN BUCKET.
 *
 * ⚠️ EXTRACTED FROM scripts/import-accesstrade.ts SO A SECOND SCRIPT CAN USE IT. That script calls
 * `main()` at module load, so importing anything out of it would run a full catalogue import as a
 * side effect. The behaviour here is the importer's, unchanged — it is the same function, moved.
 *
 * ⛔ NO SQUARE CROP. This once read `side = min(width, height, EDGE)` with `fit: 'cover'`, which
 * takes a centre square out of every image — a 1200x600 banner lost half its width and the text on
 * it was sliced through the middle. Owner, 2026-08-25: "we have to import images without cropping
 * since most products have broken bad looking images." `fit: 'inside'` + `withoutEnlargement` keeps
 * the whole frame and never upscales a small one.
 *
 * ⚠️ `.rotate()` BEFORE READING THE SIZE, and the swap below is why: a JPEG carrying EXIF
 * orientation ≥5 reports its width and height the wrong way round, so scaling from the raw metadata
 * produces a letterboxed or squashed result on exactly the phone-camera images that need it least.
 *
 * ⚠️ FAILS TO null, NEVER THROWS. A merchant CDN 404, a timeout, an image sharp cannot decode — all
 * of it means "this listing has one fewer photo", not "the run dies at product 812".
 */
export type ProductImageStorage = {
  upload(
    path: string,
    body: Buffer,
    opts: { contentType: string; upsert: boolean; cacheControl: string },
  ): Promise<{ error: unknown }>
}

export function makeImageHost(deps: {
  storage: ProductImageStorage | null
  storageUrl: string
  bucket: string
  /** Longest edge. Product shots are smaller than a listing photo's 1600 — there are thousands. */
  edge?: number
  quality?: number
  /** Folder inside the bucket. Ignored in `overlay` mode, which always writes under `affiliate/m/`. */
  prefix?: string
  /**
   * `'overlay'` (the DEFAULT since 2026-09-13): store the photo CLEAN, under `affiliate/m/`, with what
   * the app-drawn mark needs measured now and written into the filename (image-mark-url.ts). The owner
   * picked the overlay so the mark is one size and one corner on every card, PDP and map popup — a
   * burned mark is sized off each file and the square card crop cut it off or shrank it. As the
   * default, every NEW import lands clean and marked by the app, so the inconsistency cannot creep
   * back in through the next catalogue run (a reviewer's catch).
   * `'burned'`: stamp the mark into the file — for images shown outside the listing surfaces that draw
   * the overlay (e.g. set-vinwonders-covers.ts).
   * ⚠️ Scripts run from the box's app checkout, which moves only with a deploy, so the importers and
   * the renderer that marks their output always ship together.
   */
  mark?: 'burned' | 'overlay'
}) {
  const { storage, storageUrl, bucket, edge = 1200, quality = 80, prefix = 'affiliate', mark = 'overlay' } = deps

  /**
   * The shared half: resize, watermark, encode, upload. Takes BYTES, so it serves both a merchant
   * CDN URL and a file off disk — the VinWonders covers are supplied as local PNGs, and re-fetching
   * them over HTTP to reuse this would have meant a second copy of the same twenty lines.
   */
  async function hostBuffer(buf: Buffer, slug: string): Promise<string | null> {
    return (await hostBufferDetailed(buf, slug))?.url ?? null
  }

  /** hostBuffer, plus the dHash of the stored photo (null when it could not be computed). */
  async function hostBufferDetailed(buf: Buffer, slug: string): Promise<{ url: string; hash: string | null } | null> {
    if (!storage) return null
    try {
      const sharp = (await import('sharp')).default
      const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate()
      const meta = await img.metadata()
      const swapped = (meta.orientation ?? 1) >= 5
      const srcW = (swapped ? meta.height : meta.width) ?? edge
      const srcH = (swapped ? meta.width : meta.height) ?? edge
      const scale = Math.min(1, edge / Math.max(srcW, srcH))
      const outW = Math.max(1, Math.round(srcW * scale))
      const outH = Math.max(1, Math.round(srcH * scale))
      const png = await img
        .resize({ width: outW, height: outH, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer()
      if (mark === 'overlay') {
        // Two inks, because the mark lands on different pixels in the two frame shapes: the centred
        // square's corner on a cover card, the photo's own corner in a contain gallery.
        const probe = async (r: { left: number; top: number; width: number; height: number }) => {
          // ⚠️ A failed probe falls back to DARK: most of this catalogue is shot on white, where white
          // ink is exactly the invisible mark the owner reported (a reviewer's catch).
          try { return inkForGreyPixels(await sharp(png).extract(r).greyscale().raw().toBuffer()) } catch { return 'dark' as const }
        }
        const inks = { cover: await probe(cardMarkRegion(outW, outH)), contain: await probe(watermarkPlacement(outW, outH).region) }
        const hash = await dHashPng(sharp, png)
        const out = await sharp(png).webp({ quality }).toBuffer()
        const path = overlayImagePath(slug, inks, outW, outH, hash, Date.now().toString(36), Math.random().toString(36).slice(2, 7))
        const { error } = await storage.upload(path, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
        if (error) return null
        return { url: `${storageUrl}/storage/v1/object/public/${bucket}/${path}`, hash }
      }
      const { markWidth, left, top, region } = watermarkPlacement(outW, outH)
      let mean: number | null = null
      try {
        const { channels } = await sharp(png).extract(region).greyscale().stats()
        mean = (channels[0]?.mean ?? 0) / 255
      } catch { /* a mark on an undersized crop is not worth failing the image for */ }
      const out = await sharp(png)
        .composite([{ input: watermarkSvg(markWidth, inkForLuminance(mean)).svg, left, top }])
        .webp({ quality })
        .toBuffer()
      const path = `${prefix}/${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.webp`
      const { error } = await storage.upload(path, out, {
        contentType: 'image/webp',
        upsert: false,
        cacheControl: '31536000',
      })
      if (error) return null
      return { url: `${storageUrl}/storage/v1/object/public/${bucket}/${path}`, hash: null }
    } catch {
      return null
    }
  }

  /** Fetch a remote image, then process it. Fails to null on a 404, a timeout or an undecodable body. */
  async function hostImageDetailed(src: string, slug: string): Promise<{ url: string; hash: string | null } | null> {
    if (!storage) return null
    try {
      const res = await fetch(encodeURI(src), { signal: AbortSignal.timeout(25_000) })
      if (!res.ok) return null
      return await hostBufferDetailed(Buffer.from(await res.arrayBuffer()), slug)
    } catch {
      return null
    }
  }
  async function hostImage(src: string, slug: string): Promise<string | null> {
    return (await hostImageDetailed(src, slug))?.url ?? null
  }

  return Object.assign(hostImage, { fromBuffer: hostBuffer, detailed: hostImageDetailed })
}

/**
 * 64-bit dHash of the CLEAN photo, 16 hex — the same algorithm as src/lib/image-hash.ts (server-only,
 * which a script cannot import) and scrape-cellphones-gallery.ts: greyscale, 9x8 fill, row gradients.
 * Written into the overlay filename so countDistinctAngles / duplicate detection keep working.
 */
async function dHashPng(sharp: typeof import('sharp').default, png: Buffer): Promise<string | null> {
  try {
    const px = await sharp(png).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
    if (px.length < 72) return null
    let hex = '', nib = 0, c = 0
    for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
      nib = (nib << 1) | (px[r * 9 + col] > px[r * 9 + col + 1] ? 1 : 0)
      if (++c === 4) { hex += nib.toString(16); nib = 0; c = 0 }
    }
    return hex
  } catch { return null }
}
