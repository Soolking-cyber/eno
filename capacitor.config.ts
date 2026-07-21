import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

// eno.vn is a server-driven Next.js app (128 API routes, SSR, auth callbacks) — it CANNOT be
// statically exported, so Capacitor runs in REMOTE-SERVER mode: the native WebView loads the live
// deployment (server.url) and the native plugins layer the polish on top. `webDir` is only a tiny
// offline fallback bundle; it is never the running app. See src/components/native/native-bootstrap.
// PHASE 2 · M1 (native-shell migration): with ENO_LOCAL_SHELL=1 at `cap copy` time the
// app boots the LOCAL instant shell (capacitor/www/index.html — skeleton in ~100ms,
// then forwards to the live site with the launch deep link). Without the flag, behavior
// is EXACTLY the pre-Phase-2 remote-server mode. Build variants:
//   remote (default):  npx cap copy ios
//   local shell:       ENO_LOCAL_SHELL=1 npx cap copy ios
//
// ⛔ THE FLAG IS iOS-ONLY, AND IT IS NOT A STYLE PREFERENCE — DO NOT MAKE IT THE DEFAULT.
// Dropping `server.url` is what lets Capacitor serve webDir, and on ANDROID that single change
// moves the bridge off the live site. Verified in @capacitor/android 8.x sources and confirmed
// by two external reviewers (GPT-5.6 + Gemini 3.1 Pro, 2026-07-21):
//   · Bridge.loadWebView() registers native-bridge.js with
//     `WebViewCompat.addDocumentStartJavaScript(webView, …, Collections.singleton(allowedOrigin))`,
//     where allowedOrigin is derived from `appUrl` — ONE origin, and only that one.
//   · `appUrl` is `server.url` when set (today: https://eno.vn ⇒ the live site IS the injection
//     origin). With no server.url it becomes `localUrl` = `<androidScheme>://<hostname>` =
//     https://localhost, i.e. the SHELL is the only origin that gets the bridge.
//   · On success that call sets `injector = null`, which also disables WebViewLocalServer's legacy
//     response-rewriting fallback. `allowNavigation` only permits navigation; it does not widen the
//     document-start origin set.
//   ⇒ After the shell's `location.replace('https://eno.vn/')`, the live document would have NO
//     `window.Capacitor` on Android: no splash hide, no keyboard geometry, no hardware-back
//     handling, no status-bar sync, no Preferences (which is also how error.html learns where to
//     put the user back), no deep links, no haptics/share/camera — and no `html.native` class, so
//     the safe-area CSS goes too. Every Wave 2–4 Android fix dies with it.
// iOS is unaffected: there the bridge is a WKUserScript on the WKUserContentController
// (forMainFrameOnly, no origin allowlist), so every main-frame document gets it.
//
// Hence the guard below rather than a wider default: opting in must name the platform, so a bare
// `cap sync` / `cap copy` (which copies BOTH platforms) can never silently produce an Android build
// whose bridge never reaches eno.vn.
const LOCAL_SHELL = process.env.ENO_LOCAL_SHELL === '1'
if (LOCAL_SHELL && !process.argv.includes('ios')) {
  throw new Error(
    'ENO_LOCAL_SHELL is iOS-ONLY: it drops server.url, and on Android that moves the Capacitor ' +
      'bridge injection origin off https://eno.vn, leaving the live site with no window.Capacitor. ' +
      'Name the platform explicitly, e.g. `ENO_LOCAL_SHELL=1 npx cap copy ios`.',
  )
}

const config: CapacitorConfig = {
  appId: 'vn.eno.app',
  appName: 'eno',
  webDir: 'capacitor/www',
  // The cross-origin app-mode signal — Android does not inject Capacitor into non-server origins,
  // so eno.forum detects the app via UA, server- and client-side.
  appendUserAgent: 'EnoNativeApp/1',
  server: {
    // The one URL the app renders (remote mode). For LOCAL native dev, override to your
    // machine's LAN IP (http://192.168.x.x:3100 + cleartext:true) — dev-only, never committed.
    // In LOCAL_SHELL mode `url` is omitted → Capacitor serves webDir, whose index.html
    // forwards to the live site after painting instantly.
    ...(LOCAL_SHELL ? {} : { url: 'https://eno.vn' }),
    cleartext: false,
    // First-party links stay in the WebView; everything else opens in the system browser.
    // First-party only — iOS injects the full Capacitor bridge into every allowNavigation origin,
    // so NEVER add third-party hosts.
    allowNavigation: ['eno.vn', 'www.eno.vn', 'eno.forum', 'www.eno.forum'],
    // If the remote load FAILS (offline / dropped connection), show a branded offline page from the
    // local webDir instead of a blank WebView. It auto-retries + offers a "Try again" button. The
    // MainViewController watchdog still backstops the pure-blank (-1005) case.
    errorPath: 'error.html',
  },
  ios: {
    // Edge-to-edge: the WebView runs under the status bar so the bg-card header fills behind it.
    // The web side pads the header by env(safe-area-inset-top) on native (see globals.css).
    contentInset: 'never',
    // ACCESSIBILITY, not a style preference — this is what makes text enlargement work on iPad.
    // Capacitor's default is `recommended`, which on a full-width iPad window WebKit resolves to
    // DESKTOP-class browsing (not unconditionally — iPad mini and a narrow Split View can still
    // land on mobile). In desktop content mode WebKit ignores an explicit
    // `-webkit-text-size-adjust` PERCENTAGE (WebKit bug 212122) — and that percentage is the one
    // and only mechanism src/lib/native-text-zoom.ts has. Note what that meant: the native read was
    // fine (TextZoom.getPreferred() is plain UIFont Swift and never cared about content mode), so
    // the app fetched an iPad user's Dynamic Type multiplier over the bridge and then silently
    // threw it away. Mobile mode makes the write land, and puts the iPad on the same footing as the
    // iPhone, where the viewport lock in keyboard-viewport-sync (maximum-scale=1) leaves text-zoom
    // as the app's ONLY text-size path. The official @capacitor/text-zoom README states the
    // requirement outright: "text-zoom plugin won't work on iPads unless `preferredContentMode`
    // configuration is set to `mobile`".
    //
    // iPHONE IS UNAFFECTED — there `recommended` already resolves to `.mobile`, so this is a strict
    // no-op on every iPhone (confirmed by both external reviewers, 2026-07-21).
    //
    // ⚠️ On iPad it changes more than text sizing, and that is accepted deliberately:
    //  · the UA reverts from the desktop-class "Macintosh; Intel Mac OS X…" spoof to the real
    //    "iPad; CPU OS…" string, and `navigator.platform` with it. Safe here: `appendUserAgent:
    //    'EnoNativeApp/1'` rides on applicationNameForUserAgent, which WebKit appends to whichever
    //    base UA it builds, so the forum SSO handoff gate (`ua.includes('EnoNativeApp')`) cannot
    //    break — and our own isIOS() helpers (lib/in-app-browser, lib/haptics) already match BOTH
    //    the iPad UA and the MacIntel+maxTouchPoints desktop-mode spelling.
    //  · the viewport POLICY changes: desktop class sizes itself from the window and shrink-to-fits
    //    on its own terms, mobile honours `width=device-width`. On a page as responsive as ours the
    //    resulting innerWidth may barely move — but it can, and iPad landscape sits past `lg`,
    //    where the bottom nav is `lg:hidden` and the desktop header takes over. Consistent with the
    //    standing "the app MIRRORS the web app" rule; still, look at an iPad in BOTH orientations
    //    and in Split View before shipping.
    //
    // ⚠️ NOT deliverable over the air. Unlike everything served from eno.vn, this is baked into the
    // native WKWebViewConfiguration at construction time: it needs `npx cap copy ios` (which
    // regenerates ios/App/App/capacitor.config.json) plus a native rebuild before any iPad sees it.
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      // native-bootstrap hides it the instant the web app paints (no white flash on a normal load).
      // But it's ALSO given a hard 4s auto-hide floor: if the remote load stalls or drops (e.g. a
      // lost connection), the splash must never freeze forever — after 4s we reveal the WebView so
      // it can show its own retry/offline state instead of a dead splash. Fast loads still hide
      // early via native-bootstrap; only a slow/failed load ever reaches the floor.
      launchAutoHide: true,
      // 3s (perf Phase 1, was 4s): native-bootstrap now hides the splash the moment
      // the page paints (decoupled from plugin imports), so this floor only matters
      // for stalled loads — 3s still comfortably clears a normal cold start, and the
      // MainViewController watchdog continues to backstop the pure-blank case.
      // LOCAL SHELL (owner A/B verdict 2026-07-20: "too glitchy — drop the logo
      // splash, boot straight into a content skeleton"): the disk skeleton paints
      // in ~100ms, so the splash doesn't hold AT ALL — 0 releases it immediately.
      launchShowDuration: LOCAL_SHELL ? 0 : 3000,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    Keyboard: {
      // Don't let Capacitor resize the WebView — our use-virtual-keyboard hook already models the
      // iOS-overlay geometry via CSS vars, and the native Keyboard plugin feeds that same store.
      resize: KeyboardResize.None,
    },
    PushNotifications: {
      // FOREGROUND presentation. Push is still DORMANT (no FCM/APNs config, no `cap sync` — see
      // NATIVE_PUSH_SETUP.md), so this changes nothing today; it exists so the FIRST push we ever
      // send behaves correctly instead of vanishing.
      //
      // Without this key the plugin swallows every foreground push on BOTH platforms:
      //  · iOS — PushNotificationsHandler.willPresent() returns `[]` when the config array is
      //    missing, i.e. an explicit "present nothing". A chat message that arrives while the user
      //    has the app open would show NOTHING at all.
      //  · Android — PushNotificationsPlugin.fireNotification() only builds + posts a system
      //    notification when this array contains 'alert' | 'banner' | 'list'. (The FCM SDK's
      //    auto-display only runs while the app is BACKGROUNDED, so with no config the foreground
      //    case is likewise silent.) The two paths are mutually exclusive on app state, so there is
      //    no double-post.
      //
      // 'banner' + 'list' rather than 'alert': they are the modern iOS spellings ('alert' is
      // deprecated there and simply expands to banner+list), and Android accepts either. `list`
      // is deliberate — a notification that arrives while you're in the app should still be
      // waiting in Notification Center afterwards, exactly like one that arrived backgrounded.
      // 'sound' — this is a 1:1 marketplace chat (offers, replies, dispute updates); a silent
      // banner is missable, and the payload already asks for the default sound.
      //
      // ⚠️ NOT 'badge', deliberately: (1) the APNs payload we send (src/lib/native-push.ts) carries
      // no `aps.badge`, so it would be inert; (2) badge is iOS-only; (3) nothing in the app ever
      // clears the icon badge (no setBadgeCount/removeAllDeliveredNotifications call exists), so
      // stamping a count on the icon of the app the user is CURRENTLY READING would leave a red
      // dot that outlives the unread state. The in-app bell + chat unread counts are the honest
      // foreground surface for counts. Note the plugin requests [.alert,.sound,.badge]
      // authorization regardless of this array, so adding badges later needs no re-prompt.
      presentationOptions: ['banner', 'list', 'sound'],
    },
  },
}

export default config
