/** A tiny haptic tap on key confirmations (favorite, send, publish). Progressive
 *  enhancement only — Android Chrome buzzes; iOS Safari ignores Vibration silently.
 *  Guarded on support + the user's reduced-motion preference. */
export function haptic(ms = 12): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return
  if (!('vibrate' in navigator)) return
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate(ms)
  } catch { /* ignore */ }
}
