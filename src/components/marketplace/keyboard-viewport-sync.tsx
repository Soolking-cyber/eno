'use client'

import { useEffect } from 'react'
import { ensureKeyboardWired } from '@/hooks/use-virtual-keyboard'

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
