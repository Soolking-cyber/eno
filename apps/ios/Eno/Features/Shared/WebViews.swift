import SwiftUI
import WebKit

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
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .automatic
        // EnoNativeApp/1 = first-party app signal (forum origin + SSO handoff key on
        // it); EnoNativeTabs/1 = "embedded tab inside the native TabView" — eno.vn
        // hides its own bottom nav and the Google OAuth button on this marker.
        web.customUserAgent = (WKWebView().value(forKey: "userAgent") as? String).map { "\($0) EnoNativeApp/1 EnoNativeTabs/1" }
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

    final class Coordinator: NSObject, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "enoAuth" else { return }
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
