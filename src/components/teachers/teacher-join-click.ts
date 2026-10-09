import type { MouseEvent } from 'react'
import { isNativeShell } from '@/lib/native-browser'
import { localizedHref } from '@/lib/lang-pinned'

/**
 * ⛔ IN THE iOS / ANDROID APP THE SIGN-UP HOST WOULD OPEN THE SYSTEM BROWSER, SIGNED OUT (pill verification, 2026-10-09).
 * The shell keeps only eno.vn in its WebView (capacitor.config.ts allowNavigation), so a tap on https://teacher.eno.vn/
 * left the app — and at the form's hand-off the teacher signed in again in Safari / Chrome. In the app the SAME form opens
 * in place instead: /teachers/join, with the session and its existing-profile check. The web keeps the owner's host.
 * A modified or middle click is left to the browser, as everywhere else in the rail.
 */
export function keepTeacherJoinInApp(e: MouseEvent<HTMLAnchorElement>, lang: string): void {
  if (!isNativeShell() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  window.location.assign(localizedHref('/teachers/join', lang))
}
