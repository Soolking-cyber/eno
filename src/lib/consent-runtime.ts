// ── Consent v2 at runtime: cleanup by STATE, and Google Consent Mode ─────────────────────────────
//
// ⛔ CLEANUP RUNS ON EVERY LOAD, NOT ONLY WHEN THE CHOICE CHANGES — and the difference is exactly the
// visitors consent v2 was written for. A returning visitor holding a v1 'all' is read as NOT ANSWERED,
// so when they press "Decline all" nothing is being "withdrawn" from the code's point of view: an
// on-change cleanup would never fire, and their `_ga` cookies (2 years), `eno_attr` (180 days) and
// view history would outlive the refusal. So `enforceConsentCleanup()` looks at the CURRENT answer and
// removes whatever belongs to a purpose that is not granted right now — on mount (AnalyticsTags,
// every page) and again on every `eno:consent`.
import { ATTR_COOKIE, ATTR_SESSION_KEY } from './attribution'
import { GA_ID } from './analytics'
import { consentAnswered, hasAdConsent, hasAnalyticsConsent, personalizationAllowed } from './consent'
import { consentModeState } from './consent-value'
import { clearViewHistory } from './reco-signals'

declare global {
  interface Window {
    /** The current Consent Mode `update`, read by the GA and GTM bootstraps when they run. */
    __enoCm?: Record<string, 'granted' | 'denied'>
  }
}

// `_gac_*` holds Google Ads click ids that Google Analytics stores; it goes with Analytics (and is a
// Google ad identifier, so it is also removed without Advertising).
const isAnalyticsCookie = (n: string) => n === '_ga' || n.startsWith('_ga_') || n.startsWith('_gac_') || n === '_gid' || n.startsWith('_gat') || n === ATTR_COOKIE
const isAdCookie = (n: string) => n === '_fbp' || n === '_fbc' || n.startsWith('_gcl_') || n.startsWith('_gac_')

/**
 * The domains a cookie visible here may have been set on: this host and every parent with at least
 * two labels (`gmbr.eno.vn` → `gmbr.eno.vn`, `eno.vn`). GA writes `_ga` on the registrable domain
 * ("auto"), which a host-only delete does not reach — that was the named risk in the research.
 * Nothing on localhost or a bare IP: those take host-only cookies only.
 */
export function cookieDomainCandidates(hostname: string): string[] {
  if (!hostname.includes('.') || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return []
  const labels = hostname.split('.')
  const out: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

/**
 * Expire every cookie this page can see whose NAME matches, on `path=/`, host-only and on every
 * candidate domain (with and without the leading dot — some browsers stored the dotted form).
 * ⚠️ `path=/` IS REQUIRED: a delete without it defaults to the current directory and misses a
 * root-path cookie from any page below `/`.
 */
export function deleteCookies(match: (name: string) => boolean): string[] {
  if (typeof document === 'undefined') return []
  const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n && match(n))
  const domains = typeof location === 'undefined' ? [] : cookieDomainCandidates(location.hostname)
  for (const n of new Set(names)) {
    try {
      document.cookie = `${n}=; path=/; max-age=0`
      for (const d of domains) {
        document.cookie = `${n}=; path=/; max-age=0; domain=${d}`
        document.cookie = `${n}=; path=/; max-age=0; domain=.${d}`
      }
    } catch { /* cookies blocked — nothing to delete */ }
  }
  return names
}

/**
 * Queue a gtag command WITHOUT defining `window.gtag`.
 * ⚠️ gtag.js only understands the ARGUMENTS OBJECT; an array pushed to dataLayer is silently ignored,
 * which is why this is a classic function rather than a rest-parameter arrow.
 * ⚠️ And it must not define `window.gtag`: src/lib/analytics.ts reads that as "GA is loaded".
 */
function gtagCommand(..._args: unknown[]): void {
  const w = window as unknown as { dataLayer?: unknown[] }
  // eslint-disable-next-line prefer-rest-params -- gtag.js requires the Arguments object itself
  ;(w.dataLayer = w.dataLayer || []).push(arguments)
}

/**
 * Tell Google tags the current answer (Consent Mode v2, basic implementation: GA itself is only
 * LOADED with `a` — see analytics-tags.tsx). Stored on `window.__enoCm` for a bootstrap that has not
 * run yet, and pushed as an `update` to a dataLayer that already exists (GA's, or eno.forum's GTM).
 * Also flips GA's documented kill switch, so an already-loaded gtag.js stops sending on withdrawal.
 */
export function applyConsentMode(): Record<string, 'granted' | 'denied'> {
  const state = consentModeState({ a: hasAnalyticsConsent(), d: hasAdConsent() })
  if (typeof window === 'undefined') return state
  window.__enoCm = state
  try { (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = state.analytics_storage !== 'granted' } catch { /* noop */ }
  if ((window as unknown as { dataLayer?: unknown[] }).dataLayer) gtagCommand('consent', 'update', state)
  return state
}

/** Remove what belongs to every purpose that is not granted RIGHT NOW. Idempotent and cheap. */
export function enforceConsentCleanup(): void {
  if (typeof window === 'undefined') return
  if (!hasAnalyticsConsent()) {
    deleteCookies(isAnalyticsCookie)
    // The staged first-touch value is only kept while the visitor has not answered yet.
    if (consentAnswered()) { try { sessionStorage.removeItem(ATTR_SESSION_KEY) } catch { /* noop */ } }
  }
  if (!hasAdConsent()) deleteCookies(isAdCookie)
  if (!personalizationAllowed()) clearViewHistory()
}
