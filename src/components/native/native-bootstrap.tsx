'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/context/theme-context'
import { useLanguage } from '@/context/language-context'
import { setNativeKeyboard } from '@/hooks/use-virtual-keyboard'
import { hapticTap } from '@/lib/haptics'
import { canonicalAppPath } from '@/lib/deep-link'

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
  const pathname = usePathname()
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
        else if (res.index === 1) {
          // Android WebView has no navigator.clipboard — copyText falls back to execCommand.
          // Only confirm a copy that actually landed; a silent fake "copied" would be a lie.
          const [{ copyText }, { toast }] = await Promise.all([import('@/lib/copy-text'), import('sonner')])
          if (await copyText(url)) toast.success(tr('Link copied', 'Đã sao chép liên kết'))
          else toast.error(tr("Couldn't copy the link", 'Không sao chép được liên kết'))
        }
        else if (res.index === 2) { router.push(href) } // href is app-relative by construction — stay in the SPA
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
  }, [tr, router])

  // One-time native wiring: platform class, splash, keyboard bridge, hardware back.
  useEffect(() => {
    if (!isNative()) return
    let disposed = false
    const cleanups: Array<() => void> = []
    document.documentElement.classList.add('native', `native-${cap()?.getPlatform?.() ?? 'ios'}`)

    // Listener handles resolve AFTER awaits: if the cleanup already ran mid-await, pushing the
    // handle into `cleanups` would orphan a live listener. Adopt-or-remove instead.
    const adopt = (handle: { remove: () => void | Promise<void> }) => {
      if (disposed) void handle.remove()
      else cleanups.push(() => { void handle.remove() })
    }

    void (async () => {
      const [{ SplashScreen }, { Keyboard }, { App }] = await Promise.all([
        import('@capacitor/splash-screen'),
        import('@capacitor/keyboard'),
        import('@capacitor/app'),
      ])
      if (disposed) return
      const android = cap()?.getPlatform?.() === 'android'

      // Painted → reveal the app (crossfade, not a hard cut).
      SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {})

      // Native keyboard → the SAME store the web VisualViewport path drives.
      // ⚠️ Platform asymmetry: the config's Keyboard resize:'none' is honored on iOS ONLY. On
      // Android, Capacitor's SystemBars insets listener independently pads the WebView parent by
      // the IME inset — the native resize owns the geometry, and passing keyboardHeight through
      // would DOUBLE-compensate (composer floats a keyboard-height too high). So Android reports
      // height 0 (`open` still hides mobile-nav; setNativeKeyboard then derives --vvh from the
      // already-shrunk innerHeight). iOS stays byte-identical.
      // Baseline viewport height while the IME is CLOSED. Captured out-of-band (not at
      // keyboardWillShow — Capacitor emits that from WindowInsetsAnimation.onStart, AFTER
      // the end-state insets have resized the WebView, so a same-tick capture would read
      // the already-shrunk viewport and defeat the check below).
      let kbOpen = false
      let closedInnerHeight = window.innerHeight
      const refreshKbBaseline = () => { if (!kbOpen) closedInnerHeight = window.innerHeight }
      window.addEventListener('resize', refreshKbBaseline)
      cleanups.push(() => window.removeEventListener('resize', refreshKbBaseline))
      adopt(await Keyboard.addListener('keyboardWillShow', (info) => {
        kbOpen = true
        setNativeKeyboard(true, android ? 0 : info.keyboardHeight)
      }))
      // Android escape hatch: some setups never resize the WebView (floating/split keyboards,
      // ROM quirks) — there height 0 would trap the composer under the IME. Once the IME
      // settles, if the viewport never shrank from its closed-state baseline by ~the keyboard,
      // fall back to the reported height like iOS. (A truly floating keyboard reports ~0
      // height, so the fallback can't over-pad it.)
      if (android) {
        adopt(await Keyboard.addListener('keyboardDidShow', (info) => {
          requestAnimationFrame(() => {
            const shrunk = closedInnerHeight - window.innerHeight
            if (info.keyboardHeight > 0 && shrunk < info.keyboardHeight / 2) {
              setNativeKeyboard(true, info.keyboardHeight)
            }
          })
        }))
      }
      adopt(await Keyboard.addListener('keyboardWillHide', () => {
        kbOpen = false
        setNativeKeyboard(false, 0)
      }))

      // Android hardware back: navigate back if we can, else background the app. minimizeApp
      // (moveTaskToBack) keeps the process warm — exitApp() would kill it and force a cold
      // reload of the remote WebView on the next launch.
      adopt(await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back()
        else App.minimizeApp()
      }))

      // Deep-link router (App Links + app shortcuts + share targets). Three shapes:
      //   · https://eno.vn/... | https://www.eno.vn/... → route the path in the SPA
      //   · https://eno.forum/... | https://www.eno.forum/... → full-page navigate (cross-origin)
      //   · enovn://open?path=<url-encoded app path>    → route the decoded path
      // ⚠️ Known limitation: a deep link that arrives while the WebView sits ON eno.forum is
      // queued-not-acted — this file's JS (eno.vn's bundle) isn't running there, so nothing
      // handles the event until the WebView returns to eno.vn. No native-side fix attempted here.
      const routeDeepLink = (url: string) => {
        try {
          const u = new URL(url)
          let raw: string | null = null
          if (u.protocol === 'https:' && (u.hostname === 'eno.forum' || u.hostname === 'www.eno.forum')) {
            // Same canonicalize-then-validate discipline as the eno.vn branch: resolving the path
            // against the forum origin catches the protocol-relative escapes (`//evil.com`,
            // `/\evil.com`). Cross-origin, so the Next router can't take it — full-page assign;
            // allowNavigation keeps it inside the WebView.
            const fr = u.pathname + u.search + u.hash
            if (!fr.startsWith('/')) return
            const forumResolved = new URL(fr, 'https://eno.forum')
            if (forumResolved.origin !== 'https://eno.forum') return
            window.location.assign(forumResolved.toString())
            return
          }
          if (u.protocol === 'https:' && (u.hostname === 'eno.vn' || u.hostname === 'www.eno.vn')) {
            raw = u.pathname + u.search + u.hash
          } else if (u.protocol === 'enovn:' && u.host === 'open') {
            // Two forms (docs/UNIFIED_MOBILE_APP.md in the forum repo):
            //   ?path=<url-encoded eno.vn app path>
            //   ?url=<url-encoded absolute FIRST-PARTY https url> — cross-surface links
            //     (e.g. a forum shortcut) that must re-enter the full router above.
            const abs = u.searchParams.get('url')
            if (abs) {
              // https only — forbids enovn-in-enovn nesting (unbounded recursion).
              if (abs.startsWith('https://')) routeDeepLink(abs)
              return
            }
            raw = u.searchParams.get('path') // searchParams already URL-decodes once
          }
          // Canonicalize-then-validate via the SHARED helper (src/lib/deep-link.ts) —
          // the same discipline native-push now uses; the inline copy this replaces
          // was the reference implementation.
          const path = canonicalAppPath(raw, { blockAuthPaths: true })
          if (!path) return
          router.push(path)
        } catch { /* unparseable URL — ignore */ }
      }

      // Google OAuth deep-link return. Google blocks OAuth in the app's WebView, so the sign-in
      // button opens it in a real in-app browser tab; on success Supabase redirects to
      // `enovn://auth-callback?code=…`, which reopens the app HERE. Forward that code to the SAME
      // server /auth/callback route the web uses — it runs in THIS WebView's cookie jar, reads the
      // PKCE verifier cookie set by signInWithOAuth, exchanges it, provisions + onboards.
      // Precise match — a substring test would also hit a legitimate App Link that merely
      // CONTAINS "://auth-callback" in a query param and hijack it into the auth flow.
      const isAuthCallback = (url: string) => {
        try {
          const u = new URL(url)
          return u.protocol === 'enovn:' && u.host === 'auth-callback'
        } catch { return false }
      }
      // ONE dispatch path for both deliveries. Platform asymmetry: iOS fires a RETAINED
      // appUrlOpen for the launching URL AND returns it from getLaunchUrl (double delivery);
      // Android fires appUrlOpen only from onNewIntent (warm), so a cold-start URL arrives
      // ONLY via getLaunchUrl — including a fresh OAuth callback when the shell was killed
      // behind the Custom Tab. The short dedupe window collapses the iOS double delivery
      // without blocking a deliberately repeated link (same shortcut tapped again later).
      let lastUrl = ''
      let lastAt = 0
      const dispatch = (url: string) => {
        const now = Date.now()
        if (url === lastUrl && now - lastAt < 5000) return
        lastUrl = url
        lastAt = now
        if (isAuthCallback(url)) {
          const query = url.split('?')[1] ?? ''
          void import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}))
          window.location.assign(`/auth/callback${query ? `?${query}` : ''}`)
          return
        }
        routeDeepLink(url)
      }
      adopt(await App.addListener('appUrlOpen', ({ url }) => dispatch(url)))

      // Cold start (see the platform asymmetry above). A replayed stale auth code (activity
      // recreation with the old intent) just fails the exchange benignly; dropping a FRESH
      // one would break Android cold-start sign-in outright.
      // ⚠️ getLaunchUrl returns the RETAINED launch URL for the app's whole life, and every
      // cross-origin hop (forum ↔ market) boots a fresh document whose in-memory dedupe is
      // empty — without a persistent marker, launching from a forum link would re-bounce the
      // user to the forum on EVERY return to eno.vn. sessionStorage is per-origin and
      // survives same-origin navigations: consume each launch URL exactly once per app run.
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
      cleanups.forEach((c) => c())
    }
  }, [router]) // stable identity — effectively mount-once

  // Status bar follows the in-app theme: dark text on the light card, light text on the dark card.
  useEffect(() => {
    if (!isNative()) return
    void (async () => {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      // useTheme().resolved is 'light' until hydration, but the pre-paint head script has already
      // stamped `.dark` on <html> — read THAT for the style so the first frames of a dark launch
      // get the right icon contrast. `resolved` stays the dependency: theme flips re-run this.
      const dark = document.documentElement.classList.contains('dark')
      // ⚠️ Capacitor's Style enum is named for the BACKGROUND, not the text: Style.Dark = LIGHT
      // text (use on a DARK ui); Style.Light = DARK text (use on a LIGHT ui). So follow the theme
      // directly — dark theme → Style.Dark (light text), light theme → Style.Light (dark text).
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
      // Android draws its own status-bar background; iOS shows the WebView (the bg-card header)
      // behind a transparent bar, so it only needs the style above.
      const color = cardColor()
      if (color && cap()?.getPlatform?.() === 'android') {
        StatusBar.setBackgroundColor({ color }).catch(() => {})
      }
    })()
  }, [resolved])

  // Android pull-to-refresh gating. MainActivity's SwipeRefreshLayout already blocks the pull
  // while the WebView is scrolled, but on surfaces whose scrolling is INTERNAL the document sits
  // at scrollY 0 and the layout steals every downward drag: the chat thread (html.chat-locked /
  // /messages), the map view, and the fullscreen video feed. Publish "PTR allowed" over the
  // EnoNative bridge (addJavascriptInterface — the call is synchronous, so a touchstart-time
  // write lands before SwipeRefreshLayout passes touch slop on the following move). No-op on
  // web + iOS (bridge only exists on Android; effect exits early elsewhere).
  useEffect(() => {
    if (cap()?.getPlatform?.() !== 'android') return
    type PtrBridge = { setPtrEnabled?: (enabled: boolean) => void }
    const bridge = () => (window as unknown as { EnoNative?: PtrBridge }).EnoNative
    const recompute = () => {
      // location.search read directly — useSearchParams would force a Suspense boundary.
      const mapView =
        new URLSearchParams(window.location.search).get('view') === 'map' ||
        // The map tab toggles in-page WITHOUT touching the URL; Leaflet stamps this class on
        // its container the moment the map view mounts (and only then — it's lazy).
        !!document.querySelector('.leaflet-container')
      const videoOpen =
        (window.history.state as { takeover?: string } | null)?.takeover === 'video'
      const enabled = !(
        document.documentElement.classList.contains('chat-locked') ||
        window.location.pathname.startsWith('/messages') ||
        mapView ||
        videoOpen
      )
      bridge()?.setPtrEnabled?.(enabled)
    }
    recompute()
    // chat-locked flips via the <html> class; map/video open with NO route change and pushState
    // fires no event — the class observer + popstate + a passive touchstart recompute (cheap:
    // two class checks + one query) together cover every entry/exit path.
    const obs = new MutationObserver(recompute)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('popstate', recompute)
    document.addEventListener('touchstart', recompute, { passive: true, capture: true })
    return () => {
      obs.disconnect()
      window.removeEventListener('popstate', recompute)
      document.removeEventListener('touchstart', recompute, true)
      bridge()?.setPtrEnabled?.(true) // never leave PTR stuck off across remounts
    }
  }, [pathname]) // re-run on route change — pathname feeds the /messages check

  return null
}
