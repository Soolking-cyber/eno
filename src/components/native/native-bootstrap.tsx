'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/context/theme-context'
import { useLanguage } from '@/context/language-context'
import { setNativeKeyboard } from '@/hooks/use-virtual-keyboard'
import { hapticTap } from '@/lib/haptics'

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
  const router = useRouter()
  const { tr } = useLanguage()

  // Native pull-to-refresh: MainViewController's UIRefreshControl fires `eno:native-refresh` on pull;
  // soft-refresh the current route (re-fetch server components) — no full reload, so scroll + SPA
  // state survive. No-op on web (event never fires there).
  useEffect(() => {
    const onRefresh = () => router.refresh()
    window.addEventListener('eno:native-refresh', onRefresh)
    return () => window.removeEventListener('eno:native-refresh', onRefresh)
  }, [router])

  // Long-press a listing card → native action sheet (Share / Copy link / Open) — the native gesture
  // users reach for on a card. Non-invasive: a global capture keyed off the card's `data-card-link`
  // attr, native-only, so it never touches ListingCard. A 500ms hold that survives no finger movement
  // fires the sheet; the follow-up tap (which would navigate) is swallowed once.
  useEffect(() => {
    if (!isNative()) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let suppressClick = false
    const clear = () => { if (timer) { clearTimeout(timer); timer = null } }

    const openSheet = async (link: HTMLAnchorElement) => {
      clear()
      const href = link.getAttribute('href') || ''
      if (!href) return
      const url = new URL(href, window.location.origin).toString()
      const title = link.getAttribute('aria-label') || document.title
      suppressClick = true // the touchend fires a click we must swallow so it doesn't navigate
      hapticTap()
      try {
        const { ActionSheet, ActionSheetButtonStyle } = await import('@capacitor/action-sheet')
        const res = await ActionSheet.showActions({
          title,
          options: [
            { title: tr('Share', 'Chia sẻ') },
            { title: tr('Copy link', 'Sao chép liên kết') },
            { title: tr('Open', 'Mở') },
            { title: tr('Cancel', 'Hủy'), style: ActionSheetButtonStyle.Cancel },
          ],
        })
        if (res.index === 0) { const { Share } = await import('@capacitor/share'); await Share.share({ url, title }) }
        else if (res.index === 1) { try { await navigator.clipboard.writeText(url) } catch { /* ignore */ } }
        else if (res.index === 2) { window.location.assign(href) }
      } catch { /* plugin missing / dismissed */ }
      setTimeout(() => { suppressClick = false }, 700)
    }

    let startX = 0, startY = 0
    const onStart = (e: TouchEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[data-card-link]') as HTMLAnchorElement | null
      if (!link) return
      const t = e.touches[0]
      startX = t?.clientX ?? 0; startY = t?.clientY ?? 0
      clear()
      timer = setTimeout(() => { void openSheet(link) }, 500)
    }
    // Only cancel the hold if the finger actually MOVES (a scroll/drag) — small jitter while holding
    // still must not kill it. 10px threshold matches the platform's own long-press slop.
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) clear()
    }
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', clear, { passive: true })
    document.addEventListener('touchcancel', clear, { passive: true })
    document.addEventListener('click', onClickCapture, true)
    return () => {
      clear()
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', clear)
      document.removeEventListener('touchcancel', clear)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [tr])

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
