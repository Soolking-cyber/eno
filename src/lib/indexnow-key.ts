/**
 * THE INDEXNOW KEY: ONE ENV VALUE, ONE SHAPE, ONE REWRITE (SEO wave B, I4).
 *
 * IndexNow proves a ping comes from the site's owner by fetching a key file from the site itself.
 * We use the protocol's "Option 1": the file lives at `https://eno.vn/<key>.txt` and holds the key,
 * and every ping also names it in `keyLocation`. Nothing is in `public/`, because the key is a
 * secret until it is set: `/<key>.txt` is rewritten (next.config.ts, `afterFiles`) to
 * src/app/api/indexnow-key/route.ts, which answers only for the exact key in `INDEXNOW_KEY`.
 *
 * ⛔ DORMANT UNTIL THE KEY IS SET. With `INDEXNOW_KEY` unset or malformed, the key file 404s for every
 * path and the cron (src/app/api/cron/indexnow/route.ts) answers `{skipped:'no_key'}` without
 * reading or writing anything. The owner's steps to switch it on are decision I-d in the wave-B plan.
 *
 * Imported by next.config.ts, so this module stays dependency-free.
 */

/** The protocol allows 8–128 characters of `a-z A-Z 0-9 -`. `openssl rand -hex 16` gives 32 hex. */
export const INDEXNOW_KEY_RE = /^[A-Za-z0-9-]{8,128}$/

/**
 * The key, or null when it is unset OR malformed. A malformed key is treated as no key at all: the
 * key file would 404 and IndexNow would reject every ping, so sending would only burn the quota.
 */
export function readIndexNowKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim()
  return key && INDEXNOW_KEY_RE.test(key) ? key : null
}

/**
 * THE `afterFiles` REWRITE THAT SERVES THE KEY FILE. `/abcd1234.txt` → `/api/indexnow-key?k=abcd1234`.
 *
 * Why it routes safely (the wave-B plan, I4, verified in the rewrite test and on a production build):
 *   · `afterFiles` runs after the filesystem check, which covers `public/` and the app routes with no
 *     dynamic segment, so `/robots.txt` and `/llms.txt` (`src/app/*.txt/route.ts`) win before this is
 *     tried — and both names are under 8 characters, so the source could not match them anyway. (A
 *     route UNDER `[lang]` is dynamic and would lose to an afterFiles rule: src/lib/root-segments.ts.
 *     A root `.txt` route is never under `[lang]`, because the proxy skips dotted paths.)
 *   · it runs before dynamic routes, so `[lang]/[handle]` never sees the path — and a handle cannot
 *     contain a dot (HANDLE_RE) anyway;
 *   · the proxy's page matcher skips every dotted path (src/proxy.ts `config.matcher`), so the path
 *     is neither rewritten into `[lang]` nor subjected to the `/api/*` edge pin.
 * ⚠️ The destination's `?k=:key` does NOT reach the handler: behind an afterFiles rewrite `req.url` is
 * the original `/<key>.txt` (measured on the production build), so the route reads the key from that
 * path (src/app/api/indexnow-key/route.ts).
 * ⚠️ THE ACCEPTED COST: any other unknown root path of that shape (`/something-else.txt`) now gets this
 * route's plain `no-store` 404 instead of the app's 404 page or the markdown 404 (opus, diff review).
 * Nothing is served there today; a real root `.txt` file goes in `public/` or its own route, which win.
 * One segment only: `/x/abcdefgh.txt` does not match. An underscore is outside the class, so
 * `/abc_defgh.txt` does not either.
 */
export const INDEXNOW_KEY_REWRITE = {
  source: '/:key([A-Za-z0-9-]{8,128})\\.txt',
  destination: '/api/indexnow-key?k=:key',
} as const
