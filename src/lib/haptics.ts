/** Progressive-enhancement haptics. Android Chrome buzzes via the Vibration API; iOS
 *  Safari has NO Vibration API but fires a real system "tick" when a native
 *  <input type="checkbox" switch> toggles (Safari 17.4+, incl. standalone PWA) — so we
 *  keep one hidden switch and toggle it. All paths are SSR-safe and throttled so rapid
 *  taps never machine-gun. Silently no-ops where unsupported: older iOS, and iOS 26.5+,
 *  which restricts the switch tick to a DIRECT finger tap on the switch — a programmatic
 *  .click() no longer plays it.
 *
 *  That last gap is MOBILE-SAFARI-ONLY and is deliberately left open. Inside the Capacitor
 *  app — the platform that matters — every path below short-circuits to the real Taptic
 *  Engine via @capacitor/haptics, which has no such restriction. There used to be an
 *  `attachHaptic(host)` escape hatch that overlaid a real <input switch> on a control so the
 *  USER'S own tap produced the tick; it was deleted 2026-07-21 having never gained a single
 *  call site. An unused export that stretches a transparent input across a button's whole hit
 *  area is not free — it is a live tap-target hazard waiting for someone to "just try it".
 *  If iOS-Safari haptics on one specific control ever become worth it, bring it back WITH
 *  that call site, and re-read the tap-target warning in ui/icon-button before you do.
 *
 *  ⚠️ NOT gated on prefers-reduced-motion (decoupled 2026-07-21). Reduced MOTION is an
 *  ANIMATION preference; a user who turns off animation still expects a switch to click.
 *  Nothing here animates, so the guard only ever silenced touch feedback the user never
 *  asked to silence. There is deliberately NO app-level kill switch either, because the
 *  OS already enforces the user's real preference BELOW every path we use:
 *    · iOS/Android native (@capacitor/haptics) — UIFeedbackGenerator / VibrationEffect are
 *      silenced system-wide by Settings → Sounds & Haptics (iOS) and Sound & vibration →
 *      Vibration & haptics (Android). We never see the call refused; it just doesn't play.
 *    · Android Chrome (navigator.vibrate) — same system vibration setting applies.
 *    · iOS Safari (the hidden native <input switch>) — it IS a system control, so the
 *      system haptic setting governs it by construction.
 *  There is no `prefers-reduced-haptics` media query to consult, and an in-app toggle
 *  would duplicate an OS control that already works — so we defer to the OS.
 *
 *  User-gesture note: hapticConfirm/hapticError's non-native fallbacks schedule follow-up
 *  ticks on a timer. On iOS Safari (web, not the app) that loses the transient activation
 *  token and the extra ticks silently don't play — harmless degradation, and irrelevant in
 *  the Capacitor app where the real Taptic Engine plays the whole pattern.
 */

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(ad|hone|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS-as-Mac
}

// In the native Capacitor app we drive the REAL Taptic Engine via @capacitor/haptics — no switch
// trick, no Vibration API, respects the OS haptic setting. Everything below routes here first.
/** Android under Capacitor — the one platform whose "selection" haptic is heavier than its impact. */
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent || '')
}

function isNativeCap(): boolean {
  if (typeof window === 'undefined') return false
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!c?.isNativePlatform?.()
}
async function nativeImpact(style: 'Light' | 'Medium' | 'Heavy'): Promise<void> {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle[style] })
  } catch { /* ignore */ }
}
async function nativeNotify(type: 'Success' | 'Warning' | 'Error'): Promise<void> {
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType[type] })
  } catch { /* ignore */ }
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
  if (isNativeCap()) { void nativeImpact(ms >= 18 ? 'Medium' : 'Light'); return }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(ms) } catch { /* ignore */ }
    return
  }
  if (isIOS()) { try { getIosTrigger()?.click() } catch { /* ignore */ } }
}

/** One subtle system tap on a deliberate action. Progressive enhancement; throttled. */
export function hapticTap(ms = 12): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  if (now - lastFiredAt < REPEAT_GAP_MS) return
  lastFiredAt = now
  fire(ms)
}

/**
 * A SELECTION TICK — the texture iOS uses for a picker, a segmented control or a tab.
 *
 * ⛔ THIS IS NOT AN IMPACT, AND THAT DISTINCTION IS THE WHOLE POINT. `hapticTap` fires
 * `Haptics.impact`, which is the "something happened" thump meant for a committed action: a save, a
 * send, a publish. Moving between four sort tabs with an impact under each one feels like the phone
 * is being knocked, which is what makes an app read as cheap — the same over-firing hapticConfirm's
 * comment warns about, in a different disguise. UIKit has a separate lighter engine for "the
 * selection moved", and every native app the audience already uses is on it.
 *
 * ⚠️ USE IT FOR A CHANGE OF SELECTION, NOT FOR A COMMIT. A sort tab, a category chip, a facet, a
 * carousel slide: yes. Publishing a listing: that is `hapticConfirm`.
 *
 * ⛔ AND IT IS iOS-ONLY, BECAUSE ANDROID'S "SELECTION" IS THE HEAVIEST OF THE THREE, NOT THE
 * LIGHTEST. An earlier version of this comment claimed the plugin "maps it to its own light effect"
 * on Android. Measured in the installed plugin instead of assumed:
 *     HapticsSelectionType   timings {0,100}  amplitudes {0,100}   → 100ms
 *     HapticsImpactType.LIGHT timings {0,50}  amplitudes {0,110}   → 50ms
 * So routing Android through selectionChanged would have doubled the buzz relative to impact LIGHT
 * and made it roughly eight times the 12ms `hapticTap` this replaces — turning "make it feel good"
 * into a heavier thump under every tab, which is the exact opposite of the request. Android takes
 * the light impact path instead. iOS keeps UISelectionFeedbackGenerator, which really is a distinct
 * lighter engine and is what every native picker on the platform uses.
 * ⚠️ The web path falls back to a vibration SHORTER than hapticTap's — a selection must feel lighter
 * than a commit on every platform, not just the one with the API for it.
 *
 * ⛔ `selectionChanged()` ALONE IS A SILENT NO-OP ON BOTH PLATFORMS — THE FIRST VERSION OF THIS
 * FUNCTION SHIPPED NOTHING. Three reviewers said so and the installed plugin source settles it:
 *   ios/Sources/HapticsPlugin/Haptics.swift — `selectionChanged()` is
 *     `if let generator = self.selectionFeedbackGenerator { … }`, and that property is nil until
 *     `selectionStart()` assigns a `UISelectionFeedbackGenerator`.
 *   android/…/Haptics.java — `selectionChanged()` is `if (this.selectionStarted)`, a flag only
 *     `selectionStart()` sets.
 * So the sequence is start → changed → end, every time. This replaced `hapticTap` on the segmented
 * control and the seller sort strip, both of which HAD working feedback: the regression would have
 * been a control that silently stopped buzzing on device while every gate stayed green.
 *
 * ⚠️ THE PLUGIN IS IMPORTED ONCE, NOT PER TICK. `await import()` inside the handler put a dynamic
 * import between the finger and the buzz on every tap; a haptic that arrives late is worse than
 * none, because it lands under the NEXT thing the thumb does.
 *
 * ⛔ OVERLAPPING SEQUENCES ARE DROPPED, NOT QUEUED, AND THE DIFFERENCE MATTERS BOTH WAYS. The
 * native generator is a singleton — `selectionFeedbackGenerator` on iOS, a `selectionStarted` flag
 * on Android — so two sequences interleaving as start/start/changed/end/changed leave the second
 * tick landing after the first tore the generator down: silently nothing. Chaining them on one
 * promise fixes the ordering and creates a worse problem: three awaited bridge calls per tick on a
 * slow bridge means a backlog that keeps buzzing after the thumb has stopped, and a haptic that
 * arrives late lands under whatever the user is doing NEXT. A tick is worthless out of time, so a
 * tick that cannot go now is simply dropped.
 *
 * ⚠️ A FAILED IMPORT IS NOT CACHED. `hapticsModule ??= import(...)` alone kept a REJECTED promise
 * for the life of the page, so one fetch failure — offline for a moment, or a deploy rotating chunk
 * hashes — silenced the control until a hard reload. The per-call import it replaced retried by
 * accident; this retries on purpose.
 */
let hapticsModule: Promise<typeof import('@capacitor/haptics')> | null = null
function loadHaptics() {
  hapticsModule ??= import('@capacitor/haptics').catch((e) => { hapticsModule = null; throw e })
  return hapticsModule
}
let selectionBusy = false

export function hapticSelection(): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  if (now - lastFiredAt < REPEAT_GAP_MS) return
  lastFiredAt = now
  /*
   * ⚠️ ANDROID IS DELIBERATELY NOT ON THE SELECTION API — see the measurement above. `fire(8)` puts
   * it on impact LIGHT, which is the lightest thing the platform actually offers.
   */
  if (isNativeCap() && !isAndroid()) {
    if (selectionBusy) return
    selectionBusy = true
    void (async () => {
      try {
        const { Haptics } = await loadHaptics()
        await Haptics.selectionStart()
        /*
         * ⛔ ONCE STARTED, IT IS ALWAYS ENDED. A rejecting `selectionChanged()` used to skip
         * `selectionEnd()`, leaving iOS holding a live UISelectionFeedbackGenerator and Android a
         * `selectionStarted` flag that nothing would ever clear — native state dangling behind a
         * swallowed error. The inner finally is what makes the pair unconditional.
         */
        try {
          await Haptics.selectionChanged()
        } finally {
          await Haptics.selectionEnd()
        }
      } catch {
        /* plugin absent on an older binary — silence is the right degradation */
      } finally {
        selectionBusy = false
      }
    })()
    return
  }
  if (isNativeCap()) { fire(8); return }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(7) } catch { /* ignore */ }
    return
  }
  if (isIOS()) { try { getIosTrigger()?.click() } catch { /* ignore */ } }
}

/** Legacy alias — a single subtle tap (favorite, send, publish). Kept for existing callers. */
export function haptic(ms = 12): void {
  hapticTap(ms)
}

/** A "success" texture — a double tick. ONLY for a real completion the user was waiting
 *  on: a listing published, an offer sent or accepted, a review posted. Never on an
 *  ordinary tap or a navigation — over-firing is exactly what makes an app feel cheap.
 *  Deliberately NOT throttled (a success must never be swallowed by a preceding tap), but
 *  it stamps the shared clock so a stray tap right after it can't overlap. */
export function hapticConfirm(): void {
  if (typeof window === 'undefined') return
  lastFiredAt = Date.now()
  if (isNativeCap()) { void nativeNotify('Success'); return } // real Taptic success pattern
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate([10, 50, 10]) } catch { /* ignore */ }; return }
  fire(10); setTimeout(() => fire(10), 90) // iOS: two spaced ticks
}

/** An "error" texture — a triple tick. ONLY for a submission the app REJECTED: a failed
 *  publish, a failed send, a validation the user has to go back and fix. A sign-in prompt
 *  or any other normal gate is NOT an error — buzzing there reads as punishment. Same
 *  no-throttle / stamp-the-clock rule as hapticConfirm. */
export function hapticError(): void {
  if (typeof window === 'undefined') return
  lastFiredAt = Date.now()
  if (isNativeCap()) { void nativeNotify('Error'); return } // real Taptic error pattern
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate([12, 40, 12, 40, 12]) } catch { /* ignore */ }; return }
  fire(12); setTimeout(() => fire(12), 70); setTimeout(() => fire(12), 140)
}
