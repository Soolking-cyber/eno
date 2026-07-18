'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/context/auth-context'
import { canonicalAppPath } from '@/lib/deep-link'

// Native push registration (Capacitor). Mounted inside AuthProvider so it registers only for a
// signed-in user (the token endpoint is auth-gated). DORMANT until @capacitor/push-notifications is
// wired into the native builds (cap sync) + FCM/APNs are configured — until then register() throws
// "not implemented" and the try/catch no-ops. See NATIVE_PUSH_SETUP.md.
type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string }
const cap = (): CapGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor

export function NativePush() {
  const { user } = useAuth()
  const started = useRef(false)

  useEffect(() => {
    if (!user || started.current || !cap()?.isNativePlatform?.()) return
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
          if (path) window.location.assign(path)
        }))

        if (!disposed) await PushNotifications.register()
      } catch { /* plugin not wired / permission denied — dormant */ }
    })()

    return () => { disposed = true; cleanups.forEach((c) => c()) }
  }, [user])

  return null
}
