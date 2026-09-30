import { IS_MARKETPLACE } from '@/lib/edition'
import { readIndexNowKey } from '@/lib/indexnow-key'

/**
 * THE INDEXNOW KEY FILE, served at `/<key>.txt` through one `afterFiles` rewrite (INDEXNOW_KEY_REWRITE
 * in src/lib/indexnow-key.ts, which says why that path routes here safely). SEO wave B, I4.
 *
 * It answers 200 with the key only when ALL hold: this is the marketplace edition (IndexNow pings
 * only eno.vn), `INDEXNOW_KEY` is set and well-formed, and the requested key is exactly that key. Anything else is
 * the same 404 — an unset key, a wrong guess, eno.forum — so the file cannot be used to probe whether
 * a key exists or what it looks like.
 *
 * ⚠️ `no-store` ON BOTH ANSWERS. The key can be rotated with an env change and a container recreate;
 * a cached 200 would keep an old key valid, a cached 404 would keep a new one invisible. Cloudflare
 * does not cache `.txt` here anyway (DYNAMIC, measured in the plan's review). `noindex` because a key
 * file is not a page.
 */
export const dynamic = 'force-dynamic'

/**
 * ⛔ THE KEY IS READ FROM THE PATH, NOT FROM THE REWRITE'S `?k=`. Measured on the production build
 * (Next 16.3.6): behind the `afterFiles` rewrite, `req.url` is the ORIGINAL request — `/<key>.txt`
 * with the visitor's own query — so the destination's `k=:key` never reaches this handler, and a
 * `k`-only check 404'd the real key file while `/<key>.txt?k=<key>` answered 200. So a `/<key>.txt`
 * path is the only source of the key when it is present; `k` counts only on a direct
 * `/api/indexnow-key` request (which reveals nothing: it needs the key to answer).
 */
const KEY_FILE_PATH = /^\/([A-Za-z0-9-]{8,128})\.txt$/
function requestedKey(req: Request): string | null {
  const u = new URL(req.url)
  const fromPath = KEY_FILE_PATH.exec(u.pathname)?.[1]
  if (fromPath) return fromPath
  return u.pathname === '/api/indexnow-key' ? u.searchParams.get('k') : null
}

const HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

export function GET(req: Request): Response {
  const key = IS_MARKETPLACE ? readIndexNowKey() : null
  const k = requestedKey(req)
  if (!key || k !== key) return new Response('Not Found', { status: 404, headers: HEADERS })
  return new Response(key, { status: 200, headers: HEADERS })
}
