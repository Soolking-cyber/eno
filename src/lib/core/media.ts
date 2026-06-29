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

/**
 * Decode → auto-orient (bake EXIF rotation, then DROP all metadata incl. GPS) →
 * downscale to fit MAX_EDGE → re-encode WebP → store in the listings bucket. sharp
 * throws on anything that isn't a real decodable raster, so a disguised/corrupt file
 * (or an SVG) is rejected here. limitInputPixels guards decompression bombs. Returns the
 * public URL, or null on any failure (bad input / storage error). Never throws.
 */
export async function storeListingImage(buf: Buffer, opts: { pathPrefix?: string } = {}): Promise<string | null> {
  let out: Buffer
  try {
    out = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
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
