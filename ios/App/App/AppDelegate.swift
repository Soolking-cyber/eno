import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Home-screen quick action that cold-launched the app, held until the bridge exists.
    private var launchShortcutItem: UIApplicationShortcutItem?

    // MARK: - Deep-link origins
    //
    // ⛔ THE APP RENDERS https://eno.vn — THE LICENSED MARKETPLACE — AND NOTHING ELSE (owner,
    // 2026-10-06: "ship both with eno.vn"; the Android shell moves back in the same release). This
    // reverses the www.eno.forum origin of c7fa473f1 (which mirrored Android's 11f430d12). The App
    // Store seller is the licensed eno.vn company, which may not offer the services that live only on
    // eno.forum, so no eno.forum page may render in this app. capacitor.config.ts `server.url` is
    // https://eno.vn and no forum host is in `allowNavigation`: Capacitor hands a forum URL to Safari,
    // which is exactly what a forum link should do.
    //
    // `appHosts` = the origin the WebView renders (server.url). ON THIS DOMAIN THE APEX IS CANONICAL —
    // the opposite of the forum: www.eno.vn answers 308 → https://eno.vn for every path (next.config.ts
    // redirects), and the marketplace build bakes NEXT_PUBLIC_APP_URL = https://eno.vn. A native load
    // always targets `appOrigin`, never the www.
    // `firstPartyHosts` = the hosts whose links this app opens: the apex plus its www alias, whose path,
    // query and fragment are opened on `appOrigin`.
    // ⛔ eno.forum / www.eno.forum are in NEITHER set, on purpose. The app claims no forum domain, so a
    // forum link can only arrive as `enovn://open?url=`; resolveFirstPartyTarget refuses it and it goes
    // to Capacitor untouched (.webJS) — nothing in this file can load a forum page into the WebView.
    private static let appHosts: Set<String> = ["eno.vn"]
    private static let firstPartyHosts: Set<String> = appHosts.union(["www.eno.vn"])
    /// Must stay byte-identical to `server.url` in capacitor.config.ts.
    private static let appOrigin = "https://eno.vn"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            // Cold launch from a quick action. The Capacitor bridge (and the App plugin's
            // capacitorOpenURL observer) doesn't exist yet, so forwarding now would post into the
            // void. Stash the item and return false — the documented way to tell UIKit NOT to also
            // call performActionFor for this same item — then forward from didBecomeActive, which
            // runs after the storyboard root VC's view (and thus the bridge) is set up. The App
            // plugin relays with retainUntilConsumed, so the event survives until the web app's
            // appUrlOpen listener attaches.
            launchShortcutItem = shortcutItem
            return false
        }
        return true
    }

    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        // Warm path: app already running, bridge alive — forward immediately.
        completionHandler(forward(shortcutItem: shortcutItem))
    }

    /// Translate a quick action into the shared deep-link scheme (enovn://open?path=…) and deliver it
    /// the same way every other deep link is delivered (see `deliver(_:options:)`).
    @discardableResult
    private func forward(shortcutItem: UIApplicationShortcutItem) -> Bool {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        guard let path = shortcutItem.userInfo?["path"] as? String,
              let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: "enovn://open?path=" + encoded) else { return false }
        return deliver(url, options: [:])
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        if let shortcutItem = launchShortcutItem {
            launchShortcutItem = nil
            forward(shortcutItem: shortcutItem)
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // MARK: - Remote notification registration (Capacitor push)
    //
    // ⚠️ These two callbacks are the ONLY emitters of the NotificationCenter posts Capacitor's
    // PushNotificationsPlugin observes (capacitorDidRegisterForRemoteNotifications /
    // …DidFailToRegister). This file is a HAND-WRITTEN AppDelegate (for the deep-link/shortcut
    // logic) that fully replaces the Capacitor template — and dropping them silently defeats push:
    // register() would reject with "event capacitorDidRegisterForRemoteNotifications not called" and
    // the JS `registration` listener (native-push.tsx) would never fire, so no device token is ever
    // POSTed. Re-added here so push works the moment the aps-environment entitlement + APNs config +
    // NEXT_PUBLIC_NATIVE_PUSH_IOS=1 are turned on, with no further native code change.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app is opened with a URL in its custom scheme: enovn://open?path= (quick
        // actions), enovn://open?url=, and the enovn://auth-callback OAuth return. Universal links
        // (applinks:eno.vn) never arrive here — they come through `continue userActivity` below.
        return deliver(url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links: https://eno.vn
        // links, once the box serves /.well-known/apple-app-site-association (APPLE_TEAM_ID in
        // eno-vn.env; App.entitlements claims applinks:eno.vn and nothing else). Same delivery as
        // `open url`.
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let incoming = userActivity.webpageURL,
           case .native(let target) = route(for: incoming) {
            loadInWebView(target)
            return true
        }
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Origin-agnostic deep-link delivery

    /// How an incoming link should be delivered.
    private enum DeepLinkRoute {
        /// Hand to Capacitor — the document in the WebView routes this itself (SPA nav, no reload).
        case webJS
        /// No JS on the current origin will act on it: navigate the WebView ourselves.
        case native(URL)
    }

    /// The Capacitor WebView, if the shell is up. `nil` (e.g. before the storyboard root VC exists)
    /// deliberately falls back to the old proxy-only behaviour rather than guessing.
    private var bridgeWebView: WKWebView? {
        (window?.rootViewController as? CAPBridgeViewController)?.webView
    }

    @discardableResult
    private func deliver(_ url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) -> Bool {
        switch route(for: url) {
        case .native(let target):
            loadInWebView(target)
            // Deliberately NOT also forwarded to ApplicationDelegateProxy: the App plugin posts
            // appUrlOpen with retainUntilConsumed, so a link we already acted on would be queued
            // and replayed the next time a page registers a listener — one tap, two navigations.
            // Not updating the proxy's `lastURL` is wanted for the same reason (App.getLaunchUrl
            // must keep returning the LAUNCH url, not a warm link we have already consumed).
            return true
        case .webJS:
            return ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: options)
        }
    }

    private func loadInWebView(_ target: URL) {
        // `target` is always a first-party https URL by construction (resolveFirstPartyTarget) —
        // an external app must never be able to point this WebView anywhere else, because
        // allowNavigation origins get the full Capacitor bridge injected.
        bridgeWebView?.load(URLRequest(url: target))
    }

    private func route(for url: URL) -> DeepLinkRoute {
        // Shapes we don't own (enovn://auth-callback, an eno.forum link, anything third-party) always
        // go to Capacitor untouched — the OAuth return in particular must finish in the JS that
        // started it, and a forum link must never be loaded into this WebView from here.
        guard let target = Self.resolveFirstPartyTarget(url) else { return .webJS }
        guard let webView = bridgeWebView else { return .webJS }
        // Nothing committed yet = cold start. Capacitor retains appUrlOpen until the web app's
        // listener attaches, and the boot path (App.getLaunchUrl + a sessionStorage once-guard)
        // already consumes it; stepping in here would race the initial load.
        guard let current = webView.url else { return .webJS }

        // The app's own origin: native-bootstrap (src/components/native/native-bootstrap.tsx
        // routeDeepLink) handles EVERY shape there — eno.vn https links (apex and www, incl.
        // universal links), `enovn://open?path=` and `enovn://open?url=` — and routes them in-SPA,
        // which a native load would downgrade to a full page fetch. Leave it alone.
        if current.scheme?.lowercased() == "https", let host = current.host?.lowercased(),
           Self.appHosts.contains(host) {
            return .webJS
        }
        // Everything else (the local offline page, the instant shell, about:blank, an unknown
        // origin) has no deep-link listener at all: navigate the WebView to the target on the
        // app's own origin.
        return .native(target)
    }

    // MARK: - Link → https target on the app's own origin
    //
    // Mirrors the web contract (src/lib/deep-link.ts canonicalAppPath + native-bootstrap's
    // routeDeepLink): canonicalize, then validate, and refuse anything that isn't first-party.
    // ⛔ THE RESULT IS ALWAYS ON `appOrigin`. A www.eno.vn link keeps its path, query and fragment
    // and moves onto https://eno.vn — the only origin this WebView renders. (Returning a URL on a host
    // outside allowNavigation is what once sent the quick actions to Safari — c7fa473f1.) A forum
    // URL is never first-party here, so no link shape can load an eno.forum page into this WebView.

    private static func resolveFirstPartyTarget(_ url: URL, depth: Int = 0) -> URL? {
        guard depth <= 1, let scheme = url.scheme?.lowercased() else { return nil }

        if scheme == "https" {
            // No userinfo, EVER. `https://evil.example\@eno.vn/` parses to host "eno.vn" in
            // Foundation (verified), because Foundation percent-encodes the backslash and then
            // reads everything before the `@` as credentials — while WebKit/Chromium treat a raw
            // `\` as an authority terminator, i.e. host "evil.example". Refusing the whole
            // userinfo form kills that trusted-origin escape without depending on either parser,
            // and no legitimate eno deep link carries credentials.
            guard url.user == nil, url.password == nil else { return nil }
            // An explicit port is a DIFFERENT origin than the one we trust; no eno link has one.
            guard url.port == nil else { return nil }
            guard let host = url.host?.lowercased(), firstPartyHosts.contains(host) else { return nil }
            guard isRoutablePath(url.path) else { return nil }
            return onAppOrigin(url)
        }

        guard scheme == "enovn", url.host == "open",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }

        // ?url=<absolute first-party https url> — cross-surface links. https only, and resolved
        // exactly once: no enovn-in-enovn nesting (unbounded recursion).
        if let absolute = items.first(where: { $0.name == "url" })?.value {
            // Checked on the still-raw string: URL(string:) would percent-encode a backslash or a
            // stray tab out of sight, and those are exactly the characters WebKit re-reads as
            // authority terminators (see the userinfo note above).
            guard absolute.hasPrefix("https://"), !hasParserSplitChars(absolute),
                  let nested = URL(string: absolute) else { return nil }
            return resolveFirstPartyTarget(nested, depth: depth + 1)
        }
        // ?path=<app path> (queryItems already percent-decodes once, like searchParams.get).
        guard let path = items.first(where: { $0.name == "path" })?.value else { return nil }
        return appURL(forPath: path)
    }

    /// The same path, query and fragment on `appOrigin`. Rebuilt from the already-validated
    /// components rather than string-spliced, so nothing the incoming host carried (it was checked
    /// to be first-party, port-less and userinfo-less) can leak into the new authority.
    private static func onAppOrigin(_ url: URL) -> URL? {
        guard let source = URLComponents(url: url, resolvingAgainstBaseURL: false),
              var target = URLComponents(string: appOrigin) else { return nil }
        target.percentEncodedPath = source.percentEncodedPath.isEmpty ? "/" : source.percentEncodedPath
        target.percentEncodedQuery = source.percentEncodedQuery
        target.percentEncodedFragment = source.percentEncodedFragment
        guard let moved = target.url, moved.scheme?.lowercased() == "https",
              let host = moved.host?.lowercased(), appHosts.contains(host) else { return nil }
        return moved
    }

    private static func appURL(forPath raw: String) -> URL? {
        // `//evil.example` and `/\evil.example` are protocol-relative escapes: pasted after an
        // origin they resolve to a FOREIGN host. Reject rather than normalise.
        guard raw.hasPrefix("/"), !raw.hasPrefix("//"), !raw.hasPrefix("/\\") else { return nil }
        // ⚠️ queryItems DECODED this once, so a `%09` written in the link is a RAW TAB here.
        // Foundation happens to re-encode it before WKWebView sees it, but Chromium (the Android
        // half of the same contract) strips TAB/CR/LF before parsing, which would sail past the
        // /auth prefix check below. Keep the two platforms refusing the same inputs.
        guard !hasParserSplitChars(raw) else { return nil }
        let pathOnly = String(raw.prefix { $0 != "?" && $0 != "#" })
        guard isRoutablePath(pathOnly) else { return nil }
        let joined = appOrigin + raw
        // URL(string:) is strict (RFC 3986 since iOS 17); fall back to percent-encoding for paths
        // carrying raw spaces or non-ASCII (Vietnamese query text) rather than dropping the link.
        // `%` and `#` are added to the allowed set so an escape that is ALREADY encoded isn't
        // double-encoded and a fragment keeps its delimiter.
        let lenient = CharacterSet.urlFragmentAllowed.union(CharacterSet(charactersIn: "%#"))
        guard let url = URL(string: joined)
                ?? (joined.addingPercentEncoding(withAllowedCharacters: lenient).flatMap { URL(string: $0) })
        else { return nil }
        // Belt and braces: whatever that parsed to, it must still be the app's own origin.
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(),
              appHosts.contains(host) else { return nil }
        return url
    }

    /// Characters the WebView's own parser re-reads or strips (`\` terminates an authority; TAB/CR/LF
    /// are removed before parsing), and that Foundation/`android.net.Uri` do not treat the same way.
    private static func hasParserSplitChars(_ value: String) -> Bool {
        value.contains(where: { $0 == "\\" || $0 == "\t" || $0 == "\n" || $0 == "\r" })
    }

    /// Decode to a bounded fixpoint so double-encoded input can't slip past the prefix checks, then
    /// refuse backslash smuggling, dot-segment traversal and the auth routes (mirrors
    /// canonicalAppPath's blockAuthPaths — a crafted link must never be able to drive sign-in/OAuth).
    private static func isRoutablePath(_ rawPath: String) -> Bool {
        var probe = rawPath
        for _ in 0..<3 {
            guard let decoded = probe.removingPercentEncoding, decoded != probe else { break }
            probe = decoded
        }
        if hasParserSplitChars(probe) { return false }
        // `/a/../auth` reaches /auth once the network stack normalises it, but sails past a
        // `hasPrefix` test — the JS side never had this hole because `new URL()` normalises dot
        // segments before it checks. Nothing legitimate here has a `.` or `..` segment, so refuse
        // them rather than normalise a string we would then load un-normalised.
        if probe.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0 == "." || $0 == ".." }) {
            return false
        }
        let lower = probe.lowercased()
        return !(lower.hasPrefix("/auth") || lower.hasPrefix("/signin"))
    }
}
