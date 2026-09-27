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
 * shell — the origin swap does nothing and remote sources get Next's own optimizer URL. (Local
 * files are the one deliberate difference from the built-in loader: see `servedAsIs` below.) The
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
 * The ONE local path the optimizer may read: the read-only listing-image route. It must equal
 * `images.localPatterns` in next.config.ts (src/lib/image-config.test.ts pins the two together).
 * A route handler answers the optimizer's internal read itself, so it is not exposed to the hang
 * described below — measured 2026-09-27, a dropped first request left it unaffected.
 */
export const OPTIMIZED_LOCAL_PATH = '/listing-images'

/**
 * A plain static image FILE: `/` + path segments of `[A-Za-z0-9._-]` that do not start with a dot,
 * ending in an image extension, and nothing else — no query, fragment, `%`, backslash, whitespace or
 * control character, no empty/`.`/`..` segment, nothing under `/api/`. That is every local image
 * the app renders through `<Image>` (the CI fixture `/icons/ui/rest/camera.svg`, job-preview covers
 * `/<dir>/<id>.png`, `/_next/static/media/*`).
 */
const STATIC_IMAGE_FILE =
  /^\/(?!api\/)(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i

/**
 * ⛔ A LOCAL FILE NEVER GOES THROUGH THE OPTIMIZER. IT HUNG EVERY PAGE THAT SHOWED ONE.
 *
 * Next 16.3.x reads a local `url=` through a fake request/response bound to the CLIENT's real
 * socket (image-optimizer.js `fetchInternalImage`) and awaits it with no timeout. If the browser
 * has already dropped that request (it navigated, closed the tab or a retry replaced it), the
 * static file server sees a dead socket and destroys its stream without ever ending the fake
 * response. The per-variant dedupe promise (url × w × q × Accept) then NEVER settles: every later
 * request for that variant hangs until the server restarts, and so does the `load` event of every
 * page that uses it. That took out 13 of 20 CI e2e tests on 2026-09-27: the fixture photo is a
 * local SVG, and at 1280px every card on `/` asks for the same variant. Remote sources are immune
 * (no borrowed socket, and a 7s timeout). scripts/patch-next-image-optimizer.mjs now fixes Next
 * itself at build time (upstream's fix, vercel/next.js#98168); this and `localPatterns` stay as
 * the second wall, and they are what keeps public/ out of the optimizer's reach at all.
 *
 * Next's OWN loader already serves an `.svg` as-is (get-img-props.js: `isDefaultLoader &&
 * src.endsWith('.svg')` → unoptimized); `loaderFile` switches that off, which is how the SVG got
 * here. This serves every local image FILE as-is, because the hang was not SVG-specific — a dropped
 * first request for `/icon-192.png` wedged its variant too. A srcset then repeats one URL at each
 * width, which is valid. `images.localPatterns` is narrowed to OPTIMIZED_LOCAL_PATH to match, so a
 * hand-built `/_next/image?url=/<file>` is a 400 before anything is read.
 * ⚠️ A LOCAL IMAGE IS THEREFORE SENT AT ITS ORIGINAL SIZE. Give it a file sized for where it
 * renders, never a big raster to scale down — install-hint.tsx swapped the 7.9 KB /icon-192.png
 * for a 1.5 KB 120px AVIF/WebP pair drawn at 40px for exactly this reason.
 *
 * ⛔ AN ALLOWLIST OF SHAPES, NOT "ANYTHING STARTING WITH /". Served as-is, a src is fetched by the
 * VIEWER's browser, same-origin, with the viewer's cookies; through the optimizer a local src is
 * read server-side with none, and refused unless it is /listing-images. So only a plain image file
 * may take this path, and everything else a src could be falls through to the optimizer's 400:
 *   · `/auth/confirm?token_hash=…`, `/api/…` — a GET with side effects, fired by every viewer;
 *   · `/\t/evil.test/x.png`, `/\n/…` — browsers DELETE tab/CR/LF from a URL, so it becomes
 *     `//evil.test/x.png`, another origin; `//host` and `/\host` are that directly;
 *   · `/icons/../api/me`, `%2e%2e`, `%2F` — dot segments and encodings resolve somewhere else.
 * Stored srcs are validated where they are written (isListingImageUrl) — this does not rely on it.
 *
 * ⚠️ In `next dev` this prints "loader … does not implement width" once per such src. That warning
 * is exactly the intent here, and production builds do not emit it.
 */
export function servedAsIs(src: string): boolean {
  return STATIC_IMAGE_FILE.test(src)
}

/**
 * Next's default loader, plus the origin swap above, minus the optimizer for local files.
 *
 * ⚠️ `q` DEFAULTS TO 60, AND NOT SPECIFYING ONE IS NOT THE SAME AS NEXT'S DEFAULT. Next's built-in
 * loader runs `findClosestQuality(quality, config)`, which snaps its undefined-quality default of
 * 75 to the nearest configured value — with `qualities: [60, 70]` that is **70**. So an `<Image>`
 * with no `quality` used to land on the expensive tier by accident. 60 is what every deliberate
 * call site in the app asks for; matching it keeps the whole app on ONE tier, which is the point.
 * ⛔ A quality outside `images.qualities` is REJECTED by Next 16, not clamped — so this default
 * must stay a member of that list.
 */
export default function enoImageLoader({ src, width, quality }: LoaderArgs): string {
  if (servedAsIs(src)) return src
  const url = internalize(src)
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality ?? 60}`
}
