// ── Consent v2 — the stored value, and the ONE rule for reading it ───────────────────────────────
//
// PURE AND SERVER-SAFE: no `window`, no `document`, no React. The browser (src/lib/consent.ts), the
// server's Meta CAPI gate (src/lib/meta-capi.ts) and the signup attribution copy
// (src/app/api/profile/account-type/route.ts) all resolve consent through `resolveConsent()` below,
// so there is exactly one place where "what did this visitor agree to?" is decided. Three readers
// with three rules is how the v1 server gate came to read a different cookie from the browser.
//
// THREE PURPOSES, EACH ASKED FOR SEPARATELY, ALL OFF UNTIL SWITCHED ON:
//   p — personalization: the For You / Recently viewed rows, ranked from on-site searches and views
//   a — analytics: Google Analytics 4, and the first-touch attribution cookie (eno_attr)
//   d — advertising: Meta Conversions API (browser beacon and server) and Google ad signals
//
// ⛔ ONLY A v2 VALUE CAN GRANT ANYTHING. The v1 values ('all' | 'personalized' | 'essential', and the
// older 'accepted') were collected on a first screen that never named analytics or advertising, and
// for about seven weeks behind a pre-ticked ad toggle (fixed in d2dcc590). So:
//   · legacy 'essential' / 'accepted' → an ANSWER: a refusal. Nothing granted, never asked again.
//   · legacy 'all' / 'personalized' / anything else → NO ANSWER. Nothing runs, and the card asks once.
//
// ⛔ THE v2 VALUE LIVES UNDER NEW NAMES, AND THE OLD NAMES ONLY EVER HOLD 'essential' FROM NOW ON.
// Old code keeps running for a while after a deploy — tabs left open, and HTML the edge Worker serves
// stale-while-revalidate that still points at old chunks. Old code reads the old names only, and it
// reads 'essential' as "no tracking" (and would have read an unknown value like 'v2.000…' as
// personalization ALLOWED — consent.ts v1 compared `!== 'essential'`). Writing the literal refusal
// into the old slots on every v2 write means a stale tab can only ever under-track, never over-track.

export const CONSENT_V2_KEY = 'eno-consent-v2' // cookie (domain-scoped when possible) + localStorage
export const LEGACY_LOCAL_KEY = 'eno-cookie-consent' // v1 localStorage key AND v1 host-only cookie
export const LEGACY_SHARED_KEY = 'eno-consent' // v1 domain-scoped cookie

export const CONSENT_VERSION = 2
/**
 * The version of the WORDS the visitor saw. Bump it whenever the banner copy or the purposes change,
 * so a consent record says which notice the "yes" was given to. It is recorded, not enforced: a copy
 * change that needs everyone asked again is a CONSENT_VERSION bump, not this.
 * ⛔ A TEST HOLDS THIS TO THE WORDS: cookie-consent.test.tsx fingerprints every tr() string in the
 * card and fails when they change under an unchanged version. Bump this, then add the new fingerprint.
 *   2026-09-23 — consent v2 as first written.
 *   2026-09-24 — Advertising names Google only "if Analytics is on too"; Vietnamese "băm", not "mã hoá".
 */
export const CONSENT_COPY_VERSION = '2026-09-24'

/**
 * A choice is remembered for 12 months from the moment it was made, then asked again. The cookie's
 * max-age is the REMAINING lifetime and re-syncing never extends it — v1's sync rewrote a fresh
 * 1-year cookie on every visit, which made any consent effectively permanent.
 */
export const CONSENT_MAX_AGE_S = 365 * 24 * 60 * 60

/**
 * The native apps. The Capacitor shell appends `EnoNativeApp/1` (capacitor.config.ts
 * `appendUserAgent`); the SwiftUI app's embedded web tabs append `EnoNativeTabs/1`. Inside either,
 * analytics and advertising are forced OFF whatever is stored (Apple's App Tracking Transparency
 * covers web views, and the apps show no ATT prompt).
 */
export const NATIVE_UA_RE = /EnoNativeApp|EnoNativeTabs/

export type ConsentPurpose = 'p' | 'a' | 'd'
export type ConsentFlags = { p: boolean; a: boolean; d: boolean }
/** A v2 answer as stored: the flags, when it was given (unix seconds), and a random consent id. */
export type StoredConsent = ConsentFlags & { ts: number; cid: string }
/** What a reader gets back. A legacy refusal has no timestamp and no id. */
export type ConsentAnswer = ConsentFlags & { ts: number | null; cid: string | null; source: 'v2' | 'legacy' }

export const NO_PURPOSES: ConsentFlags = Object.freeze({ p: false, a: false, d: false })

/** `v2.<p><a><d>.<unix seconds>.<consent id>` — cookie-safe characters only, so nothing is encoded. */
const V2_RE = /^v2\.([01])([01])([01])\.(\d{1,12})\.([A-Za-z0-9_-]{8,64})$/
const CID_RE = /^[A-Za-z0-9_-]{8,64}$/

export function isConsentId(v: unknown): v is string {
  return typeof v === 'string' && CID_RE.test(v)
}

export function serializeConsent(s: StoredConsent): string {
  const bit = (b: boolean) => (b ? '1' : '0')
  return `v2.${bit(s.p)}${bit(s.a)}${bit(s.d)}.${Math.floor(s.ts)}.${s.cid}`
}

/** A well-formed v2 value, or null. Anything malformed is NOT a v2 value (and grants nothing). */
export function parseConsentV2(raw: string | null | undefined): StoredConsent | null {
  if (!raw) return null
  const m = V2_RE.exec(raw.trim())
  if (!m) return null
  const ts = Number(m[4])
  if (!Number.isSafeInteger(ts) || ts <= 0) return null
  return { p: m[1] === '1', a: m[2] === '1', d: m[3] === '1', ts, cid: m[5] }
}

export function isConsentExpired(s: StoredConsent, nowS: number): boolean {
  return nowS - s.ts > CONSENT_MAX_AGE_S
}

export type ConsentSources = {
  /** The `eno-consent-v2` cookie. */
  v2Cookie?: string | null
  /** The `eno-consent-v2` localStorage entry (the browser only). */
  v2Local?: string | null
  /** The v1 values, IN v1's OWN READ ORDER: shared cookie, localStorage, host-only cookie. */
  legacy?: ReadonlyArray<string | null | undefined>
}

/**
 * THE rule. Returns null for "not answered yet" (ask), otherwise the answer.
 *
 * ⛔ THE COOKIE WINS OVER localStorage (v1 learned this the hard way): localStorage is per-ORIGIN, so a
 * storefront's copy can be stale after a withdrawal made on eno.vn updated the shared cookie.
 * ⚠️ ANY v2 VALUE — EVEN AN EXPIRED OR MALFORMED ONE — SHUTS THE LEGACY FALLBACK. Every v2 write also
 * writes 'essential' into the legacy slots (see the header), so once a v2 value has existed the legacy
 * slots say nothing about the visitor; falling back to them would turn an expired "yes" into a
 * permanent, never-re-asked "no" instead of asking again.
 */
export function resolveConsent(src: ConsentSources, nowS: number): ConsentAnswer | null {
  const fromCookie = parseConsentV2(src.v2Cookie)
  const v2 = fromCookie ?? parseConsentV2(src.v2Local)
  if (v2) return isConsentExpired(v2, nowS) ? null : { ...v2, source: 'v2' }
  if (src.v2Cookie || src.v2Local) return null
  for (const raw of src.legacy ?? []) {
    if (!raw) continue
    if (raw === 'essential' || raw === 'accepted') return { ...NO_PURPOSES, ts: null, cid: null, source: 'legacy' }
    return null // 'all' | 'personalized' | junk: the visitor is asked again
  }
  return null
}

/** The two production sites, apex and www. */
const PRODUCTION_HOSTS = new Set(['eno.vn', 'www.eno.vn', 'eno.forum', 'www.eno.forum'])
/** A shop storefront: exactly one DNS label under eno.vn (`<handle>.eno.vn` — see storefront-host.ts). */
const STOREFRONT_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.eno\.vn$/

/**
 * Is this Host header one of the real production sites? (eno.vn, www.eno.vn, eno.forum,
 * www.eno.forum, or a `<shop>.eno.vn` storefront.)
 *
 * ⛔ THIS IS HOW /api/consent TELLS PRODUCTION FROM A LOCAL RUN THAT IS WIRED TO PRODUCTION. A local
 * `npm run preview:vn` is a production build (NODE_ENV=production) and its DATABASE_URL is the SSH
 * tunnel to the production database, so without this check one click on "Allow all" in a preview
 * wrote a permanent row into the production compliance log. A local run answers on localhost or an
 * IP; only the live sites answer on these names (nginx on the box forwards the visitor's Host, and
 * its default server refuses any other name).
 * ⚠️ EXACT NAMES, NOT A SUFFIX TEST: `eno.vn.evil.com` and `evil-eno.vn` are not eno hosts. The port
 * is ignored, and so is case.
 */
export function isProductionEnoHost(host: string | null | undefined): boolean {
  if (!host) return false
  let name: string
  try { name = new URL(`http://${host}`).hostname.toLowerCase() } catch { return false }
  return PRODUCTION_HOSTS.has(name) || STOREFRONT_HOST_RE.test(name)
}

/** One cookie's value from a Cookie header (the FIRST occurrence), or null. */
export function cookieFromHeader(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

/**
 * The server's view of a request's consent: the purposes it may act on, with the native-app override
 * applied. Fails CLOSED — no cookie, a legacy value, an expired or malformed value all grant nothing.
 * The server has no localStorage, so only cookies count; that is safe because only a v2 value can
 * grant, and the v2 value is always written to a cookie.
 */
export function serverConsent(headers: Headers, nowMs: number = Date.now()): ConsentFlags {
  const cookie = headers.get('cookie')
  const answer = resolveConsent(
    {
      v2Cookie: cookieFromHeader(cookie, CONSENT_V2_KEY),
      legacy: [cookieFromHeader(cookie, LEGACY_SHARED_KEY), cookieFromHeader(cookie, LEGACY_LOCAL_KEY)],
    },
    Math.floor(nowMs / 1000),
  )
  if (!answer) return { ...NO_PURPOSES }
  const native = NATIVE_UA_RE.test(headers.get('user-agent') || '')
  return { p: answer.p, a: answer.a && !native, d: answer.d && !native }
}

/**
 * Google Consent Mode v2 state for a set of purposes. Analytics storage follows `a`; the three ad
 * signals follow `d`. Used as the `update` after an all-denied `default`.
 */
export function consentModeState(f: Pick<ConsentFlags, 'a' | 'd'>): Record<string, 'granted' | 'denied'> {
  const ad = f.d ? 'granted' : 'denied'
  return {
    analytics_storage: f.a ? 'granted' : 'denied',
    ad_storage: ad,
    ad_user_data: ad,
    ad_personalization: ad,
  }
}
