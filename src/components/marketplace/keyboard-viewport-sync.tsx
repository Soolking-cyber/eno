'use client'

import { useEffect } from 'react'
import { ensureKeyboardWired } from '@/hooks/use-virtual-keyboard'
import { isIOS } from '@/lib/in-app-browser'

/**
 * Mounted once at the app root. Two jobs, both zero-render:
 * 1. Wires the shared VisualViewport listener so the --vvh/--vvt CSS vars + the `kb-open`
 *    <html> class are maintained on EVERY page (the chat shell needs them even where the
 *    bottom-nav isn't rendered).
 * 2. Measures the pre-launch banner into `--banner-h` on <html> so fixed-height surfaces
 *    (the messenger) can fit BELOW it instead of overflowing — and it's 0 when the banner
 *    is gone, so the app is full-height and launch-ready the moment PRELAUNCH flips off.
 */
export function KeyboardViewportSync() {
  useEffect(() => {
    ensureKeyboardWired()

    // iOS ONLY: clamp the viewport scale so focusing a field never auto-zooms the page
    // (iOS zooms any input rendered under 16px). In mobile SAFARI this is benign — Safari
    // deliberately IGNORES maximum-scale for user pinch gestures (accessibility zoom keeps
    // working), so it only suppresses the focus auto-zoom. Not applied on Android, where
    // maximum-scale would genuinely disable pinch zoom.
    // ⚠️ PAIRED WITH src/lib/native-text-zoom.ts — do not break the pairing. A WKWebView has
    // no Safari-style override, so inside the Capacitor app this lock DOES kill pinch zoom.
    // The compensating mechanism is native-text-zoom, which reads the OS Dynamic Type setting
    // and scales TEXT ONLY (-webkit-text-size-adjust on <body>), leaving the rem-derived
    // layout and the --vvh/--vvt keyboard math untouched. Remove that and the app has NO way
    // to enlarge text at all; lift this lock and the focus auto-zoom comes back.
    if (isIOS()) {
      const meta = document.querySelector('meta[name="viewport"]')
      if (meta && !/maximum-scale/.test(meta.getAttribute('content') || '')) {
        meta.setAttribute('content', `${meta.getAttribute('content')}, maximum-scale=1`)
      }
    }

    const root = document.documentElement
    const banner = document.getElementById('prelaunch-banner')
    if (!banner) { root.style.setProperty('--banner-h', '0px'); return }
    const set = () => root.style.setProperty('--banner-h', `${banner.offsetHeight}px`)
    set()
    // The bilingual banner wraps to 2–3 lines on narrow screens, so its height is dynamic.
    const ro = new ResizeObserver(set)
    ro.observe(banner)
    return () => ro.disconnect()
  }, [])
  return null
}
