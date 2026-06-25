// Cookie / storage consent — two tiers:
//   'essential' = functional storage only (caching the user's OWN data — inbox,
//                 prefs, recently-viewed — to localStorage for instant repeat loads).
//   'all'       = essential + PERSONALIZATION: on-site recommendations may use
//                 cross-session signals, and ad-network pixels (Meta/Google
//                 retargeting) may load.
// Before any choice, functional caching stays in-memory only (cleared on reload).
export const CONSENT_KEY = 'eno-cookie-consent'
export type ConsentLevel = 'all' | 'essential'

function read(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}

// Functional storage is allowed once ANY choice is made — and for the legacy
// 'accepted' value written by the previous single-button banner.
export function hasConsent(): boolean {
  const v = read()
  return v === 'all' || v === 'essential' || v === 'accepted'
}

// Personalization + ad-network signals — only with the 'all' choice.
export function hasPersonalizationConsent(): boolean {
  return read() === 'all'
}

export function getConsent(): ConsentLevel | null {
  const v = read()
  if (v === 'all') return 'all'
  if (v === 'essential' || v === 'accepted') return 'essential'
  return null
}

// Persist the choice + broadcast it so live components (analytics tags, the For You
// rail) react without a reload. Defaults to 'all' so the legacy no-arg call still
// grants everything.
export function setConsent(level: ConsentLevel = 'all'): void {
  try { localStorage.setItem(CONSENT_KEY, level) } catch { /* private mode — nothing to do */ }
  try { window.dispatchEvent(new CustomEvent('eno:consent', { detail: level })) } catch { /* noop */ }
}
