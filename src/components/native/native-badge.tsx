'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useNotifications } from '@/context/notifications-context'

// The app-icon badge, web-side half. Completes the contract native-push.tsx already states:
// "banner from the OS, badge from the app, no third signal."
//
// WHY THIS EXISTS WHEN THE SERVER ALREADY SETS THE BADGE. `aps.badge` on a push is the
// authoritative source and needs no plugin — but, like any iOS badge, it shows only once the user
// has granted notification permission (native-push.tsx is the one asker). It is what makes the
// count appear when the app is CLOSED. What it cannot do is react
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
        // ⛔ NEVER ASK FROM HERE, AND NEVER WRITE UNTIL THE ANSWER IS 'granted' (audit 1.3,
        // 2026-10-06 — reverses 0d2f7a0b, which asked for badge-only authorization here while push
        // could not ask). iOS gives an app ONE notification prompt: whoever asks first spends it,
        // and a badge-only (.badge) grant leaves push with no alert and no sound — native-push's
        // later [.alert, .sound, .badge] request shows no dialog. The App Store binary carries
        // aps-environment now, so native-push.tsx (NEXT_PUBLIC_NATIVE_PUSH_IOS) is the ONE asker,
        // and its grant covers the badge. "Never write" is the same rule, not a second one:
        // @capawesome/capacitor-badge's iOS set/clear (and increase/decrease) call
        // requestAuthorization THEMSELVES before writing, so a set or clear while the status is
        // still 'prompt' IS the dialog. Until push is on and allowed the iOS icon shows no count —
        // a push's own aps.badge needs that same grant. Android reports 'granted' unconditionally
        // (the plugin's permission alias maps to no runtime permission), so it badges as before.
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
