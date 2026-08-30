import { fold } from './fold'

// Pure @handle rules — client-safe (no db / server-only), shared by the server lib
// (src/lib/handle.ts), the editor UI, the /@name route, and unit tests.

/** Canonical form: starts with a letter, then letters/digits/underscore, 3–30 chars. */
/**
 * ⛔ HYPHEN IS ALLOWED BECAUSE A HANDLE IS NOW ALSO A HOSTNAME. Owner, 2026-08-30: a shop's handle
 * answers as `<handle>.eno.vn`. RFC 1123 permits letters, digits and HYPHEN in a host label and
 * forbids UNDERSCORE, while this grammar was the exact inverse — so `slugifyHandle` turning every
 * space into `_` meant a shop called "Bob's Store" auto-claimed `bob_s_store` and could never have
 * a subdomain. That is not an edge case: it is every multi-word shop name on the marketplace.
 *
 * ⚠️ ADDITIVE IN PRACTICE, AND MEASURED RATHER THAN ASSERTED. `_` stays legal, so every handle
 * claimed before today keeps working exactly as it did — with one caveat a reviewer was right to
 * raise: the end-anchor below means a handle ENDING in `_` (`hoa_`), legal under the old grammar
 * and reachable by typing rather than by slugify, would now fail validation. Checked against
 * production on 2026-08-30: 12 handles exist and 0 of them fail the new regex. If that ever stops
 * being true the fix is a migration, not a loosening of the anchor — a trailing separator cannot
 * be a host label.
 * The rest of the guarantee is unchanged — `sdc_store` is still `sdc_store` and still resolves at
 * `eno.vn/sdc_store`. It simply has no subdomain, which is what `isHostnameLabel` in
 * storefront-host.ts already decides. Rewriting existing handles would break links people have
 * shared and free names for squatters; only NEW auto-claims take the hyphen.
 *
 * ⛔ THE END ANCHOR IS PART OF THE GRAMMAR, NOT LEFT TO `slugifyHandle`. The first version was
 * `[a-z][a-z0-9_-]{2,29}` and its own comment claimed the ends were alphanumeric; three reviewers
 * pointed out that `bob-` matches it. Auto-claimed handles were safe because slugify strips a
 * trailing separator — but a handle TYPED into the handle editor or POSTed to /api/handle is
 * validated by this regex alone, and `bob-` is a legal handle and an illegal host label. So the
 * shape is spelled out here: a leading letter, a trailing alphanumeric, 3–30 characters.
 */
export const HANDLE_RE = /^[a-z][a-z0-9_-]{1,28}[a-z0-9]$/

// Names that must never be claimable: every top-level route (so /@x can't shadow or
// impersonate an app page) + platform-identity words an impersonator would want.
// Keep lowercase. Route additions should be mirrored here.
const RESERVED = new Set([
  // app routes
  'about', 'account', 'admin', 'api', 'appeal', 'auth', 'brands', 'c', 'dashboard',
  'developers', 'dispute', 'disputes', 'guide', 'help', 'listings', 'messages', 'onboard', 'post', 'privacy',
  'prohibited', 'regulations', 'reports', 'safety', 'saved', 'search', 'sellers',
  'signin', 'signup', 'sitemap', 'terms', 'trust',
  // ⚠️ `docs` IS NOT AN app ROUTE — IT IS A REWRITE, WHICH IS EXACTLY WHY IT IS EASY TO MISS.
  // next.config.ts rewrites /docs -> /developers in `afterFiles`, which Next resolves BEFORE
  // dynamic routes, so it outranks src/app/[handle]. A seller holding `docs` would have a
  // permanently unreachable storefront. If this list is ever regenerated from `src/app/*`
  // directories, a rewrite-only path is precisely what such a generator would drop — keep it.
  'docs',
  // ⚠️ SURFACED BY THE INVARIANT TEST, NOT BY REVIEW — it was already unsafe before /docs existed.
  // next.config.ts 307s /travel -> /vietnam-evisa on the SERVICES edition. Edition-gated and only
  // a 307, so milder than the cases above, but the shape is identical: config resolves before
  // dynamic routes, so a seller holding `travel` on eno.forum would have an unreachable
  // storefront. Unclaimed when reserved (measured 2026-08-24: eno.vn/travel 404).
  'travel',
  // platform identity / staff impersonation
  'eno', 'enovn', 'eno_vn', 'official', 'support', 'moderator', 'mod', 'staff',
  'team', 'security', 'verify', 'verified', 'system', 'notifications', 'billing',
  'payment', 'payments', 'root', 'www', 'mail', 'info', 'contact', 'login', 'logout',
  'settings', 'user', 'null', 'undefined', 'anonymous',
  // ⚠️ RETIRED HANDLE THAT IS NOW A PERMANENT REDIRECT. The e-Visa desk was @eno_vietnam until it
  // was renamed to @eno_visa (2026-07-23); next.config.ts now 308s the old path to the new one so
  // the indexed URL moves instead of 404ing. That redirect runs BEFORE routing, so if anyone were
  // allowed to register `eno_vietnam` their storefront would be permanently unreachable — and
  // because a 308 is cached by the browser, removing the rule later would not repair it for anyone
  // who had already followed it. Reserving the name is the only way to make the redirect safe.
  'eno_vietnam',
])

export function isReservedHandle(h: string): boolean {
  /**
   * ⛔ SEPARATORS ARE STRIPPED BEFORE THE CHECK, AND THAT CLOSED A PHISHING HOLE THE HYPHEN OPENED.
   * A reviewer found it: the moment `-` became legal AND handles became hostnames, `sign-in` was
   * claimable and `sign-in.eno.vn` is a credible sign-in page on a product whose whole auth flow is
   * passwordless links. `signin` was reserved; `sign-in` was not, because the set is compared by
   * exact string. Folding `-` and `_` out first means one entry in RESERVED covers every spelling
   * of it — `sign-in`, `sign_in`, `s-i-g-n-i-n` — instead of the list needing a row per variant.
   * ⚠️ IT DOES NOT CATCH COMPOUNDS like `eno-support`, and no character rule would; that is what
   * the brand check in storefront.ts and human moderation are for. What this closes is the exact
   * class the grammar change created: an existing reserved word re-spelled with a separator.
   */
  return RESERVED.has(h) || RESERVED.has(h.replace(/[-_]/g, ''))
}

/** Validate an already-lowercased candidate. Returns an error code or null when OK. */
export function validateHandle(h: string): 'invalid' | 'reserved' | null {
  if (!HANDLE_RE.test(h)) return 'invalid'
  if (isReservedHandle(h)) return 'reserved'
  return null
}

/** "Nguyễn Văn Ánh" → "nguyen_van_anh", "Apple Store" → "apple_store".
 *  Diacritics fold to ASCII; anything non-alphanumeric collapses to single "_".
 *  Guarantees a VALID base (letter-first, ≥3 chars) — pads/prefixes when the
 *  source name can't supply one (e.g. an all-digit or all-emoji name). */
export function slugifyHandle(name: string | null | undefined): string {
  /**
   * ⚠️ HYPHEN, NOT UNDERSCORE, AND THAT ONE CHARACTER IS WHY A NEW SHOP GETS A SUBDOMAIN. This
   * produced `_` for every run of punctuation, so "Bob's Store" became `bob_s_store` — a perfectly
   * good handle and an impossible hostname. See HANDLE_RE above.
   * ⚠️ TRAILING SEPARATORS ARE STRIPPED AFTER the 30-char cut as well as before it, because the
   * slice can leave one at the end; `bob-` matches HANDLE_RE and is not a legal host label.
   */
  let s = fold(String(name || ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 30)
    .replace(/-+$/, '')
  if (!/^[a-z]/.test(s)) s = `u${s}`.slice(0, 30).replace(/-+$/, '')
  while (s.length < 3) s += String(Math.floor(Math.random() * 10))
  return s
}
