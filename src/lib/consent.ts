// Cookie / storage consent — v2: three independent purposes, all OFF until the visitor switches
// them on (src/lib/consent-value.ts has the format and the reading rule, shared with the server):
//   p — personalization: the "For You" and "Recently viewed" rows, ranked on our own servers from
//       the visitor's on-site searches and views. The view/category history is not even SAVED
//       without it (src/lib/reco-signals.ts).
//   a — analytics: Google Analytics 4 and the first-touch attribution cookie `eno_attr`.
//   d — advertising: Meta Conversions API (browser beacon + server) and Google ad signals.
// Nothing non-essential runs before an answer, and "no answer" is never read as a yes (PDPL
// 91/2025 Art 9(4)(d): silence is not consent; Decree 356/2025 Art 6(3): no default consent).
//
// ⚠️ INSIDE THE NATIVE APPS `a` AND `d` ARE ALWAYS OFF, whatever is stored (Apple's App Tracking
// Transparency applies to web views and the apps show no ATT prompt). The override is applied at
// READ time here and on the server (consent-value.ts `serverConsent`), so a stored value can never
// switch them on inside the app.
import {
  CONSENT_MAX_AGE_S,
  CONSENT_V2_KEY,
  CONSENT_COPY_VERSION,
  CONSENT_VERSION,
  LEGACY_LOCAL_KEY,
  LEGACY_SHARED_KEY,
  NATIVE_UA_RE,
  isConsentExpired,
  parseConsentV2,
  resolveConsent,
  serializeConsent,
  type ConsentAnswer,
  type ConsentFlags,
  type ConsentPurpose,
  type StoredConsent,
} from './consent-value'

export type { ConsentAnswer, ConsentFlags, ConsentPurpose } from './consent-value'

/**
 * ⛔ THE COOKIE IS THE CROSS-HOST TRUTH; localStorage IS ONLY A FALLBACK. Owner, 2026-08-30:
 * *"cookies souldnt be asked if there is cookie approved through eno.vn and viceversa"*. A shop's
 * storefront is `<handle>.eno.vn` — a different ORIGIN, with its own localStorage — so the v2 cookie is
 * scoped to the registrable domain and every host of an edition reads the same answer, including a
 * WITHDRAWAL made on another host. (eno.vn and eno.forum are different sites: an answer on one is not
 * an answer on the other, and cannot be.)
 *
 * ⚠️ SHARING THIS COOKIE IS SAFE IN A WAY SHARING THE SESSION IS NOT. A consent answer is a PREFERENCE —
 * the worst a hostile subdomain could do with it is claim you consented, which the dialog lets anyone
 * do in one click. The session cookie is a CREDENTIAL (see storefront.ts).
 */
function cookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

function localGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null } // private mode / blocked storage
}

function localSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private mode — the cookie alone is enough */ }
}

const nowS = () => Math.floor(Date.now() / 1000)

/**
 * True inside the Capacitor shell or the SwiftUI app's web tabs. Mirrors the two detections the repo
 * already uses (src/lib/native-auth.ts `isNativeApp`, src/context/auth-context.tsx's UA test).
 */
export function isNativeContext(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (c?.isNativePlatform?.()) return true
  } catch { /* a broken bridge is not a native signal */ }
  return typeof navigator !== 'undefined' && NATIVE_UA_RE.test(navigator.userAgent || '')
}

/** The stored answer on this device, or null when the visitor has not answered (or it expired). */
export function readConsent(): ConsentAnswer | null {
  if (typeof window === 'undefined') return null
  return resolveConsent(
    {
      v2Cookie: cookieValue(CONSENT_V2_KEY),
      v2Local: localGet(CONSENT_V2_KEY),
      // v1's own read order: shared cookie, localStorage, host-only cookie.
      legacy: [cookieValue(LEGACY_SHARED_KEY), localGet(LEGACY_LOCAL_KEY), cookieValue(LEGACY_LOCAL_KEY)],
    },
    nowS(),
  )
}

/** Has the visitor answered (including a legacy refusal)? Drives whether the card auto-opens. */
export function consentAnswered(): boolean {
  return readConsent() !== null
}

/** May this purpose run on this device right now? Native forces analytics and advertising off. */
export function hasPurpose(purpose: ConsentPurpose): boolean {
  const c = readConsent()
  if (!c || !c[purpose]) return false
  if (purpose !== 'p' && isNativeContext()) return false
  return true
}

export const personalizationAllowed = (): boolean => hasPurpose('p')
export const hasAnalyticsConsent = (): boolean => hasPurpose('a')
export const hasAdConsent = (): boolean => hasPurpose('d')

/**
 * The registrable domain to scope the v2 cookie to, or null to leave it host-only.
 *
 * ⚠️ NULL ON localhost, AN IP, OR ANY HOST OUTSIDE THE CONFIGURED DOMAIN. A browser silently DROPS a
 * cookie whose domain attribute does not cover the current host — so a production build previewed on
 * localhost (NEXT_PUBLIC_APP_URL=https://eno.vn) would otherwise persist nothing at all.
 * ⚠️ ONE COOKIE, NEVER TWO WITH THE SAME NAME: v1 wrote a host-only and a domain cookie under one name
 * and could not tell them apart (`document.cookie` order is unspecified). Per host this is always
 * either domain-scoped or host-only, never both.
 */
function consentCookieDomain(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw || typeof location === 'undefined') return null
  try {
    const domain = new URL(raw).hostname.replace(/^www\./, '')
    if (!domain.includes('.') || /^[\d.]+$/.test(domain)) return null // localhost, bare host, IPv4
    const host = location.hostname
    return host === domain || host.endsWith(`.${domain}`) ? domain : null
  } catch { return null }
}

function writeCookie(name: string, value: string, maxAge: number, domain: string | null): void {
  try {
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${domain ? `; domain=${domain}` : ''}`
  } catch { /* noop */ }
}

/**
 * Persist a v2 answer everywhere it is read from, WITHOUT extending its life (max-age is what is left
 * of the 12 months since `ts`), and stamp the legacy slots with the literal refusal — see the header of
 * consent-value.ts for why every v2 write does that, grants included.
 */
function persist(stored: StoredConsent): void {
  const value = serializeConsent(stored)
  const maxAge = Math.max(0, stored.ts + CONSENT_MAX_AGE_S - nowS())
  const domain = consentCookieDomain()
  writeCookie(CONSENT_V2_KEY, value, maxAge, domain)
  localSet(CONSENT_V2_KEY, value)
  writeCookie(LEGACY_LOCAL_KEY, 'essential', maxAge, null)
  if (domain) writeCookie(LEGACY_SHARED_KEY, 'essential', maxAge, domain)
  localSet(LEGACY_LOCAL_KEY, 'essential')
}

/**
 * On every load: make the stores agree. The cookie wins; a valid localStorage copy restores a cookie
 * that was cleared or never accepted. An expired answer is left alone — it reads as "not answered",
 * and the card asks again.
 */
export function syncConsentStorage(): void {
  if (typeof window === 'undefined') return
  const src = parseConsentV2(cookieValue(CONSENT_V2_KEY)) ?? parseConsentV2(localGet(CONSENT_V2_KEY))
  if (!src || isConsentExpired(src, nowS())) return
  persist(src)
}

function newConsentId(): string {
  try { return crypto.randomUUID() } catch { /* very old browser */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** The id this device's earlier answers were recorded under — kept across changes, even after expiry. */
function existingConsentId(): string | null {
  return (parseConsentV2(cookieValue(CONSENT_V2_KEY)) ?? parseConsentV2(localGet(CONSENT_V2_KEY)))?.cid ?? null
}

/** Where the choice was made — recorded with it. */
export type ConsentSurface = 'banner' | 'settings'
/** Which control set it — recorded with it ("Allow all" and a hand-set "Save" are different acts). */
export type ConsentAction = 'allow_all' | 'decline_all' | 'save'

/**
 * Record the choice on the server (POST /api/consent → the append-only compliance_audit log) — the
 * evidence Decree 356/2025 Art 6(2) makes the controller hold. Fire-and-forget: a lost record never
 * blocks the choice itself, and sendBeacon survives the page being closed right after the click.
 */
function recordConsent(stored: StoredConsent, meta: { surface: ConsentSurface; action: ConsentAction; locale: string }): void {
  try {
    const payload = JSON.stringify({
      cid: stored.cid,
      p: stored.p,
      a: stored.a,
      d: stored.d,
      v: CONSENT_VERSION,
      copy: CONSENT_COPY_VERSION,
      surface: meta.surface,
      action: meta.action,
      locale: meta.locale,
      ts: stored.ts,
    })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/consent', new Blob([payload], { type: 'application/json' }))
      return
    }
    // ⚠️ SILENCE IS DELIBERATE: a client-side analytics/consent beacon has no server log to reach, and
    // a failed record must never surface as an error on a consent click (same reasoning as the
    // view beacon in src/lib/analytics.ts).
    // eslint-disable-next-line no-restricted-syntax
    fetch('/api/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
  } catch { /* the choice is already stored; the record is best-effort */ }
}

/**
 * THE one write path. Persists the answer, tells live components (`eno:consent`), and records it.
 * Returns what was stored.
 */
export function setConsent(
  flags: ConsentFlags,
  meta: { surface: ConsentSurface; action: ConsentAction; locale: string },
): StoredConsent {
  const stored: StoredConsent = { p: !!flags.p, a: !!flags.a, d: !!flags.d, ts: nowS(), cid: existingConsentId() ?? newConsentId() }
  persist(stored)
  try { window.dispatchEvent(new CustomEvent('eno:consent', { detail: { p: stored.p, a: stored.a, d: stored.d } })) } catch { /* noop */ }
  recordConsent(stored, meta)
  return stored
}
