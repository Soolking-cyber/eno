import 'server-only'
// ⚠️ NOT a top-level `import sharp` — see lib/sharp-lazy.ts. lib/core/listings imports this module
// for its pure VIDEO helpers (isCanonicalVideoUrl, removeListingVideoByUrl), so a module-scope
// native import here reached /api/listings for code paths that only run on upload.
import { getSharp } from '@/lib/sharp-lazy'
import { getSupabaseAdmin, LISTINGS_BUCKET, EVIDENCE_BUCKET, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { watermarkSvg, watermarkPlacement, inkForLuminance } from '@/lib/core/watermark-mark'
import { dHash } from '@/lib/image-hash'
import { isListingVideoUrl } from '@/lib/listing-image'

// Listing-image media core. Single place that turns raw image bytes into a stored,
// first-party WebP asset — shared by /api/upload (post wizard), the bulk importer's
// re-host, and the future /api/v1/media. Validate the content-type + size at the caller
// (cheap pre-check), then hand the bytes here.
export const IMG_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const IMG_MAX_BYTES = 12 * 1024 * 1024 // 12MB raw in (modern phone photos) — recompressed below
const MAX_EDGE = 1600 // longest edge; covers ×2-retina detail hero with no visible loss
const WEBP_QUALITY = 82

// ── Watermark ────────────────────────────────────────────────────────────────────
// The wordmark, its box, the placement rule and the ink threshold all live in
// ./watermark-mark.ts — pure, so a maintenance script can share them instead of growing a
// third copy that drifts. Read the header there before changing any of it.

/** Read the patch of photo the mark will sit on and pick an ink that stays legible there
 *  WITHOUT a shadow. Bright backdrop (white studio cyc, sky, pale wall) → near-black ink;
 *  anything mid or dark → white. Falls back to white if the probe fails — the old
 *  behaviour, and the safe one for the average photo. */
async function pickInk(png: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<{ fill: string; opacity: number }> {
  const WHITE = { fill: '#ffffff', opacity: 0.85 }
  try {
    const sharp = await getSharp()
    const { channels } = await sharp(png).extract(region).greyscale().stats()
    return inkForLuminance((channels[0]?.mean ?? 0) / 255)
  } catch {
    return WHITE
  }
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
  // Perceptual hash for duplicate detection — computed from the normalized (pre-watermark,
  // pre-WebP) intermediate so a re-upload of the same source hashes identically, and embedded
  // in the filename so it rides in the stored URL (no DB column). Best-effort; null on failure.
  let hash: string | null = null
  try {
    const sharp = await getSharp()
    // Pass 1 — normalize to a lossless intermediate so the watermark composite
    // doesn't double-lossy-encode (PNG → final WebP = single quality loss).
    const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      // Flatten alpha onto white: listing photos render over a blurred self-backdrop
      // in the gallery, so a transparent cut-out PNG would otherwise let the backdrop
      // + brand pattern bleed through the subject — and the baked watermark would
      // composite onto empty pixels. A no-op for the common opaque camera JPEG.
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer({ resolveWithObject: true })
    hash = await dHash(data) // from the normalized source, before watermark/WebP
    if (opts.watermark !== false) {
      const { markWidth, left, top, region } = watermarkPlacement(info.width, info.height)
      const mark = watermarkSvg(markWidth, await pickInk(data, region))
      out = await sharp(data)
        .composite([{ input: mark.svg, left, top }])
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    } else {
      out = await sharp(data).webp({ quality: WEBP_QUALITY }).toBuffer()
    }
  } catch {
    return null
  }
  const path = `${opts.pathPrefix ?? ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}${hash ? `-h${hash}` : ''}.webp`
  const admin = getSupabaseAdmin()
  // Objects are uniquely named and never rewritten (upsert:false) → immutable: cache for a
  // year. Without this Supabase defaults to max-age=3600 and raw-URL consumers (OG scrapes,
  // video posters) refetch + bill egress every hour.
  const { error } = await admin.storage.from(LISTINGS_BUCKET).upload(path, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
  if (error) {
    console.error('[media] store', error.message)
    return null
  }
  return admin.storage.from(LISTINGS_BUCKET).getPublicUrl(path).data.publicUrl
}

// ── Listing video ──────────────────────────────────────────────────────────────────
// A single optional clip per listing (≤60s, duration-gated client-side). Uploaded DIRECTLY
// browser→storage via a signed upload URL — a Vercel function can't proxy the bytes (bodies
// over ~4.5MB are rejected with FUNCTION_PAYLOAD_TOO_LARGE before the route runs, and a real
// phone clip is 10–50MB). The server's role: mint the signed URL (auth + enforcement + type/
// size pre-check in /api/upload/video/sign) and then VERIFY the landed object's magic bytes
// (/api/upload/video/complete) before handing back a usable URL. Stored raw — no transcode.
export const VIDEO_ALLOWED = new Map<string, string>([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
])
// ⚠️ 50MB is the Supabase PROJECT-WIDE upload ceiling (probed 2026-07-18: updateBucket
// rejects 51MB+ until the owner raises Project Settings → Storage → upload limit). The
// wizard therefore accepts big phone clips and COMPRESSES them client-side to fit
// (src/lib/video-compress.ts) — this server/bucket cap is what the landed object obeys.
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024

// Storage object names the sign route mints (and the only shape complete/GC will touch).
export const VIDEO_PATH_RE = /^\d{10,16}-[a-z0-9]{4,12}\.(mp4|webm|mov)$/

/**
 * Does this buffer LOOK like one of the allowed video containers? Checks the real magic
 * bytes so a blob merely LABELED video/mp4 can't be parked in the public bucket:
 *  - MP4/MOV: an ISO-BMFF `ftyp` box at offset 4
 *  - WebM/MKV: the EBML header 0x1A45DFA3 at offset 0
 * Needs only the first 12 bytes.
 */
export function looksLikeVideo(head: Buffer): boolean {
  if (head.length < 12) return false
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true // EBML (webm)
  return head.subarray(4, 8).toString('latin1') === 'ftyp' // ISO-BMFF (mp4/mov)
}

/** Storage path for a first-party listing-video URL, else null. NEVER throws — a malformed
 *  percent-sequence in a stored URL must not blow up eviction callbacks or the GC cron
 *  (decodeURIComponent throws URIError on e.g. a lone '%'). Canonical minted paths contain
 *  no percent-encoding, so the raw suffix is returned when decoding fails. */
export function videoPathFromUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/listing-videos\/(.+)$/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/** The ONLY video URL shape a listing may persist: OUR project's bucket (host-pinned via
 *  isListingVideoUrl) + an exactly-canonical minted object name (VIDEO_PATH_RE). Stricter
 *  than isListingVideoUrl (prefix-only) on purpose — it stops (a) foreign/garbage suffixes
 *  (a lone '%' used to be storable and killed the GC cron's decode) and (b) re-pointing at
 *  arbitrary bucket paths. Cross-listing reuse of a canonical URL is handled at eviction
 *  time (refcount), not here. */
export function isCanonicalVideoUrl(url: unknown): url is string {
  if (!isListingVideoUrl(url)) return false
  const m = url.match(/\/listing-videos\/([^/]+)$/)
  return !!m && VIDEO_PATH_RE.test(m[1])
}

/** Best-effort delete of a listing video's storage object (replace/remove/listing-delete).
 *  Never throws — the nightly GC cron is the backstop for anything missed. */
export async function removeListingVideoByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return
  const path = videoPathFromUrl(url)
  if (!path) return
  try {
    await getSupabaseAdmin().storage.from(LISTING_VIDEOS_BUCKET).remove([path])
  } catch (e) {
    console.error('[media] remove video', e)
  }
}

// Evidence keeps more detail than a listing hero: receipts/chat screenshots must stay
// legible, so a larger edge cap and slightly higher quality. Still EXIF/GPS-stripped.
const EVIDENCE_MAX_EDGE = 2000
const EVIDENCE_WEBP_QUALITY = 85

/**
 * Dispute-evidence flavor of the pipeline: same decode/rotate/metadata-strip safety,
 * NO watermark (evidence must not look tampered with), stored in the PRIVATE
 * evidence bucket under `disputes/<reportId>/…`. Returns the storage PATH (not a
 * URL) — callers mint short-lived signed URLs inside party/admin-gated routes.
 * Never throws; null on bad input or storage failure.
 */
export async function storeEvidenceImage(buf: Buffer, reportId: string): Promise<string | null> {
  let out: Buffer
  try {
    const sharp = await getSharp()
    out = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: EVIDENCE_MAX_EDGE, height: EVIDENCE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: EVIDENCE_WEBP_QUALITY })
      .toBuffer()
  } catch {
    return null
  }
  const path = `disputes/${reportId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
  const admin = getSupabaseAdmin()
  const { error } = await admin.storage.from(EVIDENCE_BUCKET).upload(path, out, { contentType: 'image/webp', upsert: false })
  if (error) {
    console.error('[media] store evidence', error.message)
    return null
  }
  return path
}
