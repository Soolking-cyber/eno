package vn.eno.app;

import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

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
 * BridgeWebViewClient swap in onCreate — and makes deep links work regardless of which first-party
 * origin the WebView happens to be showing (see onNewIntent).
 */
public class MainActivity extends BridgeActivity {
    private SwipeRefreshLayout swipeRefresh;

    // Written from the WebView's JS thread, read on the UI thread during touch dispatch.
    private volatile boolean ptrEnabled = true;

    /**
     * False until super.onCreate() has returned. BridgeActivity.load() calls onNewIntent(getIntent())
     * from INSIDE onCreate to deliver the cold-start link; that path must stay exactly as it was —
     * the web app consumes it through App.getLaunchUrl() with a sessionStorage once-guard, and
     * stepping in there would race Capacitor's own initial load.
     */
    private boolean started = false;

    /**
     * The main-frame URL the WebView is navigating TO, or null when nothing is in flight. getUrl()
     * still reports the OLD page until the new document commits, so without this a link arriving
     * during a market -> forum hop would be judged against the origin we are leaving.
     */
    private volatile String pendingUrl = null;

    // The two first-party origins this ONE app renders (mirrors server.allowNavigation in
    // capacitor.config.ts). Nothing outside this set may ever be loaded from an external intent:
    // allowNavigation origins are the ones Capacitor treats as trusted.
    private static final Set<String> MARKET_HOSTS = new HashSet<>(Arrays.asList("eno.vn", "www.eno.vn"));
    private static final Set<String> FIRST_PARTY_HOSTS = new HashSet<>(
            Arrays.asList("eno.vn", "www.eno.vn", "eno.forum", "www.eno.forum"));
    private static final String MARKET_ORIGIN = "https://eno.vn";

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
        // Everything from here on is a WARM event (see the field comment).
        started = true;

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

            // The next three overrides only OBSERVE which origin the WebView is heading for, so
            // onNewIntent can tell whether the page that is about to be on screen can route a deep
            // link itself. Every one of them delegates to super unchanged.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean openedExternally = super.shouldOverrideUrlLoading(view, request);
                if (!openedExternally && request.isForMainFrame()) {
                    pendingUrl = request.getUrl().toString();
                }
                return openedExternally;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                pendingUrl = url;
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pendingUrl = null;
                super.onPageFinished(view, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // A failed main-frame load produces no onPageFinished on every device — clear the
                // in-flight marker here too. super still swaps in server.errorPath (see above).
                if (request.isForMainFrame()) pendingUrl = null;
                super.onReceivedError(view, request, error);
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

    /**
     * Deep links on a two-origin shell.
     *
     * launchMode is singleTask, so a link that arrives at an already-running app lands here.
     * Capacitor's own handling (BridgeActivity -> AppPlugin.handleOnNewIntent) fires the JS
     * `appUrlOpen` event — but Android injects Capacitor ONLY into the server origin, so while the
     * WebView is showing eno.forum there is no listener at all. The event is then RETAINED natively
     * (notifyListeners(..., retainUntilConsumed = true)) and replayed whenever eno.vn next
     * registers a listener: the tap does nothing now, and teleports the user somewhere unexpected
     * later. Same for the local offline page.
     *
     * So: when the document on screen cannot route the link itself, navigate the WebView here, and
     * hand super a data-stripped COPY of the intent. AppPlugin.handleOnNewIntent bails when
     * getData() is null, so the same link cannot ALSO be queued and replayed — while every other
     * plugin still sees the intent (a push tap is identified by the "google.message_id" EXTRA, not
     * by the data URI, so PushNotifications is unaffected). ⚠️ setData(null) also clears the MIME
     * type: harmless for an ACTION_VIEW deep link, which carries none, but check that again before
     * adding a plugin that reads intent.getType(). setIntent() is deliberately NOT called:
     * getIntent() must keep returning the LAUNCH intent, or an OS-killed app restored from Recents
     * would replay this warm link as a cold-start one.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        if (started && intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            String target = resolveFirstPartyTarget(intent.getData(), 0);
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (target != null && webView != null && !webCanRouteDeepLink()) {
                webView.loadUrl(target);
                Intent stripped = new Intent(intent);
                stripped.setData(null);
                super.onNewIntent(stripped);
                return;
            }
        }
        super.onNewIntent(intent);
    }

    /**
     * True when the document in the WebView handles appUrlOpen itself. Requires the COMMITTED page
     * AND any navigation still in flight to be eno.vn — the only origin Capacitor is injected into
     * on Android, and the one whose routeDeepLink handles every link shape in-SPA (a native
     * loadUrl would downgrade that to a full page fetch).
     *
     * The AND is what makes pendingUrl safe to consult. A navigation can start and never produce
     * onPageFinished (cancelled, 204, download, SSL block), so pendingUrl CAN go stale — and with
     * an "either" test a stale eno.vn value stuck on a forum page would silently re-open the very
     * bug this fixes. Requiring both means every stale combination fails toward "navigate it
     * natively": the link always works, at worst with a redundant full load.
     */
    private boolean webCanRouteDeepLink() {
        if (getBridge() == null || getBridge().getWebView() == null) return false;
        if (!isMarketUrl(getBridge().getWebView().getUrl())) return false;
        String pending = pendingUrl;
        return pending == null || isMarketUrl(pending);
    }

    private static boolean isMarketUrl(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (host == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        return MARKET_HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    /**
     * Resolve an incoming link to a first-party https URL, or null to leave it to Capacitor.
     * Mirrors the web contract (src/lib/deep-link.ts canonicalAppPath + native-bootstrap's
     * routeDeepLink): canonicalize, then validate. Anything unrecognised — notably
     * enovn://auth-callback, whose PKCE exchange must finish in the JS that started it — returns
     * null and travels the untouched Capacitor path.
     */
    private static String resolveFirstPartyTarget(Uri uri, int depth) {
        if (uri == null || depth > 1 || uri.getScheme() == null) return null;
        // Parser-differential defence, applied to the WHOLE link before anything is trusted.
        // Chromium (the WebView's own URL parser) treats a raw `\` as an authority terminator and
        // strips raw tab/CR/LF anywhere in a URL; android.net.Uri does neither on every platform
        // build we ship to. So `https://evil.example\@eno.vn/` can read as host "eno.vn" HERE and
        // load evil.example THERE. Refuse the characters outright instead of chasing the
        // difference — no real deep link contains them (canonicalAppPath rejects them too).
        if (hasParserSplitChars(uri.toString())) return null;
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);

        if ("https".equals(scheme)) {
            // No userinfo, EVER — the other half of the same escape, and no legitimate eno deep
            // link carries credentials.
            String authority = uri.getEncodedAuthority();
            if (authority == null || authority.indexOf('@') >= 0) return null;
            // An explicit port is a DIFFERENT origin than the one we trust; no eno link has one.
            if (uri.getPort() != -1) return null;
            String host = uri.getHost();
            if (host == null || !FIRST_PARTY_HOSTS.contains(host.toLowerCase(Locale.ROOT))) return null;
            if (!isRoutablePath(uri.getPath())) return null;
            return uri.toString();
        }

        if (!"enovn".equals(scheme) || !"open".equals(uri.getHost())) return null;
        String absolute = queryParameter(uri, "url");
        if (absolute != null) {
            // https only — forbids enovn-in-enovn nesting (unbounded recursion).
            if (!absolute.startsWith("https://")) return null;
            return resolveFirstPartyTarget(Uri.parse(absolute), depth + 1);
        }
        return marketUrlForPath(queryParameter(uri, "path"));
    }

    /** Characters the WebView's parser re-reads or strips, and android.net.Uri may not. */
    private static boolean hasParserSplitChars(String value) {
        return value.indexOf('\\') >= 0 || value.indexOf('\t') >= 0
                || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0;
    }

    /** getQueryParameter throws on a non-hierarchical (opaque) Uri; treat that as "absent". */
    private static String queryParameter(Uri uri, String name) {
        try {
            return uri.isHierarchical() ? uri.getQueryParameter(name) : null;
        } catch (UnsupportedOperationException e) {
            return null;
        }
    }

    private static String marketUrlForPath(String raw) {
        // `//evil.example` and `/\evil.example` are protocol-relative escapes: appended to an origin
        // they resolve to a FOREIGN host. Reject rather than try to normalise.
        if (raw == null || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
        // ⚠️ getQueryParameter DECODED this once, so a `%09` written in the link is a RAW TAB here —
        // invisible to the top-level hasParserSplitChars, which only saw the encoded form. Chromium
        // strips TAB/CR/LF before parsing, so `?path=%2F%09auth%2Fcallback` would sail past the
        // /auth prefix check and then load /auth/callback. Re-check the decoded value.
        if (hasParserSplitChars(raw)) return null;
        int cut = raw.length();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == '?' || c == '#') { cut = i; break; }
        }
        if (!isRoutablePath(raw.substring(0, cut))) return null;
        String joined = MARKET_ORIGIN + raw;
        // Belt and braces: whatever that string parses to, it must still be the marketplace origin.
        Uri parsed = Uri.parse(joined);
        String host = parsed.getHost();
        if (!"https".equalsIgnoreCase(parsed.getScheme()) || host == null
                || !MARKET_HOSTS.contains(host.toLowerCase(Locale.ROOT))) return null;
        return joined;
    }

    /**
     * Decode to a bounded fixpoint so double-encoded input can't slip past the prefix checks, then
     * refuse backslash smuggling, dot-segment traversal and the auth routes (mirrors
     * canonicalAppPath's blockAuthPaths — a crafted link must never drive sign-in/OAuth).
     */
    private static boolean isRoutablePath(String rawPath) {
        if (rawPath == null) return false;
        String probe = rawPath;
        for (int i = 0; i < 3; i++) {
            String decoded;
            try {
                decoded = URLDecoder.decode(probe, "UTF-8");
            } catch (UnsupportedEncodingException | IllegalArgumentException e) {
                break;
            }
            if (decoded.equals(probe)) break;
            probe = decoded;
        }
        // Same reason as marketUrlForPath: after decoding, a smuggled `%5C`/`%09` is a live
        // parser-splitting character again.
        if (hasParserSplitChars(probe)) return false;
        // `/a/../auth` reaches /auth once the network stack normalises it, but sails past a
        // startsWith test — the JS side never had this hole because `new URL()` normalises dot
        // segments before it checks, while Uri.getPath() does not. Nothing legitimate here has a
        // `.` or `..` segment, so refuse them rather than normalise a string we then load
        // un-normalised.
        for (String segment : probe.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) return false;
        }
        String lower = probe.toLowerCase(Locale.ROOT);
        return !(lower.startsWith("/auth") || lower.startsWith("/signin"));
    }
}
