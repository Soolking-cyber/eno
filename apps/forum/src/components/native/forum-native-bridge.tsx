'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/context/theme-context'
import { setNativeKeyboard } from '@/hooks/use-virtual-keyboard'

type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

const capacitor = () =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor

// Android's all-origin addJavascriptInterface bridge from the eno.vn shell. Exposes
// imperative hooks (e.g. setPtrEnabled) even where Capacitor itself is absent.
const enoNativeAndroidBridge = () =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { EnoNative?: { setPtrEnabled?: (enabled: boolean) => void } }).EnoNative

/**
 * Are we inside the ONE eno native app (owned by eno.vn)? Platform asymmetry,
 * source-verified: iOS injects window.Capacitor into EVERY page in the WebView;
 * Android injects it ONLY on the eno.vn origin — forum pages on Android get no
 * Capacitor, just window.EnoNative. The signal reliable on BOTH platforms is the
 * shell's UA token (capacitor.config appendUserAgent 'EnoNativeApp/1').
 */
export const isEnoApp = () =>
  typeof window !== 'undefined' &&
  (navigator.userAgent.includes('EnoNativeApp') ||
    Boolean(capacitor()?.isNativePlatform?.()) ||
    Boolean(enoNativeAndroidBridge()))

// Capacitor is authoritative when present (iOS in-app); without it, EnoNative or
// an Android UA means the Android WebView on this foreign origin, else iOS.
export const enoAppPlatform = (): 'ios' | 'android' => {
  const cap = capacitor()
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === 'android' ? 'android' : 'ios'
  return enoNativeAndroidBridge() || /android/i.test(navigator.userAgent) ? 'android' : 'ios'
}

const hasCapacitorBridge = () => Boolean(capacitor()?.isNativePlatform?.())
const FORUM_HOSTS = new Set(['eno.forum', 'www.eno.forum'])
const MARKETPLACE_HOSTS = new Set(['eno.vn', 'www.eno.vn'])

function localForumPath(url: URL) {
  if (url.protocol !== 'https:' || !FORUM_HOSTS.has(url.hostname)) return null
  // `https://eno.forum//evil.example` parses to pathname `//evil.example`, which the Next
  // router would treat as a protocol-relative EXTERNAL url. Re-resolving against the forum
  // origin catches that and the `/\` variant (\ acts as / in special schemes).
  const raw = `${url.pathname}${url.search}${url.hash}`
  let resolved: URL
  try {
    resolved = new URL(raw, 'https://eno.forum')
  } catch {
    return null
  }
  if (resolved.origin !== 'https://eno.forum') return null
  let probe = resolved.pathname
  for (let index = 0; index < 3; index += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(probe)
    } catch {
      break
    }
    if (decoded === probe) break
    probe = decoded
  }
  // Authentication callbacks must finish in the browser context that initiated them.
  if (probe.startsWith('/auth') || probe.startsWith('/signin')) return null
  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

/**
 * Forum half of the shared eno Capacitor shell. It is inert in ordinary browsers; app-mode is
 * detected via isEnoApp() (UA token first — the only signal present on BOTH platforms here) and
 * Capacitor plugins load only where the bridge actually exists (iOS). The actual native projects
 * remain owned by eno.vn; this repository never creates a second app.
 */
export function ForumNativeBridge() {
  const router = useRouter()
  const { resolved } = useTheme()

  useEffect(() => {
    if (!isEnoApp()) return
    let disposed = false
    const cleanups: Array<() => void> = []
    const platform = enoAppPlatform()
    document.documentElement.classList.add('native', `native-${platform}`)

    // Pull-to-refresh: the native shell dispatches this on both platforms.
    const onNativeRefresh = () => router.refresh()
    window.addEventListener('eno:native-refresh', onNativeRefresh)
    cleanups.push(() => window.removeEventListener('eno:native-refresh', onNativeRefresh))

    // Android PTR gating: with any MODAL open (thread dialog etc.) the document stays at
    // scrollY 0, so the shell's SwipeRefreshLayout would steal the downward drag that should
    // scroll the dialog body. EnoNative is Android's channel; optional-chained no-op on iOS
    // (whose UIRefreshControl rides the body scroll view, which the modal scroll-lock parks).
    // rAF-coalesced — portals mutate the DOM often while a dialog is open.
    let ptrCheckQueued = false
    const syncPtr = () => {
      if (ptrCheckQueued) return
      ptrCheckQueued = true
      requestAnimationFrame(() => {
        ptrCheckQueued = false
        enoNativeAndroidBridge()?.setPtrEnabled?.(!document.querySelector('[role="dialog"]'))
      })
    }
    const modalObserver = new MutationObserver(syncPtr)
    modalObserver.observe(document.body, { childList: true, subtree: true })
    syncPtr()
    cleanups.push(() => {
      modalObserver.disconnect()
      enoNativeAndroidBridge()?.setPtrEnabled?.(true)
    })

    /* CAPABILITY SPLIT — iOS: full Capacitor bridge on this origin (keyboard,
       appUrlOpen deep links, back button, status bar below). Android: NO Capacitor
       here, so the plugin imports are skipped entirely (they would only no-op);
       the keyboard/back/PTR are handled by the shell itself. If a forum surface
       ever needs pull-blocking on Android, window.EnoNative.setPtrEnabled(false)
       is available — no surface needs it today. */
    if (!hasCapacitorBridge()) {
      return () => {
        disposed = true
        cleanups.forEach((cleanup) => cleanup())
      }
    }

    const adopt = (handle: { remove: () => void | Promise<void> }) => {
      if (disposed) void handle.remove()
      else cleanups.push(() => { void handle.remove() })
    }

    void (async () => {
      const [{ App }, { Keyboard }, { SplashScreen }] = await Promise.all([
        import('@capacitor/app'),
        import('@capacitor/keyboard'),
        import('@capacitor/splash-screen'),
      ])
      if (disposed) return
      const android = platform === 'android'

      SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {})

      let keyboardOpen = false
      let closedInnerHeight = window.innerHeight
      const refreshKeyboardBaseline = () => {
        if (!keyboardOpen) closedInnerHeight = window.innerHeight
      }
      window.addEventListener('resize', refreshKeyboardBaseline)
      cleanups.push(() => window.removeEventListener('resize', refreshKeyboardBaseline))

      adopt(await Keyboard.addListener('keyboardWillShow', (info) => {
        keyboardOpen = true
        setNativeKeyboard(true, android ? 0 : info.keyboardHeight)
      }))
      if (android) {
        adopt(await Keyboard.addListener('keyboardDidShow', (info) => {
          requestAnimationFrame(() => {
            const nativeResize = closedInnerHeight - window.innerHeight
            if (info.keyboardHeight > 0 && nativeResize < info.keyboardHeight / 2) {
              setNativeKeyboard(true, info.keyboardHeight)
            }
          })
        }))
      }
      adopt(await Keyboard.addListener('keyboardWillHide', () => {
        keyboardOpen = false
        setNativeKeyboard(false, 0)
      }))

      adopt(await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back()
        else void App.minimizeApp()
      }))

      const routeDeepLink = (raw: string) => {
        try {
          const incoming = new URL(raw)
          const localPath = localForumPath(incoming)
          if (localPath) {
            router.push(localPath)
            return
          }
          if (incoming.protocol === 'https:' && MARKETPLACE_HOSTS.has(incoming.hostname)) {
            window.location.assign(incoming.toString())
            return
          }
          // New cross-surface scheme contract: enovn://open?url=<absolute first-party URL>.
          // The existing eno.vn `path` form remains marketplace-owned and is intentionally not
          // reinterpreted here because the same relative path can mean different things per host.
          if (incoming.protocol === 'enovn:' && incoming.host === 'open') {
            const absolute = incoming.searchParams.get('url')
            if (!absolute) return
            const target = new URL(absolute)
            const targetLocalPath = localForumPath(target)
            if (targetLocalPath) router.push(targetLocalPath)
            else if (target.protocol === 'https:' && MARKETPLACE_HOSTS.has(target.hostname)) {
              window.location.assign(target.toString())
            }
          }
        } catch {
          // Ignore malformed or non-first-party links.
        }
      }

      let lastUrl = ''
      let lastAt = 0
      const dispatch = (url: string) => {
        const now = Date.now()
        if (url === lastUrl && now - lastAt < 5000) return
        lastUrl = url
        lastAt = now
        routeDeepLink(url)
      }
      adopt(await App.addListener('appUrlOpen', ({ url }) => dispatch(url)))
      // getLaunchUrl returns the RETAINED launch URL for the app's whole life, and every
      // cross-origin hop (market ↔ forum) boots a fresh document with empty in-memory
      // dedupe — consume each launch URL exactly once per app run via sessionStorage
      // (per-origin, survives same-origin navigations), or a market launch link would
      // re-bounce the user off the forum on every visit.
      const launch = await App.getLaunchUrl().catch(() => undefined)
      if (!disposed && launch?.url) {
        const KEY = 'eno:launch-url-handled'
        let handled: string | null = null
        try { handled = sessionStorage.getItem(KEY) } catch { /* storage unavailable */ }
        if (handled !== launch.url) {
          try { sessionStorage.setItem(KEY, launch.url) } catch { /* storage unavailable */ }
          dispatch(launch.url)
        }
      }
    })()

    return () => {
      disposed = true
      setNativeKeyboard(false, 0)
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [router])

  useEffect(() => {
    // Status bar is a Capacitor plugin — reachable only where the bridge exists
    // (iOS; Android forum pages have no Capacitor and the shell styles its own bar).
    if (!hasCapacitorBridge()) return
    void (async () => {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      const dark = document.documentElement.classList.contains('dark')
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
      if (capacitor()?.getPlatform?.() === 'android') {
        const color = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
        if (color) await StatusBar.setBackgroundColor({ color }).catch(() => {})
      }
    })()
  }, [resolved])

  return null
}
