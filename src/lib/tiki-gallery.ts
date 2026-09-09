/**
 * Pure helpers for recovering a Tiki product gallery. Kept out of
 * `scripts/backfill-tiki-gallery.ts` because that file imports `../src/lib/db` at module scope,
 * so nothing declared there can be unit-tested — the same reason `feedFor`/`modelFor` were
 * lifted out of the AccessTrade importer after an untestable inline rule invented a product
 * across six live listings.
 */

/**
 * The Tiki product id, recovered from an AccessTrade affiliate deep link.
 *
 * ⛔ THE ID IS TWO LAYERS DOWN. The stored link is
 * `https://go.isclix.com/deep_link/<pub>/<campaign>?url=<percent-encoded tiki url>`, and only
 * the decoded inner url carries `…-p<id>.html`. Matching digits in the OUTER url would happily
 * return the publisher id — a plausible number that fetches the wrong product, or nothing.
 */
export function tikiProductId(affiliateUrl: string | null): string | null {
  if (!affiliateUrl) return null
  try {
    const target = new URL(affiliateUrl).searchParams.get('url')
    const m = /-p(\d+)\.html/.exec(target ? decodeURIComponent(target) : affiliateUrl)
    return m?.[1] ?? null
  } catch {
    // A malformed link is not worth throwing over — scan it directly and let the caller
    // count a null as a miss.
    const m = /-p(\d+)\.html/.exec(affiliateUrl)
    return m?.[1] ?? null
  }
}

/**
 * Hosts Tiki serves product imagery from. Anything else is refused.
 *
 * ⛔⛔ THIS IS AN SSRF BOUNDARY, NOT TIDINESS. These URLs come from a third-party API response
 * and are handed straight to `hostImage`, which FETCHES THEM SERVER-SIDE FROM THE PRODUCTION VN
 * BOX — a box that sits on the same Docker network as Postgres, the Supabase gateway and both
 * app containers. A `startsWith('http')` check accepts `http://127.0.0.1:8000/`,
 * `http://169.254.169.254/latest/meta-data/` and any attacker-controlled host, turning a
 * compromised or spoofed upstream response into a request originating INSIDE the perimeter
 * (codex, reviewing this script). Allowlist the CDN and require TLS.
 */
const TIKI_CDN = /^https:\/\/([a-z0-9-]+\.)*tikicdn\.com\//i

export function isTikiCdnUrl(u: string): boolean {
  // Parsed, not pattern-matched on the raw string: `https://evil.com/#https://salt.tikicdn.com/`
  // and userinfo tricks (`https://salt.tikicdn.com@evil.com/`) both defeat a bare regex.
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    return TIKI_CDN.test(`${url.protocol}//${url.hostname}/`)
  } catch {
    return false
  }
}

/**
 * Gallery URLs from a Tiki product-detail response body, or null if this is not a real answer
 * FOR THIS PRODUCT.
 *
 * ⛔ THE BOT CHALLENGE IS SERVED AS HTTP 200 text/html. Measured 2026-09-09: from a non-Vietnam
 * IP this endpoint returns an 18KB challenge page with a 200 status, so `res.ok` is TRUE for a
 * response containing no product at all. Parsing is the only honest test, which is why this
 * takes the raw body rather than a parsed object.
 *
 * ⛔ AND PARSING ALONE IS NOT ENOUGH — TWO WAYS IT LIES. A throttle response like
 * `{"error":"rate limited"}` is valid JSON with no `images`, so it would read as "this product
 * genuinely has one photo" and reset the caller's backoff, letting it hammer through a block it
 * caused. And a response for a DIFFERENT product would silently attach someone else's
 * photographs to the listing. Both are ruled out by requiring the payload to identify itself as
 * the product that was asked for (codex and astra, reviewing this script).
 */
export function parseTikiGallery(body: string, max: number, expectId?: string): string[] | null {
  // Trimmed: a leading BOM or whitespace is still JSON, and calling it a bot challenge would
  // trigger a pointless cooldown (codex).
  // Trimmed BEFORE BOTH the shape check and the parse: `String.trim` strips a BOM, so checking
  // the trimmed string and then parsing the ORIGINAL turned a valid BOM-prefixed response into a
  // parse failure — which the caller reads as "blocked" and cools down on (astra).
  const text = body.trim()
  if (!text.startsWith('{')) return null
  let json: { id?: unknown; name?: unknown; images?: unknown }
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  // A product response always carries an id and a name; an error envelope carries neither.
  if (json.id == null || typeof json.name !== 'string') return null
  if (expectId != null && String(json.id) !== String(expectId)) return null
  // ⚠️ SHAPE-CHECKED, NOT ASSUMED. `{"images":{}}` and `[null]` are valid JSON that throw inside
  // `.map`, and the caller turns any exception into "blocked" — so a malformed-but-successful
  // response would trigger a three-minute cooldown it did not need (codex).
  const raw: { base_url?: string; large_url?: string }[] = Array.isArray(json.images) ? json.images : []
  const picked = raw.map((i) => (i && typeof i === 'object' ? i.large_url || i.base_url : undefined))

  // ⛔ IF THE COVER IS NOT USABLE, NEITHER IS THE GALLERY. raw[0] is the shot the card and the
  // PDP hero use. Filtering rejected URLs out silently PROMOTES a detail shot to index 0, and
  // every downstream guard — including "all of them hosted" — then happily replaces a good
  // existing cover with a close-up, permanently (astra, twice). Refusing the whole product is
  // correct and cheap: the row stays eligible and a later run can retry it.
  if (picked.length > 0 && !(typeof picked[0] === 'string' && isTikiCdnUrl(picked[0]))) return []

  const urls = picked.filter((u): u is string => typeof u === 'string' && isTikiCdnUrl(u))
  // Deduped: Tiki repeats the cover in `images` for some products, and a gallery of the same
  // photo five times is worse than one photo.
  return Array.from(new Set(urls)).slice(0, Math.max(1, Math.floor(max)))
}
