// Cookie / storage consent — three tiers (fine-tunable in the consent dialog):
//   'essential'    = functional storage only (caching the user's OWN data — inbox,
//                    prefs, recently-viewed — for instant repeat loads).
//   'personalized' = essential + on-site personalization (the "For You" rail may use
//                    the user's stored on-site activity). NO ad-network pixels.
//   'all'          = personalized + ad-network signals (Meta/Google retargeting).
// Before any choice, functional caching stays in-memory only (cleared on reload).
export const CONSENT_KEY = 'eno-cookie-consent'
export type ConsentLevel = 'all' | 'personalized' | 'essential'

/**
 * ⛔ THE COOKIE IS THE CROSS-HOST TRUTH; localStorage IS ONLY A FAST PATH. Owner, 2026-08-30:
 * *"cookies souldnt be asked if there is cookie approved through eno.vn and viceversa"*. A shop's
 * storefront is `<handle>.eno.vn` — a different ORIGIN — so its localStorage is a different store
 * and a visitor who had already consented on eno.vn was asked again on every shop, and again on
 * the way back. Reading the cookie when localStorage is empty is what makes one answer count
 * everywhere, in both directions.
 *
 * ⚠️ SHARING THIS COOKIE IS SAFE IN A WAY SHARING THE SESSION IS NOT, and the distinction is worth
 * stating because the two decisions look alike. A consent level is a PREFERENCE — the worst a
 * hostile subdomain could do with it is claim you already consented, which the dialog itself lets
 * anyone do in one click. The session cookie is a CREDENTIAL and is deliberately not httpOnly
 * (ed222c6d), so widening THAT would hand every shop's page a visitor's token. See storefront.ts.
 */
/**
 * ⛔ THE SHARED COOKIE HAS ITS OWN NAME, AND THAT IS THE FIX FOR A PROBLEM THREE ROUNDS OF REVIEW
 * COULD NOT CLOSE ANY OTHER WAY. Reusing `CONSENT_KEY` for the domain-scoped cookie meant two
 * cookies with the SAME NAME — the legacy host-only one and the new shared one. Cookies are keyed
 * by (name, domain, path), `document.cookie` returns both, and the order is not specified. Deleting
 * the old one was tried and does not work either: a delete only reaches the host doing the writing,
 * so a storefront can clear its own host-only copy but never the one sitting on eno.vn — leaving a
 * stale pre-migration value able to outrank a newer choice, including a WITHDRAWAL, which is the
 * direction that actually matters. A distinct name makes the two distinguishable, so the shared one
 * is read unambiguously and the legacy one stays a harmless fallback until it expires.
 *
 * ⚠️ MIGRATION IS LAZY, AND ONE VISIT IS NOT ENOUGH FOR EVERYONE. The shared cookie can only be
 * written by a host that can already SEE the old answer, so a visitor who consented on eno.vn
 * before this shipped and whose next stop is a storefront IS asked once more there. Their next
 * visit to either host writes the shared cookie and it never happens again. That one prompt is the
 * price of not having a server-side migration, and it is the safe direction to fail.
 */
const SHARED_KEY = 'eno-consent'

function cookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

/** The cross-host answer, or null when this browser has not been migrated yet. */
function readCookie(): string | null {
  return cookieValue(SHARED_KEY)
}

/**
 * ⛔ THE COOKIE WINS, AND THE FIRST VERSION HAD IT THE OTHER WAY ROUND — A CONSENT-WITHDRAWAL BUG.
 * Preferring localStorage looks like a harmless fast path and is not: localStorage is PER-ORIGIN,
 * so once `gmbr.eno.vn` had cached `all`, a visitor who later downgraded to `essential` on eno.vn
 * updated the shared cookie and that storefront went on reading its own stale `all` forever. Three
 * reviewers landed on it independently, and it is the direction that matters — an ignored GRANT is
 * an unnecessary dialog, an ignored WITHDRAWAL is processing personal data after someone said stop.
 * ⚠️ localStorage IS NOW ONLY A FALLBACK, for the two cases the cookie cannot cover: a browser that
 * rejects the domain attribute, and a user who consented before this shipped and has a host-only
 * entry with no cookie yet.
 */
function read(): string | null {
  if (typeof window === 'undefined') return null
  const shared = readCookie()
  if (shared) return shared
  try {
    const local = localStorage.getItem(CONSENT_KEY)
    if (local) return local
  } catch { /* private mode — try the legacy cookie */ }
  // ⚠️ LAST RESORT: the pre-migration per-host cookie. It covers a returning consenter whose
  // localStorage was cleared but whose cookies survived — without it they would be asked again on
  // the very host where they had already answered.
  return cookieValue(CONSENT_KEY)
}

/**
 * The registrable domain to scope the consent cookie to, or null when there is none to scope to.
 *
 * ⚠️ NULL ON localhost AND ON AN IP, because `domain=` must be a real registrable domain: a browser
 * silently DROPS a cookie whose domain attribute it does not accept, so setting it there would not
 * be a no-op — it would stop consent persisting at all in local development.
 * ⚠️ THE PORT IS STRIPPED because a domain attribute may not carry one.
 */
function consentCookieDomain(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '')
    if (!host.includes('.') || /^[\d.]+$/.test(host)) return null // localhost, bare host, IPv4
    return host
  } catch { return null }
}


// On-site personalization (the "For You" rail using the user's OWN stored activity —
// their eno.vn searches/views, first-party, ranked on our own server) is ON by default:
// it's functional and never leaves us. Only an EXPLICIT "Essential only / Decline" opts
// out. (Legacy 'accepted' and an undecided null both keep it on — so a returning user
// with local searches gets "For You" without re-consenting.) This is independent of the
// ad-network tier — works even if Meta/Google aren't available.
export function personalizationAllowed(): boolean {
  return read() !== 'essential'
}

// Ad-network signals (Meta/Google retargeting pixels) — only 'all'.
export function hasAdConsent(): boolean {
  return read() === 'all'
}

export function getConsent(): ConsentLevel | null {
  const v = read()
  if (v === 'all') return 'all'
  if (v === 'personalized') return 'personalized'
  if (v === 'essential' || v === 'accepted') return 'essential'
  return null
}

// Mirror the choice into a cookie so the SERVER can see it: server-side Meta CAPI
// events are personal-data processing under the PDP Law 91/2025 and require the
// same opt-in as the browser pixel (compliance audit 2026-07-06). localStorage is
// invisible to API routes; this cookie is the bridge. Fail-closed on the server:
// no cookie → no ad events.
function writeConsentCookie(level: string): void {
  try {
    // ⚠️ `domain=` IS WHAT CARRIES THE ANSWER TO THE STOREFRONTS. A leading dot is not needed —
    // RFC 6265 treats `domain=eno.vn` as covering its subdomains — and omitting the attribute
    // entirely (the local-development case) leaves the cookie host-only, exactly as before.
    const domain = consentCookieDomain()
    /**
     * ⚠️ BOTH COOKIES ARE WRITTEN, UNDER DIFFERENT NAMES. See SHARED_KEY for why the shared one
     * cannot reuse this name. The per-host mirror stays because the SERVER reads it.
     */
    // The legacy per-host mirror keeps being written so a rollback of this change still finds a
    // value, and so server code reading CONSENT_KEY (Meta CAPI, PDP Law 91/2025) is unaffected.
    document.cookie = `${CONSENT_KEY}=${level}; path=/; max-age=31536000; SameSite=Lax`
    // The shared one, under its own name, is what every host of this edition reads.
    if (domain) {
      document.cookie = `${SHARED_KEY}=${level}; path=/; max-age=31536000; SameSite=Lax; domain=${domain}`
    }
  } catch { /* noop */ }
}

// One-time migration for users who consented before the cookie mirror existed.
export function syncConsentCookie(): void {
  const v = read()
  /**
   * ⛔ IT REWRITES UNCONDITIONALLY NOW, AND THE OLD `!document.cookie.includes(...)` GUARD WAS
   * EXACTLY WHAT BLOCKED THE MIGRATION. That guard existed to avoid redundant writes when the
   * mirror already existed — but every pre-existing consenter HAS a mirror, the host-only one, so
   * the guard saw it and never wrote the domain-scoped replacement. The result would have been
   * that the one population this feature was written for — people who already accepted on eno.vn —
   * kept being asked again on every storefront. Rewriting is cheap and idempotent: the write path
   * refreshes the per-host mirror and sets the shared cookie under its own name.
   */
  if (v && typeof document !== 'undefined') writeConsentCookie(v)
  /**
   * ⚠️ AND THE LOCAL COPY IS OVERWRITTEN, NOT FILLED-IN-IF-EMPTY. Writing it only when absent is
   * what made the stale value above permanent. The cookie is the truth, so the mirror follows it
   * unconditionally — including downward, when someone has withdrawn consent on another host.
   */
  try {
    const fromCookie = readCookie()
    if (typeof window !== 'undefined' && fromCookie && localStorage.getItem(CONSENT_KEY) !== fromCookie) {
      localStorage.setItem(CONSENT_KEY, fromCookie)
    }
  } catch { /* private mode — the cookie alone is enough */ }
}

// Persist the choice + broadcast it so live components (analytics tags, the For You
// rail) react without a reload. Defaults to 'all' so a legacy no-arg call still grants
// everything.
export function setConsent(level: ConsentLevel = 'all'): void {
  try { localStorage.setItem(CONSENT_KEY, level) } catch { /* private mode — nothing to do */ }
  writeConsentCookie(level)
  try { window.dispatchEvent(new CustomEvent('eno:consent', { detail: level })) } catch { /* noop */ }
}
