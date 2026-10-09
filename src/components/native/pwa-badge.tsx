'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useNotifications } from '@/context/notifications-context'

// The app-icon badge, INSTALLED-PWA half — the Web Badging API (navigator.setAppBadge). NativeBadge
// covers the Capacitor build; this covers the plain installed PWA (iOS Safari Home Screen, desktop
// installed PWA) where Capacitor.isNativePlatform() is false and the @capawesome plugin is absent.
//
// WHY A FOREGROUND WRITER EXISTS WHEN THE SERVICE WORKER ALREADY SETS THE BADGE. The SW push handler
// (public/sw.js) sets the badge from the pushed unread total while the app is CLOSED — that is what
// makes the count appear when you're away. What it can NEVER do is lower the count: iOS forbids a
// silent badge-only push, so reading a thread (which drops the true unread) has no user-visible push
// to carry the decrement. Foregrounding is the moment the user looks at the icon and has usually just
// read, so re-asserting the real count then is the ONLY path by which the badge goes down. Both halves
// write the same absolute number; whichever lands last is correct.
//
// Mounted next to <NativeBadge/> in providers.tsx (inside Auth + Notifications + Chat providers, so it
// can read both counts and so sign-out clears the icon). Mutually exclusive with NativeBadge via the
// isNativePlatform gate — the icon is never double-written.

type CapGlobal = { isNativePlatform?: () => boolean }
const isNative = (): boolean =>
  typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: CapGlobal }).Capacitor?.isNativePlatform?.()

// Installed standalone context only. A regular browser tab must not badge an app icon (setAppBadge
// there throws or no-ops), so we skip it. iOS uses the non-standard navigator.standalone; every other
// engine reports display-mode: standalone for an installed PWA.
const isInstalled = (): boolean => {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

const supported = (): boolean =>
  typeof navigator !== 'undefined' && 'setAppBadge' in navigator && 'clearAppBadge' in navigator

export function PwaBadge() {
  const { user } = useAuth()
  const { unread: notifUnread } = useNotifications()
  const { unread: chatUnread } = useChat()

  // Same definition as src/lib/unread.ts — notifications + messages. Zero when signed out, so a
  // sign-out clears the icon.
  const total = user ? (notifUnread || 0) + (chatUnread || 0) : 0

  // Read through a ref so the visibility listener (registered once per effect) always sees the
  // CURRENT count rather than closing over the value it mounted with.
  const totalRef = useRef(total)
  useEffect(() => { totalRef.current = total }, [total])

  // Skip the redundant write on every poll tick — this reactive effect fires on each count refresh.
  // The foreground re-assert below deliberately BYPASSES this guard (resets to null first): the
  // service worker may have moved the OS badge while we were backgrounded, so on return our cached
  // value is exactly what we no longer trust — the same reason NativeBadge forces its foreground write.
  const lastWritten = useRef<number | null>(null)
  // ⛔ THE CURRENT COUNT WINS — NOT A QUEUE (the same mechanism as NativeBadge, F8). setAppBadge/clearAppBadge are
  // async and the spec orders nothing between overlapping calls, so a slow setAppBadge(3) could resolve AFTER a newer
  // clearAppBadge() and leave a stale count — the previous ACCOUNT's, at a switch. These writes used to be chained to
  // serialize them, but a chain makes ONE call that never settles freeze every later write, the foreground re-assert
  // included, for the rest of the page's life (the flaw both reviewers found in NativeBadge's first fix). So: a
  // cancelled write never starts; while a call is in flight the icon is unknown (lastWritten = null), so the next write
  // is never skipped as "unchanged"; and a call that lands — or fails, having perhaps changed the icon first — for a
  // count no longer current puts the current one back. A re-assert writes the current count, so it ends there.
  const reassert = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (isNative() || !supported() || !isInstalled()) return
    let cancelled = false

    const write = async (count: number) => {
      if (cancelled) return              // this effect run was torn down — a later run owns the icon
      if (lastWritten.current === count) return
      lastWritten.current = null         // in flight: what the icon shows is unknown until this lands
      try {
        if (count > 0) await navigator.setAppBadge(count)
        else await navigator.clearAppBadge()
        if (count === totalRef.current) lastWritten.current = count
        else reassert.current?.()        // the count moved on meanwhile, and a newer write may have landed first
      } catch {
        // No notification permission (iOS only shows the badge once granted), or an engine that
        // doesn't honor it. A badge is decoration on top of the notification — never surface this.
        if (count !== totalRef.current) reassert.current?.()
      }
    }
    reassert.current = () => { lastWritten.current = null; void write(totalRef.current) }

    void write(total)

    // Re-assert on foreground — the moment the user looks at the icon, and usually just read, which
    // lowered the true count with no push to carry it. FORCE past the skip guard: the cached value is
    // exactly what a background SW push may have invalidated.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      lastWritten.current = null
      void write(totalRef.current)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [total])

  return null
}
