// Single source of truth for "is this a valid first-party listing image URL".
// Pinned to OUR Supabase project's public `listings` bucket — NOT any
// *.supabase.co project — so a stored avatar/listing image can't point at an
// attacker-controlled bucket (content that bypassed our raster-only upload).
const HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const PREFIX = HOST ? `${HOST}/storage/v1/object/public/listings/` : null

export function isListingImageUrl(url: unknown): url is string {
  return typeof url === 'string' && PREFIX !== null && url.startsWith(PREFIX)
}

// Same host-pinned guard for a listing's optional video — our project's public
// `listing-videos` bucket only, so a stored video URL can't point at an
// attacker-controlled bucket that bypassed the upload route's validation.
const VIDEO_PREFIX = HOST ? `${HOST}/storage/v1/object/public/listing-videos/` : null

export function isListingVideoUrl(url: unknown): url is string {
  return typeof url === 'string' && VIDEO_PREFIX !== null && url.startsWith(VIDEO_PREFIX)
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
