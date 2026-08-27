import { inkForLuminance, watermarkPlacement, watermarkSvg } from './core/watermark-mark'

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
  /** Folder inside the bucket. */
  prefix?: string
}) {
  const { storage, storageUrl, bucket, edge = 1200, quality = 80, prefix = 'affiliate' } = deps

  return async function hostImage(src: string, slug: string): Promise<string | null> {
    if (!storage) return null
    try {
      const res = await fetch(encodeURI(src), { signal: AbortSignal.timeout(25_000) })
      if (!res.ok) return null
      const sharp = (await import('sharp')).default
      const buf = Buffer.from(await res.arrayBuffer())
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
      return `${storageUrl}/storage/v1/object/public/${bucket}/${path}`
    } catch {
      return null
    }
  }
}
