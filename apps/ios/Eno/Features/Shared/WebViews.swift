import SwiftUI
import WebKit
import UIKit

// The hybrid escape hatch: any surface that isn't native yet renders the REAL
// web app inside the native shell — full fidelity, zero divergence, replaced
// screen-by-screen as the rewrite lands. Two forms: a tab embed (WebTabView)
// and a modal sheet (WebSheet, used by native screens for web-only flows).
//
// Auth bridge (#117): the page's auth-context posts the Supabase session to
// webkit.messageHandlers.enoAuth on sign-in (and "signout" on explicit
// sign-out) when it detects the EnoNativeTabs UA — ONE sign-in flow; the
// native shell adopts the tokens into the Keychain. Guest page loads post
// nothing, so an existing native session is never clobbered by a fresh tab.

private struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.userContentController.add(context.coordinator, name: "enoAuth")
        // EnoNativeApp/1 = first-party app signal (forum origin + SSO handoff key on
        // it); EnoNativeTabs/1 = "embedded tab inside the native TabView" — eno.vn
        // hides its own bottom nav and the Google OAuth button on this marker.
        // Public API (audit #10): applicationNameForUserAgent is APPENDED to the
        // default UA — replaces the private KVC read of "userAgent" (App-Review risk).
        cfg.applicationNameForUserAgent = "EnoNativeApp/1 EnoNativeTabs/1"
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .automatic
        web.navigationDelegate = context.coordinator
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    // WKUserContentController retains its handlers strongly — without this,
    // every dismissed sheet/tab leaks the WKWebView + Coordinator pair.
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "enoAuth")
        web.stopLoading()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        // Navigation policy (audit #10): keep only first-party https://eno.vn in
        // the embedded WebView; hand external http(s) links to Safari; route
        // mailto/tel/etc. to the system; block anything else. The /signin OTP
        // flow that feeds the enoAuth bridge stays on eno.vn, so it is allowed.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
                decisionHandler(.cancel); return
            }
            if scheme == "https" || scheme == "http" {
                // ⚠️ A NIL HOST FAILS CLOSED — it goes to the system browser, never stays in the
                // WebView. Binding inside the `if` is what guarantees that: an optional compared
                // loosely would let an unexpected URL shape be treated as our own origin.
                if let host = url.host?.lowercased(), Edition.ownHosts.contains(host) {
                    decisionHandler(.allow)
                } else {
                    UIApplication.shared.open(url)     // external site → system browser
                    decisionHandler(.cancel)
                }
            } else if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)          // mailto:/tel:/sms: → system
                decisionHandler(.cancel)
            } else {
                decisionHandler(.cancel)                // unknown/custom scheme → block
            }
        }

        // Blank-on-memory-pressure self-heal: the render process can be jetsammed,
        // leaving a white page. Reload rather than sit blank (audit #10).
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "enoAuth" else { return }
            // SECURITY (review #1): the handler is exposed to EVERY frame of every
            // page this WebView ever loads. Only the main frame of https://eno.vn
            // may hand us a session — a cross-origin iframe or a followed link
            // could otherwise plant its own tokens (session fixation/hijack).
            // securityOrigin, not request.url — the URL can be nil/about:blank.
            guard message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.protocol == "https",
                  Edition.ownHosts.contains(message.frameInfo.securityOrigin.host) else { return }
            let body = message.body
            Task { @MainActor in
                if let dict = body as? [String: Any],
                   let access = dict["access_token"] as? String,
                   let refresh = dict["refresh_token"] as? String {
                    AuthModel.shared.adopt(accessToken: access, refreshToken: refresh)
                } else if let s = body as? String, s == "signout" {
                    AuthModel.shared.signOut()
                }
            }
        }
    }
}

struct WebTabView: View {
    let path: String
    let title: String

    var body: some View {
        WebView(url: URL(string: "https://eno.vn")!.appending(path: path))
            .ignoresSafeArea(edges: .bottom)
    }
}

struct WebSheet: View {
    let path: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebView(url: URL(string: "https://eno.vn")!.appending(path: path))
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(L10n.tr("Done", "Xong")) { dismiss() }
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
