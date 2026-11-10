import 'server-only'
// ⚠️ NOT a top-level `import sharp` — see lib/sharp-lazy.ts. lib/core/listings imports this module
// for its pure VIDEO helpers (isCanonicalVideoUrl, removeListingVideoByUrl), so a module-scope
// native import here reached /api/listings for code paths that only run on upload.
import { getSharp } from '@/lib/sharp-lazy'
import { getSupabaseAdmin, LISTINGS_BUCKET, EVIDENCE_BUCKET, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { cardMarkRegion, inkForGreyPixels, watermarkPlacement } from '@/lib/core/watermark-mark'
import { dHash } from '@/lib/image-hash'
import { isListingVideoUrl, VIDEO_EXTENSIONS } from '@/lib/listing-image'

// Listing-image media core. Single place that turns raw image bytes into a stored,
// first-party WebP asset — shared by /api/upload (post wizard), the bulk importer's
// re-host, and the future /api/v1/media. Validate the content-type + size at the caller
// (cheap pre-check), then hand the bytes here.
export const IMG_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const IMG_MAX_BYTES = 12 * 1024 * 1024 // 12MB raw in (modern phone photos) — recompressed below
const MAX_EDGE = 1600 // longest edge; covers ×2-retina detail hero with no visible loss
const WEBP_QUALITY = 82

// ── The eno.vn mark ──────────────────────────────────────────────────────────────
// ⛔ NOTHING IS BAKED INTO AN UPLOAD ANY MORE (owner, 2026-11-10: item 6 of the decision scorecard, no eno.vn mark on
// photos on screen). Until then every member photo got the wordmark composited into its pixels here, which is why a photo
// uploaded before that day still shows one and always will: a baked mark cannot be taken out of a file.
// The file is now stored CLEAN, exactly as an imported photo has been since 2026-09-13 (host-product-image.ts), and what a
// drawn mark would need is measured here and written into the name the same way (image-mark-url.ts):
//   <ts>-<rand>-i<cover><contain>-<W>x<H>[-h<16hex>].webp
// so the mark can be drawn again (image-mark.tsx ON_SCREEN_MARK), or baked by a script, without guessing which of a
// MEMBER'S LISTING PHOTOS are clean: among those, a name with `-i..-WxH` is clean and a name without it was stored before
// this day and is baked.
// ⛔ THAT RULE IS FOR A MEMBER'S LISTING PHOTO ONLY. An avatar or a shop logo (`watermark: false`) never has the segment and
// was never marked; an import under `affiliate/m/` is clean under its own name. A script that read "no segment" as "baked"
// for those would be wrong about every one of them, and one that baked on the strength of it could not be undone.
// ⚠️ `overlayMarkFromUrl` still reads only `affiliate/m/` names. Widening it to these is the step to take WITH turning the
// mark back on, not before: rentals-feed.ts reads sizes through it for Meta's minimum edge.
// The wordmark, its box, the placement rule and the ink threshold live in ./watermark-mark.ts (pure, shared with scripts).

/** The two inks a drawn mark would use on this photo, read off the normalised PNG: on the centred square a card shows
 *  (`cover`) and on the photo's own corner (`contain`). 'light', the mark's default ink, for a probe that fails.
 *  ⛔ IT NEVER THROWS: these are facts for a mark that may never be drawn, so nothing here may cost a member their upload
 *  (commit review: the region maths ran outside the probe's own catch). A photo too small to hold a mark gets 'light'. */
async function markInks(png: Buffer, width: number, height: number): Promise<{ cover: 'dark' | 'light'; contain: 'dark' | 'light' }> {
  const probe = async (region: () => { left: number; top: number; width: number; height: number }) => {
    try {
      const sharp = await getSharp()
      return inkForGreyPixels(await sharp(png).extract(region()).greyscale().raw().toBuffer())
    } catch { return 'light' as const }
  }
  return { cover: await probe(() => cardMarkRegion(width, height)), contain: await probe(() => watermarkPlacement(width, height).region) }
}

/**
 * Decode → auto-orient (bake EXIF rotation, then DROP all metadata incl. GPS) →
 * downscale to fit MAX_EDGE → measure the inks a drawn eno.vn mark would use (NOTHING is baked
 * since 2026-11-10, see above; the facts ride in the stored name) →
 * re-encode WebP → store in the listings bucket. sharp throws on anything that
 * isn't a real decodable raster, so a disguised/corrupt file (or an SVG) is
 * rejected here. limitInputPixels guards decompression bombs. Returns the public
 * URL, or null on any failure (bad input / storage error). Never throws.
 * `watermark: false` is for NON-listing assets (avatars / shop logos) only: their name carries no mark facts, so a
 * mark can never be drawn or baked over them.
 * `beforeUpload` runs with the object's path after the image is encoded and BEFORE a byte is stored; if it throws,
 * nothing is uploaded and the answer is null. Bulk re-hosting writes the object's tombstone there, so no object of its
 * ever exists untombstoned (core/bulk.ts rehost).
 */
export async function storeListingImage(
  buf: Buffer,
  opts: { pathPrefix?: string; watermark?: boolean; beforeUpload?: (path: string) => Promise<void> } = {},
): Promise<string | null> {
  let out: Buffer
  // Perceptual hash for duplicate detection — computed from the normalized (pre-WebP)
  // intermediate so a re-upload of the same source hashes identically, and embedded
  // in the filename so it rides in the stored URL (no DB column). Best-effort; null on failure.
  let hash: string | null = null
  // "-i<cover><contain>-<W>x<H>" for a listing photo (stored clean, see the header above); empty for an avatar or a logo.
  let markFacts = ''
  try {
    const sharp = await getSharp()
    // Pass 1 — normalize to a lossless intermediate, so the hash and the ink probes read
    // pixels and the one lossy step is the final WebP.
    const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      // Flatten alpha onto white: listing photos render over a blurred self-backdrop
      // in the gallery, so a transparent cut-out PNG would otherwise let the backdrop
      // + brand pattern bleed through the subject. A no-op for the common opaque camera JPEG.
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer({ resolveWithObject: true })
    hash = await dHash(data) // from the normalized source, before WebP
    if (opts.watermark !== false) {
      const inks = await markInks(data, info.width, info.height)
      markFacts = `-i${inks.cover === 'dark' ? 'd' : 'l'}${inks.contain === 'dark' ? 'd' : 'l'}-${info.width}x${info.height}`
    }
    out = await sharp(data).webp({ quality: WEBP_QUALITY }).toBuffer()
  } catch {
    return null
  }
  const path = `${opts.pathPrefix ?? ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}${markFacts}${hash ? `-h${hash}` : ''}.webp`
  if (opts.beforeUpload) {
    try { await opts.beforeUpload(path) } catch (e) {
      console.error('[media] beforeUpload', e)
      return null
    }
  }
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
// ⛔ DRIFT GUARD. The signed-URL mint stores `${ts}-${rand}.${ext}` for these, and the listing
// save accepts only what `isListingVideoUrl` parses. An extension added here but not to
// VIDEO_EXTENSIONS would be stored, then refused on save, with no test going red — so the module
// refuses to load instead (2026-09-05 review).
for (const ext of VIDEO_ALLOWED.values()) {
  if (!(VIDEO_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`VIDEO_ALLOWED extension "${ext}" is not in listing-image VIDEO_EXTENSIONS`)
}
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
  const { error } = await admin.storage.from(EVIDENCE_BUCKET).upload(path, out, { contentType: 'image/webp', upsert: false, cacheControl: '0' /* security review item 21: never edge-cacheable past the signed URL — storage-js sends max-age=<this> */ })
  if (error) {
    console.error('[media] store evidence', error.message)
    return null
  }
  return path
}
