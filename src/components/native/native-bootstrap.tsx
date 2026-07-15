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
      // Style.Dark = DARK content (for a light bg); Style.Light = LIGHT content (for a dark bg).
      StatusBar.setStyle({ style: resolved === 'dark' ? Style.Light : Style.Dark }).catch(() => {})
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
