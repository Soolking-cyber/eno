import UIKit
import WebKit
import Capacitor
import ObjectiveC.runtime

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
        // The private WKContentView that hosts text input only exists once the WebView has content,
        // so drop the keyboard accessory bar after the first load settles (and once more as a
        // backstop). Idempotent — object_setClass to the same subclass is a no-op.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.removeKeyboardAccessoryBar() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in self?.removeKeyboardAccessoryBar() }
        // UIKit does NOT call viewDidAppear on background→foreground, so the blank-page re-check
        // must hang off the app lifecycle. Foregrounding is also when a killed web process comes
        // back — a fresh WKContentView without our runtime subclass — so re-apply the accessory
        // removal too.
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.scheduleWatchdog(after: 1.5)
            self?.removeKeyboardAccessoryBar()
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

    /// Remove the keyboard input-accessory bar (the gray "Done / ‹ › / suggestions" toolbar above the
    /// keyboard) — a dead giveaway of a WebView; native text fields don't show it. WebKit's text input
    /// lives in a private WKContentView; we give that instance a runtime subclass whose
    /// `inputAccessoryView` returns nil. Best-effort + reversible: if WebKit's internals ever change,
    /// the guard just no-ops (typing is unaffected — this only nils the ACCESSORY, not the input).
    private func removeKeyboardAccessoryBar() {
        guard let wv = webView,
              let contentView = wv.scrollView.subviews.first(where: {
                  String(describing: type(of: $0)).hasPrefix("WKContentView")
              }) else { return }
        let className = "eno_WKContentViewNoAccessory"
        if let existing = NSClassFromString(className) {
            object_setClass(contentView, existing)
            return
        }
        guard let baseClass = object_getClass(contentView),
              let subclass = objc_allocateClassPair(baseClass, className, 0) else { return }
        let sel = NSSelectorFromString("inputAccessoryView")
        let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let imp = imp_implementationWithBlock(block)
        if let method = class_getInstanceMethod(baseClass, sel), let enc = method_getTypeEncoding(method) {
            class_addMethod(subclass, sel, imp, enc)
        } else {
            class_addMethod(subclass, sel, imp, "@@:") // id (^)(id, SEL)
        }
        objc_registerClassPair(subclass)
        object_setClass(contentView, subclass)
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
        // A committed page has a non-nil URL → healthy; reset the counter and stop watching.
        if wv.url != nil { reloadAttempts = 0; return }
        // Still fetching the first response → give it more time.
        if wv.isLoading { scheduleWatchdog(after: 2.0); return }
        // Blank: no URL and not loading → the provisional load failed. Reload from the server URL.
        guard reloadAttempts < 6 else { return }
        reloadAttempts += 1
        if let serverURL = bridge?.config.serverURL {
            _ = wv.load(URLRequest(url: serverURL))
        } else {
            wv.reload()
        }
        scheduleWatchdog(after: min(2.0 + Double(reloadAttempts), 6.0))
    }
}
