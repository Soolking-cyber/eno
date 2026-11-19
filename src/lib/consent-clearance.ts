import { useSyncExternalStore, type CSSProperties } from 'react'

/**
 * How far the first-visit consent bar reaches up the screen (its height plus a breath), for the two floating things that must
 * stand above it: the language suggestion (lang-suggestion-banner.tsx) and the voice guide's window (concierge-host.tsx).
 * cookie-consent.tsx writes it; 0 = no bar.
 *
 * ⛔ NOT A VARIABLE ON <html> ANY MORE (home speed, 2026-11-19). The bar used to publish `--consent-clearance` on the root
 * element, and a custom property set there is inherited by every element: measured on the home page (phone, 4× CPU), the
 * bar's arrival forced ONE style recalculation of 3,584 elements — 236 ms, the third-longest task of the load — for the sake
 * of two. Each reader now sets the variable on its own element (`clearanceStyle`), so only they restyle.
 */
let clearance = 0
const listeners = new Set<() => void>()

export function setConsentClearance(px: number): void {
  const next = px > 0 ? px : 0
  if (next === clearance) return
  clearance = next
  for (const l of listeners) l()
}

/** The value now (tests read it here). */
export const consentClearance = (): number => clearance

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** The bar's clearance in px; 0 on the server and until a bar is up. */
export function useConsentClearance(): number {
  return useSyncExternalStore(subscribe, consentClearance, () => 0)
}

/** The reader's own style: `--consent-clearance` on the element whose classes read it, nothing when there is no bar. */
export const clearanceStyle = (px: number): CSSProperties | undefined =>
  px > 0 ? ({ '--consent-clearance': `${px}px` } as CSSProperties) : undefined
