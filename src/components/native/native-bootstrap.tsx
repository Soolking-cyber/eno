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

// ── Status bar ───────────────────────────────────────────────────────────────────────────────
// ONE writer for the native status bar, because two independent things drive it:
//   · the in-app theme — dark glyphs on the light card, light glyphs on the dark card; and
//   · the fullscreen BLACK takeovers (the vertical video feed, the PDP photo lightbox), which
//     must force light glyphs whatever the theme says. In LIGHT theme the bar's dark glyphs are
//     invisible against a black backdrop — the takeover looks like it ate the clock.
// Module scope rather than React state: the takeovers live in other trees (and are lazily
// imported), so they register through `pushBlackStatusBar()` below instead of prop-drilling.
let blackTakeovers = 0
let statusApplied = ''

/** What the bar SHOULD be showing right now. Reads the live `.dark` class rather than
 *  useTheme().resolved: the pre-paint head script stamps it before hydration, so the first frames
 *  of a dark launch already get the right contrast. */
const wantedStatusBar = () => {
  const black = blackTakeovers > 0
  return {
    dark: black || document.documentElement.classList.contains('dark'),
    // Android draws its own status-bar background; iOS shows the WebView (the bg-card header)
    // behind a transparent bar, so it needs the style alone. Under a black takeover the Android
    // strip has to go black too, or light glyphs land on the light card colour — the exact bug
    // one platform down. (Android 15+ makes setBackgroundColor a documented no-op, but there the
    // bar is transparent and viewport-fit:cover paints the takeover under it anyway.)
    // Not a design token: this is the literal hex the NATIVE window API takes, and it must match
    // the takeovers' own `bg-black` canvas exactly rather than any themeable surface.
    color: black ? /* design-lint-allow */ '#000000' : cardColor(),
  }
}

/** Push the wanted style/colour at the OS.
 *  `force` skips the no-op guard — use it whenever the NATIVE side may have drifted underneath
 *  us (resume, configuration change), where our cached value is no longer evidence of what the
 *  bar is actually showing. */
const applyStatusBar = (force = false) => {
  if (!isNative()) return
  const want = wantedStatusBar()
  const key = `${want.dark}|${want.color}`
  if (!force && key === statusApplied) return
  statusApplied = key
  void import('@capacitor/status-bar')
    .then(({ StatusBar, Style }) => {
      // ⚠️ Capacitor's Style enum is named for the BACKGROUND, not the text: Style.Dark = LIGHT
      // text (use on a DARK ui); Style.Light = DARK text (use on a LIGHT ui). So a dark surface
      // → Style.Dark.
      StatusBar.setStyle({ style: want.dark ? Style.Dark : Style.Light }).catch(() => {})
      if (want.color && cap()?.getPlatform?.() === 'android') {
        StatusBar.setBackgroundColor({ color: want.color }).catch(() => {})
      }
    })
    .catch(() => {})
}

/**
 * Re-assert the bar after something that can silently revert it.
 *
 * ⚠️ Android only in practice, and not a paranoia: `@capacitor/android` ships a BUNDLED core
 * plugin (`com.getcapacitor.plugin.SystemBars`) that keeps its OWN cached style — "DEFAULT", i.e.
 * whatever the OS night-mode scheme is — and re-applies it in `handleOnConfigurationChanged`.
 * `@capacitor/status-bar` re-applies OURS from the very same hook. Both end up calling
 * `setAppearanceLightStatusBars` on the same insets controller, so a configuration change (OS
 * night-mode flip, rotation, font-scale, locale) is a last-writer-wins race we don't get to order
 * — and eno has its own in-app theme, which can legitimately disagree with the OS scheme. There
 * is no JS API to teach SystemBars our style, so we simply write again after it: once
 * immediately, once after the native handlers have settled. Cheap (a no-op bridge call) and the
 * only fix available from the WebView side. Verified against @capacitor/android 8.4.2 sources.
 */
let reassertTimer: ReturnType<typeof setTimeout> | null = null
const reassertStatusBar = () => {
  applyStatusBar(true)
  if (reassertTimer) clearTimeout(reassertTimer)
  reassertTimer = setTimeout(() => { reassertTimer = null; applyStatusBar(true) }, 350)
}

/**
 * Register a fullscreen BLACK takeover (the vertical video feed, the PDP photo lightbox) with the
 * status bar: while one is open the bar carries LIGHT content whatever the in-app theme is.
 *
 * Returns the release fn — call it from the SAME effect's cleanup. React runs that cleanup on
 * EVERY dismissal path (✕, Escape, the Android hardware back button, the iOS edge-swipe, a route
 * change out of the surface), which is what makes the restore robust: there is no close handler to
 * forget. Ref-counted and idempotent, so a double release, or a pair that briefly overlaps, is
 * harmless. A no-op on web.
 */
export function pushBlackStatusBar(): () => void {
  if (!isNative()) return () => {}
  blackTakeovers += 1
  applyStatusBar()
  let released = false
  return () => {
    if (released) return
    released = true
    blackTakeovers = Math.max(0, blackTakeovers - 1)
    applyStatusBar()
  }
}

// Where the offline page should put the user back. Read by capacitor/www/error.html, which lives on
// the LOCAL origin (capacitor://localhost) and can therefore see none of eno.vn's storage — native
// Preferences is the one store both sides share. Keep the key in sync with that file.
const LAST_URL_KEY = 'eno:last-url'

// Overlays that must swallow the Android hardware back press instead of letting it navigate.
// Deliberately role-scoped rather than a bare `[data-open]`: Base UI puts `data-open` on
// Collapsible/Accordion panels too, and an open accordion must not eat a back press. This covers
// Dialog/AlertDialog/Sheet/Drawer/Popover (role=dialog|alertdialog), Menu/ContextMenu/Menubar
// (role=menu) and Select/Combobox (role=listbox) — i.e. every `src/components/ui/*` floating layer.
const BASE_UI_OPEN = [
  '[data-open][role="dialog"]',
  '[data-open][role="alertdialog"]',
  '[data-open][role="menu"]',
  '[data-open][role="listbox"]',
].join(',')

// The hand-rolled modals that predate the Base UI sweep (the mobile account rail, the PDP
// lightbox). `aria-modal` is set nowhere else in src, and `:not([data-open])` keeps this strictly
// disjoint from the Base UI set above.
const HANDROLLED_MODAL = '[role="dialog"][aria-modal="true"]:not([data-open])'

/**
 * Android hardware back → close the top layer, don't navigate the page out from under it.
 *
 * Base UI registers its Escape dismissal on the DOCUMENT (floating-ui-react's `useDismiss`), so one
 * document-targeted Escape closes exactly the topmost open layer — nesting is Base UI's own problem
 * and it already solves it (only the innermost layer consumes the key).
 *
 * Two deliberate details:
 *  · `bubbles: false` — the synthetic key must reach DOCUMENT listeners only. The fullscreen video
 *    takeover and the PDP lightbox listen for Escape on WINDOW *and* already push their own history
 *    entry, so back closes them correctly today; letting the key bubble to window would close them
 *    AND spend the entry, i.e. go back twice.
 *  · we don't trust "an overlay was open" as proof it closed. Base UI calls `preventDefault()` only
 *    when the layer actually dismissed (floating-ui-react's `closeOnEscapeKeyDown`), so that answers
 *    synchronously; for anything else we re-check shortly after and fall through to normal
 *    navigation if the overlay is still there. Back is never allowed to become a dead key.
 *
 * Exit animations are not a hazard here: Base UI swaps `data-open` for `data-closed` at the moment
 * it closes (not when the animation ends), the lightbox unmounts, and the account rail drops
 * `aria-modal` with its state — so a layer on its way out stops matching immediately.
 */
const backConsumedByOverlay = (navigate: () => void): boolean => {
  const dismiss = (overlay: Element, selector: string) => {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: false, cancelable: true })
    document.dispatchEvent(esc)
    if (esc.defaultPrevented) return // Base UI took it
    // A hand-rolled overlay closes on the same document-level Escape but doesn't preventDefault, so
    // its answer is a React commit we can only observe. Generous on purpose: the only cost of
    // waiting is a barely-perceptible delay on the rare press that finds a layer refusing to close.
    setTimeout(() => {
      if (document.querySelector(selector) === overlay) navigate()
    }, 160)
  }

  // A Base UI layer is always the topmost thing on screen — even when it was opened from inside one
  // of the history-owning takeovers below — so it gets first refusal on the press.
  const popup = document.querySelector(BASE_UI_OPEN)
  if (popup) { dismiss(popup, BASE_UI_OPEN); return true }

  // Surfaces that PUSH their own history entry (the fullscreen video takeover, the PDP lightbox)
  // already turn back into a close via popstate. Dismissing them here would close them AND leave
  // their entry behind for the next back press to spend — one press, two steps back.
  const state = window.history.state as { lightbox?: unknown; takeover?: unknown } | null
  if (state && (state.lightbox || state.takeover)) return false

  const modal = document.querySelector(HANDROLLED_MODAL)
  if (!modal) return false
  dismiss(modal, HANDROLLED_MODAL)
  return true
}

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

  // Native pull-to-refresh: MainViewController's UIRefreshControl (iOS) and MainActivity's
  // SwipeRefreshLayout (Android) both fire `eno:native-refresh` on pull; soft-refresh the current
  // route (re-fetch server components) — no full reload, so scroll + SPA state survive. No-op on
  // web (event never fires there).
  useEffect(() => {
    const onRefresh = () => {
      // Neither shell plays a haptic of its own (UIRefreshControl/SwipeRefreshLayout are silent),
      // so a pull that commits feels dead. Both platforms route through THIS one handler, so a
      // single light impact here covers both. hapticTap is reduced-motion-guarded + throttled.
      hapticTap()
      router.refresh()
    }
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

    // Perf Phase 1 — REVEAL FIRST: the splash hide must never wait on the keyboard/app
    // plugin imports (they're enhancements, not paint prerequisites). One tiny import,
    // hide the instant the web app is painted, then wire everything else.
    void import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 }))
      .catch(() => {})

    // OS text-size (Dynamic Type / Android font scale) → the WebView. Owned by src/lib/native-text-zoom.
    // Imported DYNAMICALLY, inside the native-only branch, for the same reason every `@capacitor/*`
    // import in this file is: a static import would pull the native path into the web bundle. The
    // bundler caches the module, so the resume-time sync below re-uses the same chunk.
    const zoom = () => import('@/lib/native-text-zoom')
    void zoom().then((m) => m.initTextZoom()).catch(() => {})
    const syncZoom = () => { void zoom().then((m) => m.syncTextZoom()).catch(() => {}) }

    void (async () => {
      const [{ Keyboard }, { App }] = await Promise.all([
        import('@capacitor/keyboard'),
        import('@capacitor/app'),
      ])
      if (disposed) return
      const android = cap()?.getPlatform?.() === 'android'

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

      // Android hardware back: close an open overlay first (see backConsumedByOverlay — a back
      // press that walks the page out from under an open sheet is the single most un-native thing
      // a wrapped app does), then navigate back if we can, else background the app. minimizeApp
      // (moveTaskToBack) keeps the process warm — exitApp() would kill it and force a cold
      // reload of the remote WebView on the next launch.
      adopt(await App.addListener('backButton', ({ canGoBack }) => {
        const navigate = () => {
          if (canGoBack) window.history.back()
          else App.minimizeApp()
        }
        if (backConsumedByOverlay(navigate)) return
        navigate()
      }))

      // Resume. A wrapped web app that sits in the background for an hour comes back showing
      // whatever it rendered before — no native app does that. On foreground: re-read the OS text
      // size (the user may have changed Dynamic Type in Settings while away) and soft-refresh the
      // route so server data is current. router.refresh() is an RSC re-fetch, NOT a reload: scroll,
      // SPA state, composer text and open dialogs all survive. A hard reload here would be a
      // cold remote boot every time — exactly the "webby" feel we're removing.
      // ⚠️ isActive:false ≠ backgrounded. Capacitor maps it to willResignActive/onPause, which also
      // fire for a control-centre pull, a permission alert, an incoming-call banner, the share
      // sheet or the OAuth in-app browser. Refreshing on every one of those would spam the origin
      // and flash content mid-interaction — so gate on how long we were actually away.
      // Set whenever a deep link kicks off a FULL-PAGE navigation (see dispatch/routeDeepLink
      // below); the resume refresh stands down while one is in flight.
      let hardNavAt = 0
      // Wall-clock, deliberately: performance.now() stalls while the device sleeps, which is
      // exactly the interval being measured. `awayAt` is cleared once consumed, so a platform
      // that emits two isActive:true in a row can't double-refresh — that reset IS the debounce
      // (an additional min-gap floor would be unreachable: a second refresh needs another
      // full 30s background first).
      const AWAY_BEFORE_REFRESH_MS = 30_000
      let awayAt = 0
      adopt(await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) { awayAt = Date.now(); return }
        syncZoom() // cheap + idempotent: always re-sync, even when we skip the refresh
        // Same reasoning, one layer down: a configuration change (the user flipping the OS to
        // dark mode from the Settings app / control centre) can land while we're backgrounded,
        // where no matchMedia/orientation listener of ours is guaranteed to have run. Re-assert
        // on EVERY foregrounding, not just the ones that clear the refresh threshold below.
        reassertStatusBar()
        const now = Date.now()
        if (!awayAt || now - awayAt < AWAY_BEFORE_REFRESH_MS) return
        awayAt = 0
        // A deep link that arrived on this same foregrounding is already doing a full-page
        // navigation (OAuth callback / forum hop) — both platforms deliver appUrlOpen BEFORE
        // didBecomeActive/onResume, so the flag is set by the time we get here. Refreshing the
        // route we're about to leave would fetch a page nobody will see, and can flash the old
        // view mid-unload.
        if (now - hardNavAt < 5_000) return
        router.refresh()
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
            hardNavAt = Date.now()
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
          hardNavAt = Date.now()
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

  // Offline recovery target. When the remote load fails, Capacitor swaps the WebView to the local
  // errorPath page (capacitor/www/error.html) — and hands it NO information about what failed, so it
  // used to retry the site root: one dropped packet on a listing, a chat or a half-filled post
  // wizard and the user was dumped on the home feed. That page can't read eno.vn's storage either
  // (it runs on capacitor://localhost), so publish where we are through native Preferences, the one
  // store both origins share, and let it retry THAT.
  // Contract mirrors MainViewController.rememberURL (the iOS blank-page watchdog): pages only —
  // never /auth/* (a PKCE code is single-use, replaying it lands on an error) and never /api/*.
  // Skipping those deliberately LEAVES the previous good URL in place as the target.
  useEffect(() => {
    if (!isNative()) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const publish = () => {
      const { pathname: here, href } = window.location
      if (here.startsWith('/auth/') || here.startsWith('/api/')) return
      if (timer) clearTimeout(timer)
      // Debounced: a route change can settle through more than one pathname (redirects), and this
      // is a native bridge round-trip — no reason to pay for the intermediate steps.
      timer = setTimeout(() => {
        void import('@capacitor/preferences')
          .then(({ Preferences }) => {
            if (cancelled) return
            return Preferences.set({ key: LAST_URL_KEY, value: JSON.stringify({ u: href, t: Date.now() }) })
          })
          .catch(() => {})
      }, 500)
    }
    publish()
    // Re-stamp on every foregrounding: error.html only restores a RECENT location, and a long read
    // on one screen would otherwise age out of that window and silently fall back to the home feed.
    const onVisible = () => { if (document.visibilityState === 'visible') publish() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pathname]) // query-only changes don't re-stamp; the path is the part worth restoring

  // Status bar follows the in-app theme: dark text on the light card, light text on the dark card.
  // `resolved` is the dependency (theme flips re-run this); the style itself is computed from the
  // live `.dark` class inside wantedStatusBar, and a black takeover overrides it while open.
  useEffect(() => {
    applyStatusBar()
  }, [resolved])

  // …and re-assert it after anything that can revert it behind our back (see reassertStatusBar:
  // the bundled SystemBars plugin re-applies the OS scheme on every Android configuration change).
  // The three signals a configuration change surfaces in the WebView: an OS night-mode flip
  // (matchMedia), a rotation (orientationchange), and — belt and braces, since a change can also
  // land while we're backgrounded — a foregrounding, wired into the appStateChange listener above.
  useEffect(() => {
    if (!isNative()) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onConfig = () => reassertStatusBar()
    mq.addEventListener('change', onConfig)
    window.addEventListener('orientationchange', onConfig)
    return () => {
      mq.removeEventListener('change', onConfig)
      window.removeEventListener('orientationchange', onConfig)
    }
  }, [])

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
