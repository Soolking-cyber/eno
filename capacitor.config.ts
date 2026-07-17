import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

// eno.vn is a server-driven Next.js app (128 API routes, SSR, auth callbacks) — it CANNOT be
// statically exported, so Capacitor runs in REMOTE-SERVER mode: the native WebView loads the live
// deployment (server.url) and the native plugins layer the polish on top. `webDir` is only a tiny
// offline fallback bundle; it is never the running app. See src/components/native/native-bootstrap.
const config: CapacitorConfig = {
  appId: 'vn.eno.app',
  appName: 'eno',
  webDir: 'capacitor/www',
  server: {
    // The one URL the app renders. For LOCAL native dev, override to your machine's LAN IP
    // (http://192.168.x.x:3100 + cleartext:true) — a dev-only change, never committed.
    url: 'https://eno.vn',
    cleartext: false,
    // First-party links stay in the WebView; everything else opens in the system browser.
    allowNavigation: ['eno.vn', 'www.eno.vn'],
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
      launchShowDuration: 4000,
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
