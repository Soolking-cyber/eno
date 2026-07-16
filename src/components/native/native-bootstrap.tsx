'use client'

import { useEffect } from 'react'
import { useTheme } from '@/context/theme-context'
import { setNativeKeyboard } from '@/hooks/use-virtual-keyboard'

// The status bar sits over the bg-card header, so it must match it. Read the LIVE --card token
// (which already flips light/dark) at runtime — no hardcoded colour, always in sync with the theme.
const cardColor = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--card').trim()

type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string }
const cap = (): CapGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor
const isNative = () => !!cap()?.isNativePlatform?.()

/**
 * Native-shell bootstrap (Capacitor). A NO-OP on web/desktop: it reads the injected
 * `window.Capacitor` global and never imports `@capacitor/*` unless we're actually on-device, so
 * the web bundle is completely untouched. On iOS/Android it:
 *   · hides the splash once the app has painted (no white flash — the splash covered the WebView's
 *     first remote load),
 *   · matches the status bar to the bg-card header, following the in-app theme,
 *   · feeds the native keyboard into the shared keyboard store so mobile-nav slides away, and
 *   · handles the Android hardware back button.
 * Mount once, high in the tree, INSIDE ThemeProvider.
 */
export function NativeBootstrap() {
  const { resolved } = useTheme()

  // One-time native wiring: platform class, splash, keyboard bridge, hardware back.
  useEffect(() => {
    if (!isNative()) return
    let disposed = false
    const cleanups: Array<() => void> = []
    document.documentElement.classList.add('native', `native-${cap()?.getPlatform?.() ?? 'ios'}`)

    void (async () => {
      const [{ SplashScreen }, { Keyboard }, { App }] = await Promise.all([
        import('@capacitor/splash-screen'),
        import('@capacitor/keyboard'),
        import('@capacitor/app'),
      ])
      if (disposed) return

      // Painted → reveal the app.
      SplashScreen.hide().catch(() => {})

      // Native keyboard → the SAME store the web VisualViewport path drives.
      const onShow = await Keyboard.addListener('keyboardWillShow', (info) =>
        setNativeKeyboard(true, info.keyboardHeight),
      )
      const onHide = await Keyboard.addListener('keyboardWillHide', () => setNativeKeyboard(false, 0))
      cleanups.push(() => { onShow.remove(); onHide.remove() })

      // Android hardware back: navigate back if we can, else let the OS background the app.
      const onBack = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back()
        else App.exitApp()
      })
      cleanups.push(() => { onBack.remove() })

      // Google OAuth deep-link return. Google blocks OAuth in the app's WebView, so the sign-in
      // button opens it in a real in-app browser tab; on success Supabase redirects to
      // `enovn://auth-callback?code=…`, which reopens the app HERE. Forward that code to the SAME
      // server /auth/callback route the web uses — it runs in THIS WebView, reads the PKCE verifier
      // cookie set by signInWithOAuth, exchanges it, provisions + onboards, session lands in-app.
      const onUrl = await App.addListener('appUrlOpen', ({ url }) => {
        if (!url.includes('://auth-callback')) return
        const query = url.split('?')[1] ?? ''
        void import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}))
        window.location.assign(`/auth/callback${query ? `?${query}` : ''}`)
      })
      cleanups.push(() => { onUrl.remove() })
    })()

    return () => {
      disposed = true
      cleanups.forEach((c) => c())
    }
  }, [])

  // Status bar follows the in-app theme: dark text on the light card, light text on the dark card.
  useEffect(() => {
    if (!isNative()) return
    void (async () => {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      // ⚠️ Capacitor's Style enum is named for the BACKGROUND, not the text: Style.Dark = LIGHT
      // text (use on a DARK ui); Style.Light = DARK text (use on a LIGHT ui). So follow the theme
      // directly — dark theme → Style.Dark (light text), light theme → Style.Light (dark text).
      StatusBar.setStyle({ style: resolved === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
      // Android draws its own status-bar background; iOS shows the WebView (the bg-card header)
      // behind a transparent bar, so it only needs the style above.
      const color = cardColor()
      if (color && cap()?.getPlatform?.() === 'android') {
        StatusBar.setBackgroundColor({ color }).catch(() => {})
      }
    })()
  }, [resolved])

  return null
}
