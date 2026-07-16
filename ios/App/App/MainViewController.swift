import UIKit
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

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeFeel()
        scheduleWatchdog(after: 3.0)
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
    }

    // Re-check whenever the app returns to the foreground — the blank state is most visible on
    // relaunch, and a page that failed while backgrounded should recover on return.
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
