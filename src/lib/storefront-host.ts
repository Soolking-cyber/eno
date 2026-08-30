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
 * The shop handle a Host header addresses, or null for the ordinary site.
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
  if (isInfraSubdomain(label)) return null
  // The handle namespace's own shape and reservations. A reserved handle cannot be claimed, so it
  // cannot be a shop — but checking it here means an entry added to that list stops resolving as a
  // host immediately, without a second edit.
  if (!HANDLE_RE.test(label)) return null
  if (isReservedHandle(label)) return null
  if (!isHostnameLabel(label)) return null
  return label
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
 * ⚠️ THE ANSWER IS TO WITHHOLD THE SUBDOMAIN, NOT TO REWRITE THE HANDLE. Mapping `_`→`-` would
 * make `a_b` and `a-b` the same host while the handle namespace treats them as different names,
 * which is a collision between two shops rather than a formatting fix. A handle that cannot be a
 * host keeps `eno.vn/<handle>`, which is what `storefrontUrl` already falls back to.
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
 * only some have `<handle>.eno.vn`. A caller that linked to the subdomain unconditionally would
 * produce a dead link for any shop holding an infra label — so the fallback is the path that
 * always works, and the caller does not have to know the rule.
 */
export function storefrontUrl(handle: string, appOrigin: string): string {
  const url = new URL(appOrigin)
  const label = handle.toLowerCase()
  if (isInfraSubdomain(label) || !HANDLE_RE.test(label) || isReservedHandle(label) || !isHostnameLabel(label)) {
    return `${url.origin}/${label}`
  }
  // ⚠️ THE STRIPPED BASE, NOT `url.host` — otherwise a services canonical of `www.eno.forum`
  // published `shop.www.eno.forum` as a shop's own address, which no certificate covers.
  return `${url.protocol}//${label}.${storefrontBaseHost(appOrigin)}`
}
