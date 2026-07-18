import 'server-only'
import sharp from 'sharp'
import { getSupabaseAdmin, LISTINGS_BUCKET, EVIDENCE_BUCKET, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
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
// The "eno.vn" wordmark, INLINED as raw path data: pure vectors, so rendering never
// depends on system fonts (serverless has none we control — SVG <text> would silently
// fall back to an ugly default or nothing). The domain (not just "eno") is baked in so
// scraped/re-shared photos carry the web address for memorability. "eno" comes from
// public/logo.svg; ".vn" is appended as matching vector glyphs (a baseline dot, a
// parallel-stroke "v", and the same "n" glyph translated right). Glyphs span
// x 249–1602 (1353 wide) × y 35–265 (230 tall) in the original 1200×300-derived canvas.
const WORDMARK_D =
  // e · n · o
  'M 476 150 C 476 86 426 35 363 35 C 300 35 249 86 249 150 C 249 214 301 265 364 265 C 415 265 459 233 471 193 L 397 193 C 389 203 377 208 364 208 C 342 208 323 195 315 173 L 472 173 C 475 165 476 158 476 150 Z M 315 127 C 323 107 343 93 364 93 C 385 93 403 106 412 127 Z M 509 263 L 509 151 C 509 85 558 35 622 35 C 686 35 734 85 734 151 L 734 263 L 669 263 L 669 151 C 669 122 650 101 622 101 C 594 101 574 122 574 151 L 574 263 Z M 886 35 C 950 35 1002 87 1002 150 C 1002 213 950 265 886 265 C 823 265 771 213 771 150 C 771 87 823 35 886 35 Z M 886 101 C 913 101 935 123 935 150 C 935 177 913 199 886 199 C 859 199 837 177 837 150 C 837 123 859 101 886 101 Z ' +
  // "." — baseline dot (circle centred 1072,230 r35)
  'M 1107 230 C 1107 249.3 1091.3 265 1072 265 C 1052.7 265 1037 249.3 1037 230 C 1037 210.7 1052.7 195 1072 195 C 1091.3 195 1107 210.7 1107 230 Z ' +
  // "v" — parallel-stroke wedge
  'M 1142 35 L 1199 35 L 1242 134 L 1285 35 L 1342 35 L 1242 265 Z ' +
  // "n" — the eno "n" glyph, translated +868
  'M 1377 263 L 1377 151 C 1377 85 1426 35 1490 35 C 1554 35 1602 85 1602 151 L 1602 263 L 1537 263 L 1537 151 C 1537 122 1518 101 1490 101 C 1462 101 1442 122 1442 151 L 1442 263 Z'
const MARK_W = 1353, MARK_H = 230, MARK_X = 249, MARK_Y = 35

/** The "eno.vn" wordmark as ONE flat, crisp pass — no shadow, no outline, no second
 *  copy (user-picked 2026-07-14).
 *
 *  The old mark drew a 30%-black copy offset behind a 55%-white one. At web sizes the
 *  two never resolved into a single shape: every glyph carried a grey ghost, so the mark
 *  read as a smudge rather than a signature. The obvious repair — white fill plus a
 *  hairline dark contour — fails the case that actually matters here, a product shot on
 *  a white studio background: the fill disappears into the paper and you're left with a
 *  hollow outline.
 *
 *  So the ink is chosen from the photo instead (see pickInk): white on a dark backdrop,
 *  near-black on a bright one. One solid colour either way, which is what makes it read
 *  as cleanly engraved.
 *
 *  `w` = target glyph-box width. */
export function watermarkSvg(w: number, ink: { fill: string; opacity: number }): { svg: Buffer; width: number; height: number } {
  const scale = w / MARK_W
  const width = w
  const height = Math.max(1, Math.round(MARK_H * scale))
  return {
    svg: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<g transform="scale(${scale}) translate(${-MARK_X},${-MARK_Y})">` +
        `<path d="${WORDMARK_D}" fill-rule="evenodd" fill="${ink.fill}" fill-opacity="${ink.opacity}"/>` +
        `</g></svg>`,
    ),
    width,
    height,
  }
}

/** Read the patch of photo the mark will sit on and pick an ink that stays legible there
 *  WITHOUT a shadow. Bright backdrop (white studio cyc, sky, pale wall) → near-black ink;
 *  anything mid or dark → white. Falls back to white if the probe fails — the old
 *  behaviour, and the safe one for the average photo. */
async function pickInk(png: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<{ fill: string; opacity: number }> {
  const WHITE = { fill: '#ffffff', opacity: 0.85 }
  try {
    const { channels } = await sharp(png).extract(region).greyscale().stats()
    const mean = (channels[0]?.mean ?? 0) / 255
    return mean > 0.62 ? { fill: '#0a0a0a', opacity: 0.42 } : WHITE
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
      // ~28% of the width (prominent for web-address memorability — user ask
      // 2026-07-07), clamped; anchored bottom-right.
      const mw = Math.min(580, Math.max(190, Math.round(info.width * 0.28)))
      const mh = Math.round((mw / MARK_W) * MARK_H)
      // Padding is measured off the SHORT edge (user-picked 2026-07-14: the mark must
      // never touch a border). Off the width, a tall portrait shot got a hairline gap at
      // the bottom while a panorama got a canyon; the short edge keeps the inset even.
      const pad = Math.round(Math.min(info.width, info.height) * 0.03)
      const left = Math.max(0, info.width - mw - pad)
      const top = Math.max(0, info.height - mh - pad)
      const region = {
        left, top,
        width: Math.min(mw, info.width - left),
        height: Math.min(mh, info.height - top),
      }
      const mark = watermarkSvg(mw, await pickInk(data, region))
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
