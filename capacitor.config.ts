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
const LOCAL_SHELL = process.env.ENO_LOCAL_SHELL === '1'

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
      launchShowDuration: 3000,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    Keyboard: {
      // Don't let Capacitor resize the WebView — our use-virtual-keyboard hook already models the
      // iOS-overlay geometry via CSS vars, and the native Keyboard plugin feeds that same store.
      resize: KeyboardResize.None,
    },
  },
}

export default config
