import SwiftUI
import WebKit

// The hybrid escape hatch: any surface that isn't native yet renders the REAL
// web app inside the native shell — full fidelity, zero divergence, replaced
// screen-by-screen as the rewrite lands. Two forms: a tab embed (WebTabView)
// and a modal sheet (WebSheet, used by native screens for web-only flows).

private struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
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
