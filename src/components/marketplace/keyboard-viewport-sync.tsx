'use client'

import { useEffect } from 'react'
import { ensureKeyboardWired } from '@/hooks/use-virtual-keyboard'

/**
 * Mounted once at the app root. Wires the shared VisualViewport listener so the
 * --vvh/--vvt CSS vars + the `kb-open` <html> class are maintained on EVERY page,
 * independent of whether the bottom-nav (which also reads the keyboard) is rendered —
 * a chat thread hides the nav entirely, and the chat shell still needs the vars.
 * Renders nothing and never re-renders (no subscription).
 */
export function KeyboardViewportSync() {
  useEffect(() => { ensureKeyboardWired() }, [])
  return null
}
