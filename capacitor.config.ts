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
  },
  ios: {
    // Edge-to-edge: the WebView runs under the status bar so the bg-card header fills behind it.
    // The web side pads the header by env(safe-area-inset-top) on native (see globals.css).
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      // We hide it by hand once the web app has painted (native-bootstrap) — no white flash, no
      // premature reveal of a still-loading WebView.
      launchAutoHide: false,
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
