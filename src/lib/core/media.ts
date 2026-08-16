import 'server-only'
// ⚠️ NOT a top-level `import sharp` — see lib/sharp-lazy.ts. lib/core/listings imports this module
// for its pure VIDEO helpers (isCanonicalVideoUrl, removeListingVideoByUrl), so a module-scope
// native import here reached /api/listings for code paths that only run on upload.
import { getSharp } from '@/lib/sharp-lazy'
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
// fall back to an ugly default or nothing).
//
// ⛔ THESE ARE THE OPEN RUNDE OUTLINES, THE SAME ONES public/logo-dotvn.svg USES — replaced
// 2026-08-16 (owner: "all watermarks on images and backdrops use new typography eno.vn svg").
// What was here before was the hand-drawn bezier wordmark from before the app adopted Open
// Runde: "eno" lifted from public/logo.svg with ".vn" appended as a baseline dot, a
// parallel-stroke pointed `v` and a translated `n`. It was a different typeface from the one
// the dashboard, the header and the account panel had already moved to — so every uploaded
// photo was stamped with a wordmark the rest of the app no longer used.
//
// Provenance — regenerate from the SAME source if the font ever moves:
//   face  src/fonts/open-runde-bold.woff2 (Open Runde Bold 700, OFL-1.1, unitsPerEm 2816)
//   text  "eno.vn", outlines via fontTools SVGPathPen, y flipped for SVG, GPOS kerning applied
// The simplest correct move is to copy the `d` out of public/logo-dotvn.svg verbatim, which is
// what this is — one generation, three consumers, no drift.
//
// ⚠️ NONZERO WINDING. The previous path was drawn to need `fill-rule="evenodd"`; these are FONT
// outlines whose counters are wound opposite to their outer contours and drop out on their own.
// Leaving evenodd on filled the bowls of `e`, `o` and `n` solid. The attribute is gone from
// watermarkSvg() below — do not reinstate it.
//
// ⚠️ KEEP IN SYNC WITH scripts/watermark-existing.mjs, which re-stamps already-uploaded photos
// and carries its own copy of this path and these bounds.
const WORDMARK_D =
  'M870.0 30.0C1201.0 30.0 1438.0 -111.0 1533.0 -335.0C1560.0 -399.0 1513.0 -443.0 1428.0 -449.0L1270.0 -460.0C1203.0 -464.0 1167.0 -435.0 1122.0 -383.0C1066.0 -320.0 980.0 -288.0 877.0 -288.0C664.0 -288.0 529.0 -429.0 529.0 -658.0V-659.0H1455.0C1533.0 -659.0 1575.0 -700.0 1575.0 -776.0C1575.0 -1298.0 1259.0 -1556.0 853.0 -1556.0C401.0 -1556.0 108.0 -1235.0 108.0 -761.0C108.0 -274.0 397.0 30.0 870.0 30.0ZM529.0 -923.0C538.0 -1098.0 671.0 -1238.0 860.0 -1238.0C1045.0 -1238.0 1173.0 -1106.0 1174.0 -923.0Z M2279.0 -120.0V-888.0C2280.0 -1086.0 2398.0 -1202.0 2570.0 -1202.0C2741.0 -1202.0 2844.0 -1090.0 2843.0 -902.0V-120.0C2843.0 -42.0 2885.0 0.0 2963.0 0.0H3149.0C3227.0 0.0 3269.0 -42.0 3269.0 -120.0V-978.0C3269.0 -1336.0 3059.0 -1556.0 2739.0 -1556.0C2511.0 -1556.0 2346.0 -1444.0 2277.0 -1265.0H2259.0V-1416.0C2259.0 -1494.0 2217.0 -1536.0 2139.0 -1536.0H1973.0C1895.0 -1536.0 1853.0 -1494.0 1853.0 -1416.0V-120.0C1853.0 -42.0 1895.0 0.0 1973.0 0.0H2159.0C2237.0 0.0 2279.0 -42.0 2279.0 -120.0Z M4298.0 30.0C4764.0 30.0 5054.0 -289.0 5054.0 -762.0C5054.0 -1238.0 4764.0 -1556.0 4298.0 -1556.0C3832.0 -1556.0 3542.0 -1238.0 3542.0 -762.0C3542.0 -289.0 3832.0 30.0 4298.0 30.0ZM3975.0 -765.0C3975.0 -1033.0 4085.0 -1231.0 4300.0 -1231.0C4511.0 -1231.0 4621.0 -1033.0 4621.0 -765.0C4621.0 -497.0 4511.0 -300.0 4300.0 -300.0C4085.0 -300.0 3975.0 -497.0 3975.0 -765.0Z M5581.0 26.0C5709.0 26.0 5820.0 -81.0 5821.0 -214.0C5820.0 -345.0 5709.0 -452.0 5581.0 -452.0C5449.0 -452.0 5340.0 -345.0 5341.0 -214.0C5340.0 -81.0 5449.0 26.0 5581.0 26.0Z M7099.0 -97.0 7554.0 -1399.0C7583.0 -1482.0 7544.0 -1536.0 7456.0 -1536.0H7256.0C7185.0 -1536.0 7142.0 -1504.0 7122.0 -1435.0L6833.0 -437.0H6817.0L6527.0 -1435.0C6507.0 -1504.0 6464.0 -1536.0 6393.0 -1536.0H6194.0C6106.0 -1536.0 6067.0 -1482.0 6096.0 -1399.0L6551.0 -97.0C6574.0 -31.0 6618.0 0.0 6688.0 0.0H6962.0C7032.0 0.0 7076.0 -31.0 7099.0 -97.0Z M8246.0 -120.0V-888.0C8247.0 -1086.0 8365.0 -1202.0 8537.0 -1202.0C8708.0 -1202.0 8811.0 -1090.0 8810.0 -902.0V-120.0C8810.0 -42.0 8852.0 0.0 8930.0 0.0H9116.0C9194.0 0.0 9236.0 -42.0 9236.0 -120.0V-978.0C9236.0 -1336.0 9026.0 -1556.0 8706.0 -1556.0C8478.0 -1556.0 8313.0 -1444.0 8244.0 -1265.0H8226.0V-1416.0C8226.0 -1494.0 8184.0 -1536.0 8106.0 -1536.0H7940.0C7862.0 -1536.0 7820.0 -1494.0 7820.0 -1416.0V-120.0C7820.0 -42.0 7862.0 0.0 7940.0 0.0H8126.0C8204.0 0.0 8246.0 -42.0 8246.0 -120.0Z'
// TIGHT INK BOUNDS — measured by rendering the path and trimming, NOT copied from
// public/logo-dotvn.svg's viewBox.
//
// ⛔ THE viewBox IS THE EM/ADVANCE BOX AND USING IT PUT 22.6% TRANSPARENT PADDING AROUND THE MARK.
// I shipped that in the first cut of this change and an external reviewer caught it. The effect is
// not cosmetic: every caller sizes the mark by WIDTH and derives height from these numbers, then
// anchors it with a margin off the short edge — so 11% of dead space below the baseline silently
// became extra bottom margin, floating the mark away from the corner it is supposed to sit in.
// A font's em box is the right frame for setting type inline; it is the wrong frame for
// positioning a graphic.
//
// ⚠️ AND THE ASPECT BARELY MOVED, which the em box also hid: 5.88:1 hand-drawn → 5.75:1 Open Runde
// on the real ink. The first version of this comment claimed 4.52:1 and "the mark is TALLER" —
// that was the padding talking. The watermark keeps essentially the proportions it always had.
const MARK_W = 9132.3, MARK_H = 1588.3, MARK_X = 105.9, MARK_Y = -1556.4

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
        `<path d="${WORDMARK_D}" fill="${ink.fill}" fill-opacity="${ink.opacity}"/>` +
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
    const sharp = await getSharp()
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
