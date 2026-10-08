import { appleIosEnabled, SIGN_IN_PLUGIN } from './apple-signin'

/**
 * SIGN IN WITH APPLE'S FIRST FRAME IN THE iOS APP — the `native-siwa` class on <html> (plan §7.2).
 *
 * The sign-in form's providers are server-rendered, and the HTML is shared by the web, both apps and build 2 vs
 * build 3 of the iOS app, so the server cannot leave Google or Apple out per binary. The pre-paint head script in
 * src/app/[lang]/layout.tsx already marks the iOS app (`native native-ios`); this adds `native-siwa` when THIS
 * binary can offer native Sign in with Apple, and globals.css keys the two sign-in hooks off it:
 *   · `ios-nosiwa-hidden` — Google (under the gate `ios-hide-google`) and Apple stay hidden in the iOS app unless
 *     `native-siwa` is set, so build 2 never paints either, and build 3 paints both from the first frame;
 *   · `apple-native-only` — the Apple button the server renders while `web` is not in the flag shows only there.
 * It is the first-frame twin of `iosNativeAppleReady()` (src/lib/apple-signin.ts), keyed off the same two facts.
 *
 * ⚠️ WHY `isPluginAvailable` IS ALREADY TRUE AT DOCUMENT START. MainViewController.capacitorDidLoad registers the
 * plugin instance; Capacitor injects each plugin's JS header as a WKUserScript at `.atDocumentStart`
 * (CAPBridgeViewController.swift, CapacitorBridge.swift, JSExport.swift in @capacitor/ios 8.4.2), and
 * `isPluginAvailable` reads `Capacitor.Plugins`, which that header fills (native-bridge.js). So the head script —
 * a parser-blocking inline script — sees the plugin on the first frame.
 *
 * ⛔ DECIDED AT BUILD TIME, LIKE THE FLAG ITSELF. Without `ios` in NEXT_PUBLIC_APPLE_SIGNIN (the dark deploy) the
 * string is '' and the head script carries no Apple code at all, so `native-siwa` can never appear and
 * `ios-nosiwa-hidden` behaves exactly like the `ios-app-hidden` it replaced.
 * ⛔ ITS OWN try BLOCK: a throwing bridge call must cost only `native-siwa` (the email form shows — the safe side),
 * never the `native`/`native-ios` classes already set or the splash lift that follows it.
 * ⚠️ Spliced into the head script's TEMPLATE LITERAL, inside the native branch where `C` (window.Capacitor) and
 * `dc` (documentElement.classList) are in scope: no backslashes, no backticks, no `${`.
 */
export function nativeSiwaHeadJs(iosEnabled: boolean): string {
  if (!iosEnabled) return ''
  return (
    "try{if(C.getPlatform&&C.getPlatform()==='ios'&&C.isPluginAvailable&&C.isPluginAvailable(" +
    JSON.stringify(SIGN_IN_PLUGIN) +
    "))dc.add('native-siwa');}catch(e){}"
  )
}

/** The snippet for THIS build — what layout.tsx splices in. */
export const NATIVE_SIWA_JS = nativeSiwaHeadJs(appleIosEnabled())
