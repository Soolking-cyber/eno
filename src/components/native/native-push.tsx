'use client'

import { useEffect, useRef } from 'react'
import { leavingForHomeTwin } from '@/lib/app-home-language'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { canonicalAppPath } from '@/lib/deep-link'
import { nativePushEnabled } from '@/lib/native-push-flags'

// Native push registration (Capacitor). Mounted inside AuthProvider so it registers only for a
// signed-in user (the token endpoint is auth-gated).
//
// ⚠️ GATED PER PLATFORM — `NEXT_PUBLIC_NATIVE_PUSH_IOS === '1'` / `NEXT_PUBLIC_NATIVE_PUSH_ANDROID === '1'`
// (src/lib/native-push-flags.ts) — and that gate is load-bearing, NOT belt-and-braces.
// The old comment here claimed push was "DORMANT until cap sync … register() throws not implemented"
// — that assumption is STALE: @capacitor/push-notifications is now cap-synced (PushNotificationsPlugin
// is in packageClassList on both platforms), so requestPermissions() is LIVE and shows the real iOS
// "Allow Notifications?" dialog. The App Store binary carries the aps-environment entitlement since
// 2026-10-06 (ios/App/App/App.entitlements, runbook P4), but a push can arrive only once the APNs key
// and env are on the box and the NativePushToken table exists (runbook P8). Until then a signed-in
// native user would be prompted for a capability that does nothing — burning iOS's one-shot
// permission grant on a dead feature. So we stay dormant behind the flag, and this is the ONE place
// that asks (native-badge.tsx only reads the answer). ACTIVATION (see NATIVE_PUSH_SETUP.md): APNs/FCM
// config + the table, THEN set the platform's flag.
//
// Per-platform switch — see src/lib/native-push-flags.ts for why there is no shared flag any more.
//
// ⚠️ FOREGROUND CONTRACT — ONE signal, and the OS owns it. There is deliberately NO
// 'pushNotificationReceived' listener here. A push that lands while the app is open is displayed by
// the OS itself, driven by `plugins.PushNotifications.presentationOptions` in capacitor.config.ts
// (banner + list + sound; that same array is what makes Android's foreground path post at all).
// Rendering an in-app toast from this file would put a sonner toast on screen UNDER the native
// banner for the same event — the classic wrapped-app double-notify. The web side does not
// double-notify either: service-worker web push (public/sw.js) is unavailable inside the WebView
// (reminder-settings.tsx gates on that), and the only in-app reaction to an incoming message is a
// SILENT unread-count bump — chat-context's Supabase realtime nudge, backstopped by the
// notifications poll. So: banner from the OS, badge from the app, no third signal. If a future
// change needs the in-app lists to react to a push, refresh STATE — never surface a second alert.
type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string }
const cap = (): CapGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor

export function NativePush() {
  const { user } = useAuth()
  const started = useRef(false)
  // The registration effect runs ONCE (started ref), so its listener would close over the first
  // router it saw. Read through a ref instead — kept current by its own effect (never written
  // during render, which would break render purity under concurrent React).
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => { routerRef.current = router }, [router])

  useEffect(() => {
    // ⛔ Not in a `/` document being replaced with `/vi` (app-home-language.ts): its retained tap belongs to `/vi`.
    if (!user || started.current || leavingForHomeTwin() || !cap()?.isNativePlatform?.() || !nativePushEnabled(cap()?.getPlatform?.())) return
    started.current = true
    let disposed = false
    const cleanups: Array<() => void> = []
    // Listener handles resolve AFTER awaits: if the cleanup already ran mid-await, pushing the
    // handle would orphan a live listener. Adopt-or-remove instead (mirrors native-bootstrap).
    const adopt = (handle: { remove: () => void | Promise<void> }) => {
      if (disposed) void handle.remove()
      else cleanups.push(() => { void handle.remove() })
    }

    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const platform = cap()?.getPlatform?.() === 'ios' ? 'ios' : 'android'

        let status = (await PushNotifications.checkPermissions()).receive
        if (status === 'prompt' || status === 'prompt-with-rationale') {
          status = (await PushNotifications.requestPermissions()).receive
        }
        if (status !== 'granted') return

        // Token arrives async → POST it to the auth-gated endpoint.
        adopt(await PushNotifications.addListener('registration', (t) => {
          void fetch('/api/push/native-subscribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: t.value, platform }),
          }).catch(() => {})
        }))
        // Tapping a notification deep-links into the app.
        adopt(await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
          const url = (a.notification?.data as { url?: string } | undefined)?.url
          // Canonicalize-then-validate (audit Phase 1): the old bare startsWith('/')
          // accepted `//evil.com` and navigated the trusted native shell to it.
          const path = typeof url === 'string' ? canonicalAppPath(url, { blockAuthPaths: true }) : null
          if (!path) return
          // Client-side nav, not a hard reload: location.assign re-fetched the whole remote
          // document (a second cold boot, seconds of white) for what is an ordinary in-app
          // route. router.push lands on it instantly and keeps the SPA warm — the same path
          // native-bootstrap's deep-link router already takes. Fall back to the old hard
          // navigation only if the router is somehow unavailable, so a tap is never swallowed.
          try { routerRef.current.push(path) } catch { window.location.assign(path) }
        }))

        if (!disposed) await PushNotifications.register()
      } catch { /* plugin not wired / permission denied — dormant */ }
    })()

    // Reset `started` so a sign-out→sign-in within the SAME app session re-registers: the guard
    // above short-circuits on started.current, and without clearing it here the second user would
    // get no push token (the effect re-runs on the new `user` but bails immediately).
    return () => { disposed = true; started.current = false; cleanups.forEach((c) => c()) }
  }, [user])

  return null
}
