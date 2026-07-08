/** Progressive-enhancement haptics. Android Chrome buzzes via the Vibration API; iOS
 *  Safari has NO Vibration API but fires a real system "tick" when a native
 *  <input type="checkbox" switch> toggles (Safari 17.4+, incl. standalone PWA) — so we
 *  keep one hidden switch and toggle it. All paths are reduced-motion-guarded, SSR-safe,
 *  and throttled so rapid taps never machine-gun. Silently no-ops where unsupported
 *  (older iOS, iOS 26.5+ which restricts the switch tick to a direct finger tap — for the
 *  few highest-value controls that must survive that, use attachHaptic()).
 */

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(ad|hone|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS-as-Mac
}

// iOS hidden native switch — rendered but invisible (display:none would suppress the tick).
let iosLabel: HTMLLabelElement | null = null
function getIosTrigger(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null
  if (iosLabel) return iosLabel
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '') // WebKit native switch (Safari 17.4+)
  input.id = 'eno-haptic-switch'
  input.setAttribute('aria-hidden', 'true')
  input.tabIndex = -1
  const label = document.createElement('label')
  label.setAttribute('for', 'eno-haptic-switch')
  label.setAttribute('aria-hidden', 'true')
  const hidden = { position: 'fixed', bottom: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', margin: '0' } as const
  Object.assign(input.style, hidden)
  Object.assign(label.style, hidden)
  document.body.append(input, label)
  iosLabel = label
  return label
}

const REPEAT_GAP_MS = 40
let lastFiredAt = 0
function fire(ms: number) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(ms) } catch { /* ignore */ }
    return
  }
  if (isIOS()) { try { getIosTrigger()?.click() } catch { /* ignore */ } }
}

/** One subtle system tap on a deliberate action. Progressive enhancement; throttled. */
export function hapticTap(ms = 12): void {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  const now = Date.now()
  if (now - lastFiredAt < REPEAT_GAP_MS) return
  lastFiredAt = now
  fire(ms)
}

/** Legacy alias — a single subtle tap (favorite, send, publish). Kept for existing callers. */
export function haptic(ms = 12): void {
  hapticTap(ms)
}

/** A "success" texture — a double tick (a listing published, a review posted). */
export function hapticConfirm(): void {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate([10, 50, 10]) } catch { /* ignore */ }; return }
  fire(10); setTimeout(() => fire(10), 90) // iOS: two spaced ticks
}

/** An "error" texture — a triple tick (blocked action). Use sparingly. */
export function hapticError(): void {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate([12, 40, 12, 40, 12]) } catch { /* ignore */ }; return }
  fire(12); setTimeout(() => fire(12), 70); setTimeout(() => fire(12), 140)
}

/** Overlay a real native switch on a control so the USER'S OWN tap ticks — the only path
 *  that survives iOS 26.5+. Use sparingly (send / publish / favorite). React ref callback:
 *  `<button ref={attachHaptic}>`. Match `radius` to the host so the hit area is round. */
export function attachHaptic(host: HTMLElement | null, radius = '999px'): void {
  if (!host || typeof document === 'undefined' || !isIOS() || prefersReducedMotion()) return
  if (host.querySelector('input[data-haptic]')) return
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  const el = document.createElement('input')
  el.type = 'checkbox'
  el.setAttribute('switch', '')
  el.dataset.haptic = ''
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  Object.assign(el.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', margin: '0',
    opacity: '0', cursor: 'pointer', clipPath: `inset(0 round ${radius})`, touchAction: 'manipulation',
  })
  el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
  host.appendChild(el) // taps toggle it (tick) AND bubble to the host's onClick
}
