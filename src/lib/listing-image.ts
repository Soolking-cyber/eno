// Single source of truth for "is this a valid first-party listing image URL".
// Pinned to OUR Supabase project's public `listings` bucket — NOT any
// *.supabase.co project — so a stored avatar/listing image can't point at an
// attacker-controlled bucket (content that bypassed our raster-only upload).
const HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const PREFIX = HOST ? `${HOST}/storage/v1/object/public/listings/` : null
// Same host-pinned guard for a listing's optional video — our project's public
// `listing-videos` bucket only, so a stored video URL can't point at an
// attacker-controlled bucket that bypassed the upload route's validation.
const VIDEO_PREFIX = HOST ? `${HOST}/storage/v1/object/public/listing-videos/` : null

/**
 * ⛔ A FIRST-PARTY STORAGE URL IS ACCEPTED ONLY IN ITS CANONICAL FORM: the bucket prefix followed
 * by a plain object key — path segments of `[A-Za-z0-9._-]` starting with an alphanumeric, and a
 * raster (or video) extension. No query, no fragment, no percent-escapes, no `.`/`..` segments,
 * no empty segments, no backslashes, no whitespace.
 *
 * The prefix check alone was a cross-user deletion hole (2026-09-05 review, S01): a signed-in user
 * could store ANOTHER user's public image URL with a query or fragment appended as their own
 * avatar. It passed `startsWith(PREFIX)`. Later, deleting their own account compared that whole
 * aliased string against surviving references (no match — the victim's listing stores the plain
 * URL), then issued a storage DELETE whose PATH addressed the victim's object. Two URLs that
 * name one object must never disagree about whether it is still in use — so only the one
 * spelling is ever stored, and the deletion side parses the same way (`listingObjectKey`).
 */
const KEY_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*'
/** The extensions a first-party object key may carry — the ONE list the parser, the tests and the
 *  writers' allow-lists are checked against (core/media.ts asserts VIDEO_ALLOWED against
 *  VIDEO_EXTENSIONS at load, so a new upload type cannot be stored and then refused on save). */
export const RASTER_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png', 'avif', 'gif'] as const
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'] as const
const RASTER_KEY_RE = new RegExp(`^(?:${KEY_SEGMENT}/)*${KEY_SEGMENT}\\.(?:${RASTER_EXTENSIONS.join('|')})$`, 'i')
const VIDEO_KEY_RE = new RegExp(`^(?:${KEY_SEGMENT}/)*${KEY_SEGMENT}\\.(?:${VIDEO_EXTENSIONS.join('|')})$`, 'i')

function canonicalKey(url: unknown, prefix: string | null, keyRe: RegExp): string | null {
  if (typeof url !== 'string' || prefix === null || !url.startsWith(prefix)) return null
  const key = url.slice(prefix.length)
  // A segment that is only dots is refused by the alphanumeric-first rule; "a..b.webp" inside a
  // segment is harmless. Percent-escapes are refused outright rather than decoded.
  return keyRe.test(key) ? key : null
}

export function isListingImageUrl(url: unknown): url is string {
  return canonicalKey(url, PREFIX, RASTER_KEY_RE) !== null
}

export function isListingVideoUrl(url: unknown): url is string {
  return canonicalKey(url, VIDEO_PREFIX, VIDEO_KEY_RE) !== null
}

/** The bucket and object key a canonical first-party public URL names, or null for anything else
 *  — including every alias of a real object. Deletion MUST go through this, never through a regex
 *  over the raw string. */
export function listingObjectKey(url: unknown): { bucket: 'listings' | 'listing-videos'; key: string; url: string } | null {
  const image = canonicalKey(url, PREFIX, RASTER_KEY_RE)
  if (image !== null) return { bucket: 'listings', key: image, url: `${PREFIX}${image}` }
  const video = canonicalKey(url, VIDEO_PREFIX, VIDEO_KEY_RE)
  if (video !== null) return { bucket: 'listing-videos', key: video, url: `${VIDEO_PREFIX}${video}` }
  return null
}

/** The storage host every first-party public URL hangs off (slash-stripped) — the ONE constant the
 *  parser, the ingestion guards and the deletion path all use. */
export const STORAGE_HOST = HOST

/** Does this string address OUR project's storage at all — canonical or not, public object URL or
 *  not? A render/transform URL (`/storage/v1/render/image/public/…?width=`) and a signed URL
 *  (`/storage/v1/object/sign/…`) name our objects too, so anything under `${HOST}/storage/v1/` is
 *  ours. The deletion path uses this to tell "not ours, nothing to delete" from "ours, but a
 *  spelling the parser refuses", which must be reported as unfinished erasure, never skipped. */
export function isFirstPartyStorageUrl(url: unknown): url is string {
  return typeof url === 'string' && !!HOST && url.startsWith(`${HOST}/storage/v1/`)
}

// MOCK images (picsum/loremflickr) are already sized + served from a CDN — running
// them through Vercel's optimizer just burns Image Transformation quota for test
// data. Render them `unoptimized` so they cost zero transformations. No-op for real
// Supabase images. Goes away with the mock data at launch.
export function isMockImageUrl(url: unknown): url is string {
  return typeof url === 'string' && (url.includes('picsum.photos') || url.includes('loremflickr.com'))
}

/** Optimizer URL for places that can't use <Image> (a <video> poster attribute): the raw
 *  storage URL is ~20× the bytes of the optimized variant (measured 346KB vs 16KB) and is
 *  often the LCP fetch on a video listing. `w` must be one of next.config deviceSizes/
 *  imageSizes and `q` one of `qualities` — off-list values 400. */
export function optimizedImageUrl(src: string, w: 360 | 640 | 1080 = 640): string {
  if (!isListingImageUrl(src)) return src // foreign/mock hosts aren't in remotePatterns
  return `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=60`
}
