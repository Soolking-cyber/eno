'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useNotifications } from '@/context/notifications-context'

// The app-icon badge, web-side half. Completes the contract native-push.tsx already states:
// "banner from the OS, badge from the app, no third signal."
//
// WHY THIS EXISTS WHEN THE SERVER ALREADY SETS THE BADGE. `aps.badge` on a push is the
// authoritative source and needs no plugin at all — that half works on any installed build,
// and it is what makes the count appear when the app is CLOSED. What it cannot do is react
// to anything that happens with no push involved:
//   · the user reads on ANOTHER device, or on the web, and comes back to this one;
//   · the badge-only sync push (syncBadgeToProfile) was throttled or dropped by iOS, which
//     Apple explicitly does not guarantee for background pushes;
//   · the app is open and the poll lowers the count while the icon still says otherwise.
// Foregrounding is the moment the user LOOKS at the icon, so re-asserting the truth then is
// what keeps it honest. The two halves are deliberately redundant: both write the same
// absolute number, so whichever lands last is still correct.
//
// Mounted inside NotificationsProvider + ChatProvider (providers.tsx) because it reads both
// counts, and inside AuthProvider so signing out can clear the icon.

type CapGlobal = { isNativePlatform?: () => boolean }
const cap = (): CapGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor

export function NativeBadge() {
  const { user } = useAuth()
  const { unread: notifUnread } = useNotifications()
  const { unread: chatUnread } = useChat()

  // Same definition as src/lib/unread.ts — notifications + messages.
  const total = user ? (notifUnread || 0) + (chatUnread || 0) : 0

  // Read through a ref so the resume listener (registered once) always sees the CURRENT
  // count rather than closing over the value it mounted with.
  const totalRef = useRef(total)
  useEffect(() => { totalRef.current = total }, [total])

  // Skip the redundant write when the number has not moved — this runs on every poll tick.
  const lastWritten = useRef<number | null>(null)

  useEffect(() => {
    if (!cap()?.isNativePlatform?.()) return
    let cancelled = false

    const write = async (count: number) => {
      if (cancelled) return
      if (lastWritten.current === count) return
      try {
        const { Badge } = await import('@capawesome/capacitor-badge')
        // ⚠️ THIS FILE MUST NEVER TRIGGER THE OS NOTIFICATION PROMPT. The old note here assumed
        // "the badge is authorised by the same prompt native-push shows" and so called set()/clear()
        // freely — but that is wrong for @capawesome/capacitor-badge: its iOS set/clear/increase/
        // decrease each call requestPermissions() FIRST (BadgePlugin.swift), i.e.
        // UNUserNotificationCenter.requestAuthorization(.badge) — the OS dialog. And this component
        // runs for a GUEST too (total 0 → clear()), so on a cold first launch it popped
        // "eno Would Like to Send You Notifications" before the user did anything, and before
        // native-push (which needs a signed-in user) could ever run. That premature, un-earned
        // prompt tanks opt-in. Fix: gate on ALREADY-granted permission. checkPermissions() is
        // silent (getNotificationSettings, no dialog); write the badge only when permission
        // already exists, leaving native-push.tsx as the SINGLE place that ever asks. Not granted
        // = nothing to reflect yet (a guest has no badge anyway); the next count change or
        // foreground re-write applies it once the user has granted via the push flow.
        if ((await Badge.checkPermissions()).display !== 'granted') return
        if (count > 0) await Badge.set({ count })
        else await Badge.clear()
        if (!cancelled) lastWritten.current = count
      } catch {
        // Plugin missing (a build predating it), permission denied, or an unsupported Android
        // launcher. A badge is decoration on top of the notification itself — never surface
        // this, and never let it break the render.
      }
    }

    void write(total)

    // Re-assert on foreground. The count can have changed while we were away — read on
    // another device, or a badge-sync push that iOS chose not to deliver.
    let remove: (() => void) | undefined
    void (async () => {
      try {
        const { App } = await import('@capacitor/app')
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) return
          // Force the write: the cached value is exactly what we no longer trust here.
          lastWritten.current = null
          void write(totalRef.current)
        })
        if (cancelled) { void handle.remove() } else { remove = () => { void handle.remove() } }
      } catch { /* @capacitor/app unavailable — the count-change path above still works */ }
    })()

    return () => { cancelled = true; remove?.() }
  }, [total])

  return null
}
