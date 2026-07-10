// Cloudflare Stream playback-URL helpers. ISOMORPHIC — uses only the PUBLIC customer
// subdomain (NEXT_PUBLIC_CF_STREAM_CUSTOMER_SUBDOMAIN), never the API token — so it is safe
// to import in client components (the players) AND on the server (URL validation). The token
// and all authenticated CF API calls live in the server-only src/lib/cf-stream.ts.
//
// A listing whose clip lives on Cloudflare Stream stores its HLS manifest URL in
// Listing.video (a real URL, so every existing serialize/security invariant that assumes
// "video is a URL" keeps holding). Shape:
//   https://customer-<sub>.cloudflarestream.com/<uid>/manifest/video.m3u8

const SUB = process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_SUBDOMAIN || ''
export const STREAM_HOST = SUB ? `customer-${SUB}.cloudflarestream.com` : ''

// uid = 32 lowercase hex (Cloudflare Stream identifier).
const HLS_RE = /^https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/([0-9a-f]{32})\/manifest\/video\.m3u8$/

/** Is CF Stream wired on THIS build (public half)? The server also checks the API token via
 *  cfStreamConfigured() before minting uploads. */
export function streamConfigured(): boolean {
  return !!STREAM_HOST
}

/** A canonical, host-pinned CF Stream HLS URL for OUR account — not any cloudflarestream
 *  subdomain. Returns false when the subdomain env is unset (Stream off → nothing validates). */
export function isStreamVideoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !STREAM_HOST) return false
  return HLS_RE.test(url) && url.startsWith(`https://${STREAM_HOST}/`)
}

/** Extract the Stream uid from a canonical HLS URL, else null. Never throws. */
export function streamUidFromUrl(url: string): string | null {
  const m = url.match(HLS_RE)
  return m ? m[1] : null
}

/** Canonical HLS URL for a uid (built from OUR subdomain — the shape isStreamVideoUrl accepts). */
export function streamHlsUrl(uid: string): string {
  return `https://${STREAM_HOST}/${uid}/manifest/video.m3u8`
}

/** A JPEG thumbnail (first-second frame) for a Stream clip — poster fallback when a listing
 *  has a video but no cover photo. Returns null for non-Stream URLs / unconfigured builds. */
export function streamThumbUrl(url: string, height = 640): string | null {
  const uid = streamUidFromUrl(url)
  return uid && STREAM_HOST ? `https://${STREAM_HOST}/${uid}/thumbnails/thumbnail.jpg?time=1s&height=${height}` : null
}

/** Does this source need an HLS player (hls.js / native Safari) rather than a plain <video src>?
 *  True for any .m3u8 (covers CF Stream + any future HLS source); false for the Supabase MP4s. */
export function isHlsUrl(url: unknown): url is string {
  return typeof url === 'string' && url.endsWith('.m3u8')
}
