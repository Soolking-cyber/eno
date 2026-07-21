import UIKit
import WebKit
import Capacitor

/// Self-healing WebView shell for the REMOTE-SERVER build (the app loads https://eno.vn live).
///
/// Capacitor's default navigation handler does NOTHING useful on a failed provisional load unless an
/// `errorPathURL` is configured — so a dropped/aborted first request leaves a BLANK screen. The iOS
/// Simulator's virtualized HTTP/3 stack reproduces this on essentially every relaunch with
/// `NSURLErrorDomain -1005` (real devices hit the same on a transient network blip). This subclass
/// watches the WebView after each foregrounding and, if it committed no page, reloads it from the
/// server URL with a short backoff — so the app recovers itself instead of showing black.
class MainViewController: CAPBridgeViewController {
    private var reloadAttempts = 0
    private var watchdogGeneration = 0
    private let refreshControl = UIRefreshControl()
    private var foregroundObserver: NSObjectProtocol?
    /// Where the user actually was, so a blank-page recovery can put them back (see `reloadFromServer`).
    private var lastGoodURL: URL?
    private var urlObservation: NSKeyValueObservation?
    /// The origins this shell renders (mirrors `server.allowNavigation` in capacitor.config.ts).
    private static let firstPartyHosts: Set<String> = ["eno.vn", "www.eno.vn", "eno.forum", "www.eno.forum"]

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeFeel()
        scheduleWatchdog(after: 3.0)
        // UIKit does NOT call viewDidAppear on background→foreground, so the blank-page re-check
        // must hang off the app lifecycle.
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.scheduleWatchdog(after: 1.5)
        }
    }

    deinit {
        if let foregroundObserver {
            NotificationCenter.default.removeObserver(foregroundObserver)
        }
        urlObservation?.invalidate()
    }

    /// Make the WebView behave like a native iOS app instead of a page in a browser.
    private func configureNativeFeel() {
        guard let wv = webView else { return }
        // The #1 gesture iOS users expect: swipe from the left edge to go back (and right edge to go
        // forward), driven through the app's History-API routing. Turns the WebView's back/forward
        // into the system interactive-pop-gesture feel.
        wv.allowsBackForwardNavigationGestures = true
        // No Safari-style long-press link "peek/pop" preview — native apps don't reveal a web
        // preview card when you hold a link.
        wv.allowsLinkPreview = false
        // Tap the status bar to scroll the current view to the top (standard iOS behaviour).
        wv.scrollView.scrollsToTop = true
        // The page owns horizontal layout; never let the native scroll view rubber-band sideways
        // (that horizontal give is a dead giveaway of a WebView).
        wv.scrollView.alwaysBounceHorizontal = false
        wv.scrollView.bounces = true

        // Scroll the page to put the keyboard away. Until now there was NO dismissal gesture at all:
        // Capacitor's Keyboard plugin forces `hideFormAccessoryBar = YES` (Keyboard.m:187), so there
        // is no "Done" bar either — a long form could leave the user stuck behind a keyboard covering
        // half the screen with nothing to tap.
        //
        // ⚠️ `.onDrag`, NOT `.interactive`, and the reason is this app's keyboard bridge — do not
        // "upgrade" it. The web side models the keyboard geometry itself (CSS vars via
        // use-virtual-keyboard, fed by the plugin because config sets Keyboard resize:'none'), and
        // the plugin subscribes to UIKeyboardWill/DidShow + Will/DidHide ONLY — it explicitly REMOVES
        // the WebView's UIKeyboardWillChangeFrame observers (Keyboard.m:189-199). An `.interactive`
        // drag is reported almost entirely as a stream of ChangeFrame notifications, so nothing would
        // reach the web app while the finger moves: the keyboard would slide away under a layout
        // still holding its full bottom inset, and a drag that is aborted or dropped mid-way (a known
        // WKWebView weak spot, since the keyboard and the web content are in different processes)
        // would strand that inset with no event left to clear it. `.onDrag` fires once, at
        // willBeginDragging, and produces a clean UIKeyboardWillHide → `keyboardWillHide` →
        // setNativeKeyboard(false, 0), so the web layout and the keyboard animate together.
        //
        // Safe alongside the UIRefreshControl below: the two are driven by the same drag but neither
        // consumes it. The dismissal happens as dragging begins; the refresh control keeps tracking
        // the same finger and still commits if the pull passes its threshold.
        wv.scrollView.keyboardDismissMode = .onDrag

        // Native pull-to-refresh: a real UIRefreshControl on the WebView's scroll view (the native
        // spinner, not a web imitation). On pull we ask the web app to soft-refresh the current view
        // via an event it listens for (router.refresh(), see native-bootstrap) — no full reload, so
        // SPA state and scroll position survive. The web side needs top-overscroll enabled
        // (globals.css html.native-ios) for the control to be reachable.
        refreshControl.addTarget(self, action: #selector(handlePullRefresh), for: .valueChanged)
        wv.scrollView.refreshControl = refreshControl

        // Track where the user actually is, so the blank-page watchdog can restore THAT page rather
        // than teleporting them to the home feed (see reloadFromServer). WKWebView's `url` is
        // KVO-compliant and also updates on History-API pushState/replaceState, so this follows SPA
        // route changes too — and it needs no WKNavigationDelegate, which the Capacitor bridge owns.
        urlObservation = wv.observe(\.url, options: [.initial, .new]) { [weak self] observed, _ in
            self?.rememberURL(observed.url)
        }
    }

    /// Record a URL worth returning to. Deliberately narrow: only first-party https pages, never the
    /// local offline/error bundle (capacitor:// or file://), and never an auth callback — a PKCE code
    /// is single-use, so replaying `/auth/callback?code=…` after a crash would land on an error page
    /// instead of where the user was. Skipping those keeps the PREVIOUS good URL as the target.
    private func rememberURL(_ url: URL?) {
        guard let url,
              url.scheme == "https",
              let host = url.host?.lowercased(),
              Self.firstPartyHosts.contains(host) else { return }
        if url.path.hasPrefix("/auth/") || url.path.hasPrefix("/api/") { return }
        lastGoodURL = url
    }

    @objc private func handlePullRefresh() {
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('eno:native-refresh'))", completionHandler: nil)
        // The soft refresh is fast; end the spinner shortly after so it feels snappy, not sticky.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
            self?.refreshControl.endRefreshing()
        }
    }

    // First presentation only (foreground returns are covered by the didBecomeActive observer).
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        scheduleWatchdog(after: 1.5)
    }

    private func scheduleWatchdog(after delay: TimeInterval) {
        watchdogGeneration += 1
        let generation = watchdogGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, generation == self.watchdogGeneration else { return }
            self.recoverIfBlank()
        }
    }

    private func recoverIfBlank() {
        guard let wv = webView else { return }
        // Still fetching the first response → give it more time.
        if wv.isLoading { scheduleWatchdog(after: 2.0); return }
        // No URL and not loading → the provisional load failed. Reload from server.
        if wv.url == nil { reloadFromServer(); return }
        // URL present, but that alone is NOT proof of health (audit #92): when the
        // render process is jetsammed under memory pressure the WKWebView keeps a
        // stale non-nil url while showing a blank page. Capacitor owns the
        // navigationDelegate (so we can't add webContentProcessDidTerminate without
        // stomping the bridge) — instead probe the live process with a trivial JS
        // eval. A dead process makes the eval error; that IS the crash signal.
        wv.evaluateJavaScript("1") { [weak self] _, error in
            guard let self = self else { return }
            if error != nil { self.reloadFromServer() } else { self.reloadAttempts = 0 }
        }
    }

    private func reloadFromServer() {
        guard let wv = webView, reloadAttempts < 6 else { return }
        reloadAttempts += 1
        // Recover to WHERE THE USER WAS. Jetsam kills the web content process routinely while the
        // app is backgrounded, so this path fires in ordinary use — not just on a broken first load
        // — and reloading the site root would silently drop someone out of a half-written listing
        // back onto the home feed. After two failed attempts, stop trusting the deep URL (it may be
        // the thing that can't load) and fall back to the configured server root.
        let target = (reloadAttempts <= 2 ? lastGoodURL : nil) ?? bridge?.config.serverURL
        if let target {
            _ = wv.load(URLRequest(url: target))
        } else {
            wv.reload()
        }
        scheduleWatchdog(after: min(2.0 + Double(reloadAttempts), 6.0))
    }
}
