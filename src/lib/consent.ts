// Cookie / storage consent. Essential cookies (the auth session) always work;
// this gates the OPTIONAL persistence we do for speed — caching the user's own
// data (e.g. their inbox) to localStorage so repeat visits paint instantly.
// Before consent, that caching is in-memory only (cleared on reload).
export const CONSENT_KEY = 'eno-cookie-consent'

export function hasConsent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(CONSENT_KEY) === 'accepted'
  } catch {
    return false
  }
}

export function setConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'accepted')
  } catch {
    /* private mode / storage blocked — nothing to do */
  }
}
