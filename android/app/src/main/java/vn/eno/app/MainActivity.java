package vn.eno.app;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Native pull-to-refresh on Android: wrap Capacitor's WebView in a SwipeRefreshLayout (the real
 * Material refresh spinner). On pull we fire the SAME `eno:native-refresh` event the iOS
 * UIRefreshControl uses — native-bootstrap soft-refreshes the route via router.refresh() (no full
 * reload). The pull only engages when the WebView is scrolled to the very top AND the page hasn't
 * disabled it via the EnoNative bridge (inner scrollers — chat thread, video feed, map pan — sit
 * at webView scrollY 0, so scroll position alone can't tell "top of page" from "top of page with
 * an inner scroller under the finger").
 *
 * It also narrows Capacitor's server.errorPath to genuine network failures — see the comment on the
 * BridgeWebViewClient swap in onCreate.
 */
public class MainActivity extends BridgeActivity {
    private SwipeRefreshLayout swipeRefresh;

    // Written from the WebView's JS thread, read on the UI thread during touch dispatch.
    private volatile boolean ptrEnabled = true;

    /**
     * JS bridge (window.EnoNative). addJavascriptInterface is safe here: minSdk 24 (>= 17, so only
     * @JavascriptInterface methods are exposed) and allowNavigation pins in-WebView navigation to
     * eno.vn + eno.forum — both first-party, no third-party page can ever run in this WebView.
     * Note the interface is injected into EVERY origin in the WebView, so forum pages get it too;
     * on Android it is the forum pages' ONLY native channel, and it carries just setPtrEnabled.
     */
    private class EnoNativeBridge {
        @JavascriptInterface
        public void setPtrEnabled(boolean enabled) {
            ptrEnabled = enabled;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Applies postSplashScreenTheme once the splash is done (installSplashScreen is what swaps
        // the theme — without it the activity would keep the launch theme). Must run before
        // super.onCreate.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        final WebView webView = getBridge().getWebView();
        // Registered in the SAME main-thread turn as super.onCreate's loadUrl — the remote
        // document's JS context cannot have been created yet (no network response has landed),
        // so the injection applies to the initial page load, not just the next one. If a device
        // ever races this anyway, the web side optional-chains and PTR falls back to the
        // scrollY-only gate (fail-open).
        webView.addJavascriptInterface(new EnoNativeBridge(), "EnoNative");

        // server.errorPath (error.html — the branded "You're offline" page) must fire ONLY on a real
        // network failure. Capacitor's BridgeWebViewClient also swaps it in from onReceivedHttpError,
        // i.e. on ANY main-frame HTTP status >= 400 — so a removed listing (a perfectly good branded
        // 404 page served by Next.js) told the user they had no internet. iOS never had this bug:
        // WKWebView renders 4xx/5xx bodies and only calls didFail for transport errors, so this
        // restores parity. onReceivedError (ERR_INTERNET_DISCONNECTED / DNS / timeout / refused) is
        // left inherited — that IS the genuine offline signal, and the error page still shows there.
        // The override is deliberately empty: android.webkit.WebViewClient.onReceivedHttpError is a
        // no-op stub, and Java has no super.super to reach past BridgeWebViewClient's loadUrl. The
        // only thing dropped is Capacitor's WebViewListener fan-out for this one event; no plugin in
        // this app registers a WebViewListener. Swapped in the same main-thread turn as the initial
        // load, so it is the client that sees the first response (callbacks are posted to the main
        // looper and cannot run before onCreate yields).
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                // Intentionally no super call — leave the server's own 404/500 page on screen.
            }
        });

        final ViewGroup parent = (ViewGroup) webView.getParent();
        if (parent == null) return;

        final int index = parent.indexOfChild(webView);
        final ViewGroup.LayoutParams originalParams = webView.getLayoutParams();
        parent.removeView(webView);

        swipeRefresh = new SwipeRefreshLayout(this);
        swipeRefresh.setLayoutParams(originalParams);
        swipeRefresh.addView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        parent.addView(swipeRefresh, index);

        swipeRefresh.setOnRefreshListener(() -> {
            webView.evaluateJavascript("window.dispatchEvent(new Event('eno:native-refresh'))", null);
            // The soft refresh is fast; stop the spinner shortly after so it feels snappy.
            webView.postDelayed(() -> swipeRefresh.setRefreshing(false), 900);
        });
        // Block the pull whenever the page disabled it, or the WebView isn't at the very top —
        // otherwise a normal scroll-up (or a drag on an inner scroller) would trigger it.
        swipeRefresh.setOnChildScrollUpCallback((parent1, child) -> !ptrEnabled || webView.getScrollY() > 0);
    }
}
