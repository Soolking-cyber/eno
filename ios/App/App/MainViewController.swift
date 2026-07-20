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

        // Native pull-to-refresh: a real UIRefreshControl on the WebView's scroll view (the native
        // spinner, not a web imitation). On pull we ask the web app to soft-refresh the current view
        // via an event it listens for (router.refresh(), see native-bootstrap) — no full reload, so
        // SPA state and scroll position survive. The web side needs top-overscroll enabled
        // (globals.css html.native-ios) for the control to be reachable.
        refreshControl.addTarget(self, action: #selector(handlePullRefresh), for: .valueChanged)
        wv.scrollView.refreshControl = refreshControl
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
        if let serverURL = bridge?.config.serverURL {
            _ = wv.load(URLRequest(url: serverURL))
        } else {
            wv.reload()
        }
        scheduleWatchdog(after: min(2.0 + Double(reloadAttempts), 6.0))
    }
}
