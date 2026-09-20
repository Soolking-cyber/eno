/**
 * ⛔ THE IMAGE OPTIMIZER WAS FETCHING ITS SOURCES FROM HONG KONG — FROM THE SAME MACHINE.
 *
 * Measured on the box 2026-09-20, from inside `eno-vn-app`, the same four storage objects:
 *
 *     public  https://sb.eno.vn/...     1345 ms mean
 *     internal http://supabase-envoy:8000/...  17 ms mean      (byte-identical)
 *
 * `sb.eno.vn` resolves to Cloudflare inside the container (`2606:4700:…`), so every COLD
 * `/_next/image` request left the box, crossed to Cloudflare's Hong Kong PoP and came back —
 * to collect a file sitting on the same disk — BEFORE sharp had decoded a single pixel. Cold
 * optimizes were measured at 1.9–6.0 s, and ~1.3 s of that was this round trip alone.
 *
 * This loader rewrites ONLY the `url=` parameter handed to the optimizer. The optimizer is the
 * sole consumer of that value: the browser fetches `/_next/image?...`, never the inner URL. An
 * `unoptimized` image bypasses loaders entirely and keeps its public src, which is what keeps
 * `<img src>` and the sitemap/feeds correct.
 *
 * ⚠️ OFF UNLESS `NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN` IS SET. Unset — local dev, CI, the native
 * shell — this returns exactly what Next's built-in loader returns, so nothing changes. The
 * value must be `NEXT_PUBLIC_*` because a loaderFile is bundled into the CLIENT too (it builds
 * the same URL during hydration, and a mismatch between server and client markup is a hydration
 * error). The internal hostname therefore appears in the HTML; it is not routable from outside
 * the Docker network, so that is cosmetic rather than a disclosure.
 *
 * ⛔ THE REWRITE IS ANCHORED ON AN EXACT ORIGIN MATCH, NOT A SUBSTRING. `startsWith` on a bare
 * hostname would also rewrite `https://sb.eno.vn.evil.test/…`; this compares the parsed origin.
 * Anything that is not our storage origin is returned untouched.
 */

type LoaderArgs = { src: string; width: number; quality?: number }

/** The public storage origin, e.g. `https://sb.eno.vn`. Baked at build time like every other NEXT_PUBLIC_*. */
const PUBLIC_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
/** e.g. `http://supabase-envoy:8000` — the Supabase gateway on the container network. */
const INTERNAL_ORIGIN = process.env.NEXT_PUBLIC_IMAGE_INTERNAL_ORIGIN ?? ''

/**
 * Swap the public storage origin for the internal one. Exported for the test: the rewrite is the
 * whole point of the file and a silent no-op would be invisible until someone measured again.
 */
export function internalize(src: string): string {
  if (!INTERNAL_ORIGIN || !PUBLIC_ORIGIN) return src
  // Relative sources (`/icons/…`, `/logo.svg`) are served by Next itself — never rewrite them.
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src
  try {
    const u = new URL(src)
    const pub = new URL(PUBLIC_ORIGIN)
    if (u.origin !== pub.origin) return src
    const internal = new URL(INTERNAL_ORIGIN)
    u.protocol = internal.protocol
    u.host = internal.host // host, not hostname — carries the port
    return u.toString()
  } catch {
    // A malformed src is not this function's problem; hand it back and let the optimizer reject it.
    return src
  }
}

/**
 * Identical output to Next's default loader, except for the origin swap above.
 * ⚠️ `q` DEFAULTS TO 70, NOT 75. `images.qualities` is `[60, 70]`, and Next 16 REJECTS a quality
 * outside that list rather than clamping it — the default 75 would 400 every image that does not
 * pass an explicit `quality`.
 */
export default function enoImageLoader({ src, width, quality }: LoaderArgs): string {
  const url = internalize(src)
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality ?? 70}`
}
