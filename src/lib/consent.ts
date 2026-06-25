// Cookie / storage consent — three tiers (fine-tunable in the consent dialog):
//   'essential'    = functional storage only (caching the user's OWN data — inbox,
//                    prefs, recently-viewed — for instant repeat loads).
//   'personalized' = essential + on-site personalization (the "For You" rail may use
//                    the user's stored on-site activity). NO ad-network pixels.
//   'all'          = personalized + ad-network signals (Meta/Google retargeting).
// Before any choice, functional caching stays in-memory only (cleared on reload).
export const CONSENT_KEY = 'eno-cookie-consent'
export type ConsentLevel = 'all' | 'personalized' | 'essential'

function read(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}

// Functional storage — allowed once ANY choice is made (incl. the legacy 'accepted').
export function hasConsent(): boolean {
  const v = read()
  return v === 'all' || v === 'personalized' || v === 'essential' || v === 'accepted'
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

// Persist the choice + broadcast it so live components (analytics tags, the For You
// rail) react without a reload. Defaults to 'all' so a legacy no-arg call still grants
// everything.
export function setConsent(level: ConsentLevel = 'all'): void {
  try { localStorage.setItem(CONSENT_KEY, level) } catch { /* private mode — nothing to do */ }
  try { window.dispatchEvent(new CustomEvent('eno:consent', { detail: level })) } catch { /* noop */ }
}
