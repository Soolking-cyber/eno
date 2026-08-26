/**
 * The parts of the footer-stats contract BOTH sides need.
 *
 * ⛔ THIS EXISTS SO THE CLIENT NEVER IMPORTS `site-stats.ts`. That module reaches for `node:crypto`
 * and the Prisma client at the top level; importing it from a `'use client'` component pulls both
 * into the browser bundle — in the best case a large regression on a component that renders on
 * EVERY page, and in the usual case a build error. A type and two numbers do not need any of that.
 */

/** How often the client re-pings. Comfortably inside PRESENCE_WINDOW so a reader never blinks out. */
export const HEARTBEAT_MS = 45_000

/**
 * ⛔ `visits`, NOT `visitors`, AND THE DIFFERENCE IS NOT PEDANTIC. The visitor digest is salted with
 * a key that rotates every UTC day and is discarded after 36h, so the same person is a new digest
 * tomorrow and increments the durable total once per day. That is the DIRECT CONSEQUENCE of the
 * privacy design — counting unique people across time requires an identifier that survives time,
 * which is precisely what this refuses to keep. So the number is visits (daily uniques, summed).
 * A reviewer caught the label claiming otherwise; the honest word is the cheaper fix.
 * ⚠️ The SQL column is still `site_visit_total.visitors` — renaming it would be a migration for a
 * name no one outside this file reads. The boundary where it becomes public is here.
 */
export type SiteStats = { visits: number; now: number; members: number; sellers: number }

/**
 * Is this reply worth showing, or is it the endpoint saying "no answer"?
 *
 * ⛔ AN ALL-ZERO REPLY IS NOT DATA. The route answers 200 with zeros when it is throttled or the
 * database is unhappy — deliberately, so a footer widget cannot put a red line in the console of
 * every page. But a zeros object is TRUTHY, so the client accepted it, overwrote real numbers and
 * the row unmounted: one tab past the per-IP limit, or one slow query, and a footer that had been
 * showing live figures went blank. The client comment claimed the opposite ("a failed heartbeat
 * leaves the last numbers up") and a reviewer caught the contradiction.
 * ⚠️ It lives here, as a named function, because the version that shipped that bug was an inline
 * condition inside a fetch callback — the one place in the component nothing can reach to test.
 */
export function hasAnyStat(s: SiteStats | null | undefined): boolean {
  if (!s) return false
  return s.visits > 0 || s.now > 0 || s.members > 0 || s.sellers > 0
}

/**
 * A coarse, stable shape of the user-agent: browser family and platform. NO VERSION.
 *
 * ⛔ THE VERSION USED TO BE IN HERE AND IT WAS THE WHOLE ATTACK. The raw user-agent is a header the
 * caller chooses, and it is half the visitor identity — so with `chrome-${major}` in the output,
 * `Chrome/1`, `Chrome/2`, `Chrome/999999` are three different people. A single address could mint a
 * permanent visitor per request up to the rate limit, into a LOGGED table with no reset path. My
 * comment claimed this "reduces the reachable space to a few dozen" while `(\d+)` left it
 * unbounded, and the test I wrote to prove it (500 inputs produce at most 500 buckets) could not
 * fail. Two reviewers refused the diff over exactly this.
 *
 * ✅ Dropping the version is better on BOTH axes, which is why it is the fix rather than a clamp:
 * the reachable set becomes families x platforms — a real few dozen, enumerable in the test below —
 * and a reader who upgrades Chrome 140 -> 141 stays the same visitor instead of becoming a new one.
 * The version was only ever there for dedup accuracy, and removing it makes dedup MORE accurate.
 */
export function coarseUserAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase()
  // ⚠️ Ordered, and the order is load-bearing: every Chromium browser also says "chrome", Edge and
  // Opera also say "chrome", and Chrome on iOS says "safari" too.
  const FAMILIES: Array<[RegExp, string]> = [
    [/\bedg\//, 'edge'],
    [/\bopr\//, 'opera'],
    [/\b(?:crios|chrome)\//, 'chrome'],
    [/\b(?:fxios|firefox)\//, 'firefox'],
    [/\bsafari\//, 'safari'],
  ]
  const family = FAMILIES.find(([re]) => re.test(ua))?.[1] ?? 'other'

  const PLATFORMS: Array<[RegExp, string]> = [
    [/\bipad/, 'ipados'],
    [/\biphone|\bipod/, 'ios'],
    [/\bandroid/, 'android'],
    [/\bmac os/, 'mac'],
    [/\bwindows/, 'windows'],
    [/\blinux/, 'linux'],
  ]
  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1] ?? 'other'
  return `${family}|${platform}`
}

/** Every value coarseUserAgent can return — 6 families x 7 platforms. The test enumerates it. */
export const COARSE_UA_FAMILIES = ['edge', 'opera', 'chrome', 'firefox', 'safari', 'other'] as const
export const COARSE_UA_PLATFORMS = ['ipados', 'ios', 'android', 'mac', 'windows', 'linux', 'other'] as const
