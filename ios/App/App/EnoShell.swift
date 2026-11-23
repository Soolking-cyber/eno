import UIKit
import WebKit
import CryptoKit

/// iOS 1.2 — native chrome over the web app (owner, 2026-11-23: "make ios app more native": a native tab bar, page transitions,
/// long-press previews, fast launch).
///
/// ⛔ THE APP STILL MIRRORS THE WEB (owner, 2026-07): nothing here re-implements a screen. The tab bar is a skin over the web's
/// own bottom nav, the transition moves pictures of the web's own pages, the long-press preview is a picture of the web's own
/// card, and the launch picture is the web's own home page from the last visit. The web side is src/components/native/
/// ios-shell-bridge.tsx; it reads `window.__enoShell` (the user script below), which no older binary sets.
final class EnoShell: NSObject {
    /// Set by AppDelegate before the first page loads: a launch from the icon, with no link, notification, shortcut or activity.
    static var plainLaunch = false

    static let userScript = "window.__enoShell={tabs:1,nav:1,menus:1};"
    static let appHosts: Set<String> = {
        var hosts: Set<String> = ["eno.vn", "www.eno.vn"]
        #if DEBUG
        if ProcessInfo.processInfo.environment["ENO_DEV_HOST"] != nil { hosts.insert("localhost") } // simulator only
        #endif
        return hosts
    }()

    private weak var host: UIViewController?
    private weak var webView: WKWebView?
    /// True while the age gate covers or blocks the site: nothing native may draw the page then.
    var isBlocked: () -> Bool = { false }

    let tabBar = UITabBar()
    private var tabLabels: [String] = []
    private var lastTabs: [String: Any]?
    private var tabsShown = false
    /// When the page last reported its nav. A page that never does (a script error, an error page) loses the native bar within
    /// a beat, and the web nav comes back (setTabBar takes `native-tabbar` off <html>).
    private var tabsHeardAt = Date.distantPast
    /// When the current document started loading: the bar stays only if THIS document has reported its nav at least once.
    private var documentStartedAt = Date()

    private var armed: (image: UIImage, at: Date, path: String)?
    /// Bumped by every commit: a snapshot that lands after the commit it was taken for must not arm a later one (review).
    private var navGeneration = 0
    private var loadingObservation: NSKeyValueObservation?
    private var animating = false

    private var launchCover: UIImageView?
    private var uiProxy: ContextMenuDelegate?

    init(host: UIViewController, webView: WKWebView) {
        self.host = host
        self.webView = webView
        super.init()
    }

    /// From capacitorDidLoad: BEFORE the first load, so the first document already has `__enoShell` and WebKit sees the menu
    /// delegate's methods when it is assigned.
    func installEarly() {
        guard let wv = webView else { return }
        let ucc = wv.configuration.userContentController
        ucc.addUserScript(WKUserScript(source: Self.userScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        for name in ["enoTabs", "enoNav", "enoPainted"] { ucc.add(WeakHandler(self), name: name) }
        if let inner = wv.uiDelegate {
            let proxy = ContextMenuDelegate(inner: inner, shell: self)
            uiProxy = proxy // the WebView holds its delegate WEAKLY
            wv.uiDelegate = proxy
        }
    }

    /// From viewDidLoad, after the WebView is configured.
    func installViews() {
        guard let view = host?.view else { return }
        // The menu delegate decides what a long-press shows (configureNativeFeel set this false just before).
        if uiProxy != nil { webView?.allowsLinkPreview = true }
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.isHidden = true
        view.addSubview(tabBar)
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        // The last visit's tabs, so the bar is there from the first frame; the web corrects it as soon as it posts.
        if let data = UserDefaults.standard.data(forKey: Self.tabsKey),
           let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            applyTabs(saved)
        }
        showLaunchCoverIfFresh()
        // The picture is taken while the app is still on screen (a backgrounded WebView can answer with a blank frame — review).
        NotificationCenter.default.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        // Every page that finishes loading must report its nav — including the first, and any full load into a page without
        // the bridge (an edge error page, the offline page): silence takes the bar down (review).
        expectTabs()
        loadingObservation = webView?.observe(\.isLoading, options: [.new]) { [weak self] wv, _ in
            let loading = wv.isLoading
            DispatchQueue.main.async {
                guard let self else { return }
                if loading { self.documentStartedAt = Date() } else { self.expectTabs() }
            }
        }
    }

    // MARK: Tab bar

    private static let tabsKey = "eno.shell.tabs"
    private static let symbols = ["safari", "heart", "plus.circle", "bubble.left.and.bubble.right", "person.crop.circle"]

    /// The tab's symbol by where it goes (review: never by position alone); a tab with no link yet (a guest's gated button)
    /// falls back to its place in the standard five.
    private static func symbol(href: String, index: Int, count: Int) -> String {
        let path = URL(string: href, relativeTo: URL(string: "https://eno.vn"))?.path ?? ""
        switch path {
        case "/", "/vi": return "safari"
        case "/saved": return "heart"
        case "/post": return "plus.circle"
        case "/messages": return "bubble.left.and.bubble.right"
        case let p where p.hasPrefix("/dashboard"): return "person.crop.circle"
        default: return count == symbols.count && index < symbols.count ? symbols[index] : "circle"
        }
    }

    private func applyTabs(_ body: [String: Any]) {
        let items = body["items"] as? [[String: Any]] ?? []
        let visible = (body["visible"] as? Bool ?? false) && !items.isEmpty
        let labels = items.map { ($0["label"] as? String ?? "") + "\u{1}" + ($0["href"] as? String ?? "") }
        if labels != tabLabels {
            tabLabels = labels
            tabBar.items = items.enumerated().map { i, raw in
                let label = raw["label"] as? String ?? ""
                let name = Self.symbol(href: raw["href"] as? String ?? "", index: i, count: items.count)
                let item = UITabBarItem(title: label, image: UIImage(systemName: name), selectedImage: UIImage(systemName: name + ".fill") ?? UIImage(systemName: name))
                item.tag = i
                return item
            }
        }
        for (i, raw) in items.enumerated() where i < (tabBar.items?.count ?? 0) {
            tabBar.items?[i].badgeValue = raw["badge"] as? String
        }
        if let active = items.firstIndex(where: { $0["active"] as? Bool == true }), let item = tabBar.items?[active] {
            tabBar.selectedItem = item
        } else {
            tabBar.selectedItem = nil
        }
        lastTabs = body
        setTabBar(visible: visible)
    }

    private func setTabBar(visible: Bool) {
        // ⛔ THE WEB NAV IS HIDDEN ONLY WHILE THIS BAR IS UP: the class that hides it follows the bar, both ways — an open sheet,
        // a page that stopped answering or any misread brings the web nav back instead of leaving no nav at all.
        webView?.evaluateJavaScript("document.documentElement.classList.toggle('native-tabbar',\(visible))", completionHandler: nil)
        guard visible != tabsShown else { return }
        tabsShown = visible
        if visible { tabBar.isHidden = false }
        let height = tabBar.bounds.height
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut], animations: {
            self.tabBar.transform = visible ? .identity : CGAffineTransform(translationX: 0, y: height)
        }, completion: { _ in
            if !self.tabsShown { self.tabBar.isHidden = true }
        })
    }

    /// A page has a few seconds after it loads (or paints) to report its nav at least once; a document that never has — an
    /// edge error page, the offline page, a broken script — cannot drive the bar, which goes. ⚠️ Measured from the DOCUMENT'S
    /// start, not from this call: the bridge posts only on change, so a page that reported during hydration, before its load
    /// event, is healthy and stays silent afterwards (review).
    private func expectTabs() {
        let document = documentStartedAt
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.documentStartedAt == document, self.tabsHeardAt < document else { return }
            self.setTabBar(visible: false)
        }
    }

    // MARK: Page transitions

    private var currentPath: String { webView?.url?.path ?? "" }

    /// A touch that may navigate: picture the page NOW, before anything can change under it.
    private func arm() {
        guard let wv = webView, !UIAccessibility.isReduceMotionEnabled, !isBlocked(), !animating else { return }
        let cfg = WKSnapshotConfiguration()
        cfg.afterScreenUpdates = false
        let at = Date()
        let path = currentPath
        let generation = navGeneration
        wv.takeSnapshot(with: cfg) { [weak self] image, _ in
            guard let self, let image, generation == self.navGeneration else { return }
            self.armed = (image, at, path)
        }
    }

    /// A commit slides only when it follows an arm by a beat, and only away from the armed page: forward, or back when a
    /// history step brought it (`pop`). The arm is spent either way, so a tap that navigated nowhere cannot slide a later,
    /// unrelated commit (a tab switch, a redirect).
    private func onNav(_ body: [String: Any]) {
        switch body["kind"] as? String {
        case "arm":
            arm()
        case "commit":
            defer { armed = nil; navGeneration += 1 }
            guard let a = armed, Date().timeIntervalSince(a.at) < 2.5,
                  let path = body["path"] as? String, path != a.path, !isBlocked() else { return }
            slide((body["pop"] as? Bool) == true ? "back" : "forward", from: a.image)
        default:
            break
        }
    }

    /// UINavigationController's push and pop: forward, the new page comes in from the right over the old one, which drifts a
    /// third left under a shade; back, the old page leaves to the right over the new. The WebView's scroll view moves — the
    /// WebView IS the controller's view (Capacitor), and the tab bar and covers on it must stay put.
    private func slide(_ dir: String, from image: UIImage) {
        guard let wv = webView, !animating else { return }
        animating = true
        let content = wv.scrollView
        let w = wv.bounds.width
        let old = UIImageView(image: image)
        old.frame = wv.bounds
        let shade = UIView(frame: wv.bounds)
        shade.backgroundColor = .black
        shade.isUserInteractionEnabled = false
        wv.isUserInteractionEnabled = false
        if dir == "back" {
            wv.insertSubview(shade, aboveSubview: content)
            wv.insertSubview(old, aboveSubview: shade)
            shade.alpha = 0.12
            content.transform = CGAffineTransform(translationX: -0.3 * w, y: 0)
        } else {
            wv.insertSubview(old, belowSubview: content)
            old.addSubview(shade)
            shade.alpha = 0
            content.transform = CGAffineTransform(translationX: w, y: 0)
        }
        let animator = UIViewPropertyAnimator(duration: 0.35, timingParameters: UISpringTimingParameters(dampingRatio: 1))
        animator.addAnimations {
            content.transform = .identity
            if dir == "back" {
                old.transform = CGAffineTransform(translationX: w, y: 0)
                shade.alpha = 0
            } else {
                old.transform = CGAffineTransform(translationX: -0.3 * w, y: 0)
                shade.alpha = 0.12
            }
        }
        animator.addCompletion { [weak self] _ in
            content.transform = .identity
            old.removeFromSuperview()
            shade.removeFromSuperview()
            wv.isUserInteractionEnabled = true
            self?.animating = false
        }
        animator.startAnimation()
    }

    // MARK: Fast launch

    private static let launchFile = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("eno-launch-home.jpg")
    private static let launchMetaKey = "eno.shell.launch"

    /// Leaving the app on the home page, at its top: keep a picture of it for the next cold launch from the icon.
    @objc private func willResignActive() {
        guard let wv = webView, !isBlocked(), ["/", "/vi"].contains(currentPath), wv.scrollView.contentOffset.y < 40 else { return }
        let style = host?.traitCollection.userInterfaceStyle == .dark ? "dark" : "light"
        let cfg = WKSnapshotConfiguration()
        cfg.afterScreenUpdates = false
        // Room to finish the cookie read, the picture and the write after the app leaves the screen (review).
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        let finish = { if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid } }
        // The picture FIRST, while the app is still on screen; the account read after (review: a fast swipe home).
        wv.takeSnapshot(with: cfg) { [weak self] image, _ in
            guard let self, let data = image?.jpegData(compressionQuality: 0.7) else { finish(); return }
            self.account { who in
                defer { finish() }
                do {
                    try data.write(to: Self.launchFile, options: [.atomic, .completeFileProtection])
                    UserDefaults.standard.set(["at": Date().timeIntervalSince1970, "style": style, "who": who], forKey: Self.launchMetaKey)
                } catch {
                    try? FileManager.default.removeItem(at: Self.launchFile)
                }
            }
        }
    }

    /// Only from the icon, only a picture under a day old, in the same light/dark appearance and the same signed-in state — so
    /// it never shows someone a home page that is no longer theirs. It goes at the page's first paint, after 3 s at most, or
    /// at once if the age gate closes.
    private func showLaunchCoverIfFresh() {
        guard Self.plainLaunch, !isBlocked(),
              let meta = UserDefaults.standard.dictionary(forKey: Self.launchMetaKey),
              let at = meta["at"] as? Double, Date().timeIntervalSince1970 - at < 86_400,
              let style = meta["style"] as? String, let was = meta["who"] as? String, was != "unknown",
              style == (host?.traitCollection.userInterfaceStyle == .dark ? "dark" : "light"),
              let data = try? Data(contentsOf: Self.launchFile), let image = UIImage(data: data),
              let wv = webView else { return }
        let cover = UIImageView(image: image)
        cover.frame = wv.bounds
        cover.contentMode = .scaleAspectFill
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // ⛔ A PICTURE IS NOT THE PAGE: it swallows touches (the live page under it may have moved since — a tap would open a
        // listing nobody saw), and a tap takes it away so the next one lands on the real page (review).
        cover.isUserInteractionEnabled = true
        cover.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(launchCoverTapped)))
        cover.alpha = 0
        wv.insertSubview(cover, belowSubview: tabBar)
        launchCover = cover
        account { [weak self] now in
            guard let self, self.launchCover === cover else { return }
            if now == was && now != "unknown" && !self.isBlocked() { cover.alpha = 1 } else { self.dropLaunchCover() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.dropLaunchCover() }
    }

    @objc private func launchCoverTapped() { dropLaunchCover() }

    func dropLaunchCover() {
        guard let cover = launchCover else { return }
        launchCover = nil
        UIView.animate(withDuration: 0.2, animations: { cover.alpha = 0 }, completion: { _ in cover.removeFromSuperview() })
    }

    /// WHO is signed in, as a one-way hash — "guest" without a session — so the launch picture is only ever shown to the same
    /// account it was taken for (review: a sign-out and someone else's sign-in within the day). Read on the device from the
    /// app's own session cookie (Supabase's `sb-…-auth-token`, possibly chunked `.0`, `.1`, …; the same parse the head script
    /// does), never stored or sent anywhere but as this hash in the app's own defaults.
    /// The session cookie by its EXACT name — supabase-js's storage key for https://sb.eno.vn (src/lib/supabase/
    /// session-cookie.ts; a test pins the two together) — or its chunks `.0`, `.1`, … in NUMERIC order. Never a lookalike
    /// such as `…-auth-token-code-verifier` (review).
    static let sessionCookie = "sb-sb-auth-token"

    private func account(_ done: @escaping (String) -> Void) {
        guard let store = webView?.configuration.websiteDataStore.httpCookieStore else { done("unknown"); return }
        store.getAllCookies { cookies in
            func chunk(_ name: String) -> Int? {
                if name == Self.sessionCookie { return -1 }
                guard name.hasPrefix(Self.sessionCookie + "."), let n = Int(name.dropFirst(Self.sessionCookie.count + 1)) else { return nil }
                return n
            }
            let parts = cookies
                .filter { Self.appHosts.contains($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
                .compactMap { c in chunk(c.name).map { (n: $0, value: c.value) } }
                .sorted { $0.n < $1.n }
            // A whole cookie wins over chunks, as supabase-js reads it.
            var raw = parts.first(where: { $0.n == -1 })?.value ?? parts.filter { $0.n >= 0 }.map(\.value).joined()
            if raw.hasPrefix("base64-") { raw = String(raw.dropFirst(7)) }
            raw = raw.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            while raw.count % 4 != 0 { raw += "=" }
            // ⛔ "unknown" (a session we cannot read) NEVER matches anything, itself included (showLaunchCoverIfFresh): a
            // picture is shown only to a reader we can positively say is the same — a guest, or the same account (review).
            var who = parts.isEmpty ? "guest" : "unknown"
            if let data = Data(base64Encoded: raw),
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let user = json["user"] as? [String: Any], let id = user["id"] as? String, !id.isEmpty {
                who = SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
            }
            DispatchQueue.main.async { done(who) }
        }
    }

    // MARK: Long-press previews

    fileprivate struct Card {
        let rect: CGRect
        let url: URL
        let title: String
        let saved: Bool?
        let save: String
        let share: String
        let copy: String
    }

    fileprivate func isListing(_ url: URL) -> Bool {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), Self.appHosts.contains(url.host?.lowercased() ?? "") else { return false }
        let parts = url.path.split(separator: "/")
        return parts.count == 2 && parts[0] == "listings"
    }

    fileprivate func cardMenu(for url: URL, completion: @escaping (UIContextMenuConfiguration?) -> Void) {
        guard let wv = webView, !isBlocked() else { completion(nil); return }
        wv.evaluateJavaScript("JSON.stringify(window.__enoCardAt ? window.__enoCardAt() : null)") { [weak self] result, _ in
            guard let self else { completion(nil); return }
            guard let json = result as? String, let data = json.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let r = o["rect"] as? [String: Double], let href = o["href"] as? String, let cardURL = URL(string: href),
                  cardURL.path == url.path else { self.plainMenu(for: url, completion: completion); return }
            let labels = o["labels"] as? [String: String] ?? [:]
            let card = Card(rect: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["width"] ?? 0, height: r["height"] ?? 0),
                            url: cardURL, title: o["title"] as? String ?? "", saved: o["saved"] as? Bool,
                            save: labels["save"] ?? "", share: labels["share"] ?? "Share", copy: labels["copy"] ?? "Copy link")
            let cfg = WKSnapshotConfiguration()
            cfg.rect = card.rect.intersection(wv.bounds)
            cfg.afterScreenUpdates = false
            wv.takeSnapshot(with: cfg) { image, _ in
                completion(self.configuration(card, image: image))
            }
        }
    }

    /// No card under the finger to picture (a listing link outside a card, or the page did not answer): still the actions,
    /// in the page's words, with WebKit's own lift of the link as the preview.
    private func plainMenu(for url: URL, completion: @escaping (UIContextMenuConfiguration?) -> Void) {
        webView?.evaluateJavaScript("JSON.stringify(window.__enoMenuWords ? window.__enoMenuWords() : null)") { [weak self] result, _ in
            guard let self, let json = result as? String, let data = json.data(using: .utf8),
                  let words = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
                  let share = words["share"], let copy = words["copy"], !share.isEmpty else { completion(nil); return }
            let card = Card(rect: .zero, url: url, title: "", saved: nil, save: "", share: share, copy: copy)
            completion(self.configuration(card, image: nil))
        }
    }

    private func configuration(_ card: Card, image: UIImage?) -> UIContextMenuConfiguration {
        UIContextMenuConfiguration(identifier: card.url.absoluteString as NSString, previewProvider: {
            guard let image else { return nil }
            return CardPreviewController(image: image)
        }, actionProvider: { [weak self] _ in
            guard let self else { return nil }
            var actions: [UIMenuElement] = []
            if let saved = card.saved, !card.save.isEmpty {
                actions.append(UIAction(title: card.save, image: UIImage(systemName: saved ? "heart.fill" : "heart")) { _ in self.cardAction("save", card) })
            }
            actions.append(UIAction(title: card.share, image: UIImage(systemName: "square.and.arrow.up")) { _ in self.share(card) })
            actions.append(UIAction(title: card.copy, image: UIImage(systemName: "link")) { _ in UIPasteboard.general.url = card.url })
            return UIMenu(title: card.title, children: actions)
        })
    }

    fileprivate func open(_ url: URL) {
        cardAction("open", Card(rect: .zero, url: url, title: "", saved: nil, save: "", share: "", copy: ""))
    }

    private func cardAction(_ action: String, _ card: Card) {
        let detail = ["action": action, "href": card.url.absoluteString]
        guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('eno:native-card',{detail:\(json)}))", completionHandler: nil)
    }

    private func share(_ card: Card) {
        guard let host else { return }
        let sheet = UIActivityViewController(activityItems: [card.url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = host.view
        host.present(sheet, animated: true)
    }
}

// MARK: - Web → shell messages

extension EnoShell: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // ⛔ THE APP'S OWN PAGE ONLY: script message handlers answer every frame, and an embed (a video, a map, a challenge)
        // must never drive the native bar or the transitions (review).
        guard message.frameInfo.isMainFrame, Self.appHosts.contains(message.frameInfo.securityOrigin.host.lowercased()) else { return }
        switch message.name {
        case "enoTabs":
            guard let body = message.body as? [String: Any] else { return }
            tabsHeardAt = Date()
            applyTabs(body)
            // Saved for the next launch WITHOUT badges: a count belongs to whoever is signed in when the page next reports.
            var keep = body
            keep["items"] = (body["items"] as? [[String: Any]])?.map { var i = $0; i["badge"] = nil; return i }
            if let data = try? JSONSerialization.data(withJSONObject: keep) { UserDefaults.standard.set(data, forKey: Self.tabsKey) }
        case "enoNav":
            if let body = message.body as? [String: Any] { onNav(body) }
        case "enoPainted":
            dropLaunchCover()
            expectTabs()
        default:
            break
        }
    }
}

extension EnoShell: UITabBarDelegate {
    /// A native tap clicks the web's own tab (its gates, sign-in notes and tap-again-to-top stay the web's), then puts the
    /// selection back to what the web reports — a guest's tap on Messages opens a sign-in note, not the tab.
    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        UISelectionFeedbackGenerator().selectionChanged()
        let detail: [String: Any] = ["index": item.tag, "label": item.title ?? ""]
        if let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) {
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('eno:native-tab',{detail:\(json)}))", completionHandler: nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, let last = self.lastTabs else { return }
            self.applyTabs(last)
        }
    }
}

// MARK: - Helpers

private final class WeakHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// The card, as the page drew it, at its own size.
private final class CardPreviewController: UIViewController {
    private let image: UIImage
    init(image: UIImage) {
        self.image = image
        super.init(nibName: nil, bundle: nil)
        preferredContentSize = image.size
    }
    required init?(coder: NSCoder) { nil }
    override func loadView() {
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        self.view = view
    }
}

/// Forwards every WKUIDelegate message to Capacitor's handler, and answers the long-press menu itself: a listing card gets the
/// native preview and actions; ⛔ every other link gets NO menu (the app had `allowsLinkPreview = false` until 1.2 — an empty
/// configuration keeps that, where nil would bring up WebKit's own Safari-style preview).
private final class ContextMenuDelegate: NSObject, WKUIDelegate {
    private let inner: WKUIDelegate
    private weak var shell: EnoShell?
    private static let none = UIContextMenuConfiguration(identifier: nil, previewProvider: nil, actionProvider: nil)

    init(inner: WKUIDelegate, shell: EnoShell) {
        self.inner = inner
        self.shell = shell
        super.init()
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        inner.responds(to: aSelector) ? inner : super.forwardingTarget(for: aSelector)
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || inner.responds(to: aSelector)
    }

    func webView(_ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo, completionHandler: @escaping (UIContextMenuConfiguration?) -> Void) {
        guard let shell, let url = elementInfo.linkURL, shell.isListing(url) else { completionHandler(Self.none); return }
        shell.cardMenu(for: url) { config in completionHandler(config ?? Self.none) }
    }

    /// Tapping the preview opens the listing, as the card itself would.
    func webView(_ webView: WKWebView, contextMenuForElement elementInfo: WKContextMenuElementInfo, willCommitWithAnimator animator: UIContextMenuInteractionCommitAnimating) {
        guard let shell, let url = elementInfo.linkURL, shell.isListing(url) else { return }
        animator.addCompletion { shell.open(url) }
    }
}
