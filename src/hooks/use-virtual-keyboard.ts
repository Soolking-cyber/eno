'use client'

import { useEffect, useState } from 'react'

/**
 * Detects the on-screen (virtual) keyboard via the VisualViewport API. iOS Safari
 * OVERLAYS the keyboard without shrinking innerHeight/dvh, so the only reliable
 * signal is the gap between the layout viewport and the (shrunken) visual viewport.
 * Returns `open` (keyboard overlapping >120px — a keyboard, not the URL bar) and
 * `height` (the visible viewport height while open, for sizing a chat shell). SSR-
 * and desktop-safe: no visualViewport, or no keyboard, ⇒ `{ open:false, height:null }`.
 */
export function useVirtualKeyboard(): { open: boolean; height: number | null } {
  const [state, setState] = useState<{ open: boolean; height: number | null }>({ open: false, height: null })
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const apply = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop
      setState(overlap > 120 ? { open: true, height: vv.height } : { open: false, height: null })
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [])
  return state
}
