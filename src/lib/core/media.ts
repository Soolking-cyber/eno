import 'server-only'
import sharp from 'sharp'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'

// Listing-image media core. Single place that turns raw image bytes into a stored,
// first-party WebP asset — shared by /api/upload (post wizard), the bulk importer's
// re-host, and the future /api/v1/media. Validate the content-type + size at the caller
// (cheap pre-check), then hand the bytes here.
export const IMG_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const IMG_MAX_BYTES = 12 * 1024 * 1024 // 12MB raw in (modern phone photos) — recompressed below
const MAX_EDGE = 1600 // longest edge; covers ×2-retina detail hero with no visible loss
const WEBP_QUALITY = 82

// ── Watermark ────────────────────────────────────────────────────────────────────
// The "eno" wordmark from public/logo.svg, INLINED as raw path data: pure vectors,
// so rendering never depends on system fonts (serverless has none we control —
// SVG <text> would silently fall back to an ugly default or nothing). Glyphs span
// x 249–1002 (753 wide) × y 35–265 (230 tall) in the original 1200×300 canvas.
const WORDMARK_D = 'M 476 150 C 476 86 426 35 363 35 C 300 35 249 86 249 150 C 249 214 301 265 364 265 C 415 265 459 233 471 193 L 397 193 C 389 203 377 208 364 208 C 342 208 323 195 315 173 L 472 173 C 475 165 476 158 476 150 Z M 315 127 C 323 107 343 93 364 93 C 385 93 403 106 412 127 Z M 509 263 L 509 151 C 509 85 558 35 622 35 C 686 35 734 85 734 151 L 734 263 L 669 263 L 669 151 C 669 122 650 101 622 101 C 594 101 574 122 574 151 L 574 263 Z M 886 35 C 950 35 1002 87 1002 150 C 1002 213 950 265 886 265 C 823 265 771 213 771 150 C 771 87 823 35 886 35 Z M 886 101 C 913 101 935 123 935 150 C 935 177 913 199 886 199 C 859 199 837 177 837 150 C 837 123 859 101 886 101 Z'
const MARK_W = 753, MARK_H = 230, MARK_X = 249, MARK_Y = 35

/** Translucent white wordmark over a soft dark offset copy — legible on both bright
 *  skies and dark interiors without wrecking the photo. `w` = target pixel width. */
export function watermarkSvg(w: number): Buffer {
  const scale = w / MARK_W
  const h = Math.max(1, Math.round(MARK_H * scale))
  const off = Math.max(1, Math.round(w * 0.012)) / scale // shadow offset, in glyph units
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<g transform="scale(${scale}) translate(${-MARK_X},${-MARK_Y})">` +
      `<path fill="#000" fill-opacity="0.30" fill-rule="evenodd" transform="translate(${off},${off})" d="${WORDMARK_D}"/>` +
      `<path fill="#fff" fill-opacity="0.55" fill-rule="evenodd" d="${WORDMARK_D}"/>` +
      `</g></svg>`,
  )
}

/**
 * Decode → auto-orient (bake EXIF rotation, then DROP all metadata incl. GPS) →
 * downscale to fit MAX_EDGE → bake the eno wordmark bottom-right (listing photos
 * are scraped/re-shared; the mark survives "save image" — CSS shields don't) →
 * re-encode WebP → store in the listings bucket. sharp throws on anything that
 * isn't a real decodable raster, so a disguised/corrupt file (or an SVG) is
 * rejected here. limitInputPixels guards decompression bombs. Returns the public
 * URL, or null on any failure (bad input / storage error). Never throws.
 * `watermark: false` is for NON-listing assets (avatars / shop logos) only.
 */
export async function storeListingImage(buf: Buffer, opts: { pathPrefix?: string; watermark?: boolean } = {}): Promise<string | null> {
  let out: Buffer
  try {
    // Pass 1 — normalize to a lossless intermediate so the watermark composite
    // doesn't double-lossy-encode (PNG → final WebP = single quality loss).
    const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true })
    if (opts.watermark !== false) {
      // ~15% of the width, clamped; anchored bottom-right with ~2.5% padding.
      const mw = Math.min(300, Math.max(72, Math.round(info.width * 0.15)))
      const mh = Math.round((mw / MARK_W) * MARK_H)
      const pad = Math.round(info.width * 0.025)
      out = await sharp(data)
        .composite([{ input: watermarkSvg(mw), left: Math.max(0, info.width - mw - pad), top: Math.max(0, info.height - mh - pad) }])
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    } else {
      out = await sharp(data).webp({ quality: WEBP_QUALITY }).toBuffer()
    }
  } catch {
    return null
  }
  const path = `${opts.pathPrefix ?? ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
  const admin = getSupabaseAdmin()
  const { error } = await admin.storage.from(LISTINGS_BUCKET).upload(path, out, { contentType: 'image/webp', upsert: false })
  if (error) {
    console.error('[media] store', error.message)
    return null
  }
  return admin.storage.from(LISTINGS_BUCKET).getPublicUrl(path).data.publicUrl
}
