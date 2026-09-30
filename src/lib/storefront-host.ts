import { HANDLE_RE, isReservedHandle } from './handle-format'

/**
 * WHICH HOST IS A SHOP'S STOREFRONT.
 *
 * A verified shop gets its handle as a subdomain — `apple.eno.vn` serves the same catalogue as
 * `eno.vn/apple`, styled like the home page but scoped to that shop. This module answers one
 * question, purely: given a Host header, is this a storefront, and whose?
 *
 * ⚠️ CLIENT-SAFE AND IMPORT-FREE BY DESIGN, the same rule `edition.ts` follows. It runs in the
 * proxy (edge runtime), in server components, and in client code that needs to build a storefront
 * URL. Anything server-only imported here would make those last two a build error. The DATABASE
 * half — does this handle belong to a shop that is verified TODAY — lives in `storefront.ts`.
 *
 * ⛔ THIS IS A SECURITY BOUNDARY, NOT A CONVENIENCE PARSER. The Host header is client-supplied.
 * Everything downstream — which shop's listings load, which canonical URL is emitted, whether the
 * session cookie is in scope — keys off what this function returns, so it fails CLOSED: anything
 * it does not positively recognise as `<handle>.<appHost>` is `null`, and null means "the ordinary
 * site", never "some shop".
 */

/**
 * ⛔ SUBDOMAINS THAT ARE INFRASTRUCTURE, NOT SHOPS. A handle in this set can still exist and still
 * work at `eno.vn/<handle>`; what it may not do is answer on a subdomain, because something else
 * already does.
 *
 * ⚠️ `sb` IS THE ONE THAT WOULD HAVE HURT. `sb.eno.vn` is the Supabase gateway on the VN origin
 * box, and it is the vhost the mTLS work terminates on — nginx matches an exact `server_name`
 * before a wildcard, so it would have kept working at the edge while this app happily resolved
 * `sb` as a shop handle and served a storefront for anyone who reached it another way. Reserving
 * it here keeps the two layers telling the same story.
 *
 * ⚠️ THIS IS NOT THE `RESERVED` LIST IN handle-format.ts, and it must not be merged with it. That
 * list protects PATHS (`eno.vn/admin` must route to the admin app, so no one may hold that
 * handle). This one protects HOSTS. The sets overlap but neither contains the other: `sb` is a
 * host nobody may serve yet is a perfectly legal path, and `docs` is a path that must stay
 * unclaimable yet is meaningless as a host. Keeping them apart is what stops a future edit to one
 * silently changing the other.
 */
const INFRA_SUBDOMAINS = new Set([
  'www',
  'sb', // Supabase gateway vhost on the origin box — see above
  'teacher', // teacher.eno.vn = the teacher sign-up form, rewritten in proxy.ts (2026-09-30)
  'api',
  'cdn',
  'static',
  'assets',
  'img',
  'images',
  'media',
  'mail',
  'smtp',
  'imap',
  'mx',
  'ns',
  'ns1',
  'ns2',
  'dns',
  'vpn',
  'ssh',
  'ftp',
  'db',
  'admin',
  'internal',
  'staging',
  'stage',
  'dev',
  'test',
  'preview',
  'status',
  'metrics',
  'grafana',
  'edge',
  'origin',
  'proxy',
  'link',
  'go',
  'email',
  'autodiscover',
  'autoconfig',
  '_domainkey',
])

/**
 * The registrable host storefronts hang off, given this edition's canonical app URL.
 *
 * ⛔ `www.` IS STRIPPED, AND NOT DOING SO WAS A REAL DEFECT THAT TESTS HID. The services edition's
 * canonical is `https://www.eno.forum`, so a base taken verbatim from it is `www.eno.forum` — and
 * then the real storefront `shop.eno.forum` does not resolve (the visitor silently gets the
 * ordinary forum home page under the shop's own host), while `shop.www.eno.forum` DOES, a
 * two-label host no wildcard certificate can cover. A reviewer derived it from the diff; the unit
 * tests missed it because they passed `'eno.forum'` in by hand and never exercised the derivation.
 * ⚠️ EVERY CALLER MUST USE THIS — the proxy's rewrite, the server resolver and `storefrontUrl`. The
 * bug existed because one of the three stripped `www` and the others did not.
 */
export function storefrontBaseHost(appUrl: string | null | undefined): string {
  if (!appUrl) return ''
  try {
    return new URL(appUrl).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** True when this label may never be a storefront, whatever the handle rules say. */
export function isInfraSubdomain(label: string): boolean {
  return INFRA_SUBDOMAINS.has(label)
}

/**
 * Can a storefront answer on this host label at all — shape and reservations only, no database.
 * ⚠️ THE ONE TEST BOTH DIRECTIONS USE: `storefrontHandleFromHost` (host → label) and
 * `storefrontSubdomainLabel` (handle → label). If they disagreed, a canonical or a Copy link could
 * name a host the proxy then refuses to route (it would serve the ordinary site, or a 404).
 */
function isStorefrontLabel(label: string): boolean {
  // The handle namespace's own shape and reservations. A reserved handle cannot be claimed, so it
  // cannot be a shop — but checking it here means an entry added to that list stops resolving as a
  // host immediately, without a second edit.
  return !isInfraSubdomain(label) && HANDLE_RE.test(label) && !isReservedHandle(label) && isHostnameLabel(label)
}

/**
 * ⛔ A STOREFRONT'S SUBDOMAIN LABEL IS ITS HANDLE WITH THE UNDERSCORES REMOVED — owner, 2026-09-28:
 * "remove underscore in subdomains only together". `sdc_store` → `sdcstore.eno.vn`, `a_b_c` → `abc`;
 * a hyphen is a legal host character and stays (`eno-trading.eno.vn`). Null when the handle has no
 * subdomain at all: a label that is an infra host (`s_b` → `sb`), too short (`a_b` → `ab`, under the
 * 3-character grammar), or reserved — the caller then uses the path, `eno.vn/<handle>`.
 *
 * ⚠️ SHAPE ONLY, AND THAT IS NOT THE WHOLE ANSWER. Two handles can share a label (`sdc_store` and
 * `sdcstore`, `ab_cd` and `abc_d`); which of them the host serves — if either — is a database question,
 * `storefrontByLabel` in storefront.ts: the exact handle first, else the ONE handle that strips to it,
 * and nobody when two do. So "is this shop's subdomain its canonical" is `storefrontCanonical`, never
 * this function alone. `claimHandle` refuses a new handle whose label is already taken, so a collision
 * can only be one that predates 2026-09-28.
 */
export function storefrontSubdomainLabel(handle: string): string | null {
  const h = handle.toLowerCase()
  if (!HANDLE_RE.test(h) || isReservedHandle(h)) return null
  const label = subdomainKey(h)
  return isStorefrontLabel(label) ? label : null
}

/**
 * The underscore-stripped form: the key two handles must not share (`claimHandle`), and the label a
 * handle's subdomain would have. Kept apart from `storefrontSubdomainLabel` because the uniqueness
 * rule applies to EVERY handle, including one whose label can never be a host.
 */
export function subdomainKey(handle: string): string {
  return handle.toLowerCase().replace(/_/g, '')
}

/**
 * WHAT A HOST WITH AN UNDERSCORE IS. Null when the host has none (the ordinary rules apply); otherwise
 * `{ label }` — the storefront host it should have been, `sdc_store.eno.vn` → `sdcstore` — or
 * `{ label: null }` when it names nothing a storefront could answer on.
 *
 * ⛔ THE BUG THIS CLOSES, MEASURED LIVE 2026-09-29: `https://sdc_store.eno.vn/` answered 200 with the
 * WHOLE marketplace (canonical `https://eno.vn`, no noindex), and so did its `/llms.txt`, which Search
 * Console lists as crawled. The wildcard DNS and certificate cover the name, Cloudflare and nginx pass
 * it on, and `storefrontHandleFromHost` returned null for it (an underscore is not a host label), and
 * null meant "the ordinary site". `sdc_store.eno.forum` did the same on the forum.
 * ⚠️ ANY UNDERSCORE, ANYWHERE IN THE HOST, and never a legitimate one: RFC 1123 has no underscore in
 * a host name, so no real visitor, link or service of ours can be using one. The proxy 308s the first
 * kind to the storefront host on this edition's own zone and 404s (noindex) the second, the same
 * answer an unknown storefront host gets.
 */
export function underscoreHost(host: string | null | undefined, appHost: string): { label: string | null } | null {
  if (!host) return null
  const h = stripPort(host).toLowerCase()
  if (!h.includes('_')) return null
  const base = stripPort(appHost).toLowerCase()
  if (!base || !h.endsWith('.' + base)) return { label: null }
  const label = h.slice(0, -(base.length + 1))
  // One label deep, like a storefront host (see storefrontHandleFromHost on why).
  if (!label || label.includes('.')) return { label: null }
  const stripped = subdomainKey(label)
  return { label: isStorefrontLabel(stripped) ? stripped : null }
}

/**
 * The storefront LABEL a Host header addresses, or null for the ordinary site.
 * ⚠️ A LABEL, NOT YET A HANDLE (2026-09-28): `sdcstore.eno.vn` gives `sdcstore`, which is the
 * subdomain of the handle `sdc_store`. Turning the label into the shop is the database's job
 * (`storefrontByLabel`); this stays shape-only because the proxy that calls it has no database.
 *
 * `appHost` is the canonical host of THIS edition — `eno.vn` on the marketplace, `eno.forum` on
 * services — so a storefront on one edition can never be resolved from the other's traffic. Pass
 * it in rather than reading it here: this file has no imports by design, and the caller already
 * knows which edition it is.
 *
 * ⚠️ EXACTLY ONE LABEL DEEP, AND THAT IS A TLS CONSTRAINT BEFORE IT IS A PRODUCT ONE. Cloudflare's
 * universal certificate covers `*.eno.vn` but NOT `*.*.eno.vn`, so `a.b.eno.vn` cannot present a
 * valid certificate at all. Resolving it here would mean the app believed in a storefront the
 * browser could never reach without a warning — and it would let a nested label smuggle a second
 * shop name past anything that only inspects the leftmost one.
 *
 * ⚠️ THE PORT IS STRIPPED because a Host header carries one on localhost (`apple.localhost:3000`)
 * and behind some proxies. IPv6 literals are bracketed (`[::1]:3000`) and are never a storefront,
 * so they fall out as "not a match" rather than needing their own branch.
 */
export function storefrontHandleFromHost(host: string | null | undefined, appHost: string): string | null {
  if (!host || !appHost) return null
  const h = stripPort(host).toLowerCase()
  const base = stripPort(appHost).toLowerCase()
  if (!h || !base || h === base) return null
  if (!h.endsWith('.' + base)) return null
  const label = h.slice(0, -(base.length + 1))
  // Exactly one label: no dots left over once the base is removed.
  if (!label || label.includes('.')) return null
  return isStorefrontLabel(label) ? label : null
}

/**
 * ⛔ A HANDLE IS NOT A HOSTNAME, AND THIS PROJECT'S GRAMMAR IS INVERTED FROM DNS'S. `HANDLE_RE` is
 * `^[a-z][a-z0-9_]{2,29}$` — it ALLOWS underscore and REJECTS hyphen. RFC 1123 does the opposite:
 * hyphen is legal in a hostname label, underscore is not, and CA/Browser Forum rules bar `_` from
 * a certificate's dNSNames outright. So `sdc_store.eno.vn` is not a name a certificate can cover
 * or a browser will reliably resolve — and `sdc_store` is a real shop on this marketplace today,
 * as are `eno_visa` and `eno_vn`.
 *
 * ⚠️ A REVIEWER FOUND THIS IN THE TESTS, WHICH ASSERTED IT BACKWARDS. The suite used
 * `apple_store.eno.vn` as its canonical PASSING case and `my-shop.eno.vn` as a failing one with
 * the comment "hyphen not in grammar". Both were right about the handle grammar and wrong about
 * the internet, so the feature would have published unreachable addresses as shops' canonical URLs
 * — the one part of this that a shop hands out on a business card.
 *
 * ⛔ REVERSED 2026-09-28: THE HANDLE IS NOW REWRITTEN, BY DROPPING THE UNDERSCORES — owner: "remove
 * underscore in subdomains only together", so `sdc_store` answers at `sdcstore.eno.vn`
 * (`storefrontSubdomainLabel`). This note used to say the answer was to withhold the subdomain,
 * because mapping `_`→`-` would make `a_b` and `a-b` one host while the handle namespace calls them two
 * names. Dropping `_` keeps that objection alive in another spelling (`a_b` and `ab`), and it is met
 * where it has to be: `claimHandle` refuses a handle whose stripped form another handle already has,
 * and `storefrontByLabel` serves nobody on a label two old handles share. `-` still maps to itself.
 */
export function isHostnameLabel(label: string): boolean {
  // RFC 1123: letters, digits and hyphen; never leading or trailing hyphen; 63 octets max.
  return label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)
}

/**
 * Host without its port. Bracketed IPv6 keeps its brackets, which is what makes the caller's
 * `endsWith('.' + base)` test fail for it rather than matching something surprising.
 */
function stripPort(host: string): string {
  const trimmed = host.trim()
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    return close === -1 ? trimmed : trimmed.slice(0, close + 1)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/**
 * The public URL of a shop's storefront.
 *
 * ⚠️ RETURNS THE PATH FORM WHEN THE HANDLE CANNOT BE A HOST. Every shop has `eno.vn/<handle>`;
 * only some have `<label>.eno.vn`. A caller that linked to the subdomain unconditionally would
 * produce a dead link for any shop holding an infra label — so the fallback is the path that
 * always works, and the caller does not have to know the rule.
 * ⚠️ THE SUBDOMAIN IS THE HANDLE'S LABEL (`storefrontSubdomainLabel`, underscores removed), and this
 * is shape only: whether that host serves THIS shop is `storefrontCanonical` in storefront.ts. Use
 * that wherever the database is at hand; this is for client code and static pages.
 */
export function storefrontUrl(handle: string, appOrigin: string): string {
  const label = storefrontSubdomainLabel(handle)
  return label ? storefrontLabelUrl(label, appOrigin) : `${new URL(appOrigin).origin}/${handle.toLowerCase()}`
}

/** `https://<label>.<zone>` on this edition's zone — the one place a storefront host is spelled. */
export function storefrontLabelUrl(label: string, appOrigin: string): string {
  // ⚠️ THE STRIPPED BASE, NOT `url.host` — otherwise a services canonical of `www.eno.forum`
  // published `shop.www.eno.forum` as a shop's own address, which no certificate covers.
  return `${new URL(appOrigin).protocol}//${label}.${storefrontBaseHost(appOrigin)}`
}
