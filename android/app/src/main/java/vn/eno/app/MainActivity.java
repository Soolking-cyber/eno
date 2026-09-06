package vn.eno.app;

import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
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
     * Bumped on every pull so a stale safety-ceiling timer — or a late refreshDone from a PREVIOUS
     * pull on a rapid double-pull — can't retract a NEWER pull's spinner. Written on the UI thread
     * (the refresh listener), read from the WebView's JS thread (the bridge), hence volatile.
     */
    private volatile int refreshGeneration = 0;

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

        /**
         * Pull-to-refresh completion handshake (mirrors iOS's `enoRefreshDone` script message). The
         * web calls this the instant its RSC re-fetch settles — router.refresh() is otherwise
         * fire-and-forget, which is why the spinner used to retract on a flat 900ms guess that on a
         * slow network vanished while content was still stale. `gen` is the generation we tagged the
         * pull with, so a stale completion can't cut a newer pull short.
         *
         * ⚠️ @JavascriptInterface methods run on the WebView's JS thread — every View touch must be
         * posted to the UI thread.
         *
         * Reachable from BOTH injected first-party origins (eno.vn and eno.forum — the bridge is
         * injected per WebView, not per origin), same as setPtrEnabled above. That is acceptable for
         * the same reason: allowNavigation pins this WebView to our own two origins, and the whole
         * capability is "retract a refresh spinner" — a cosmetic native-UI effect with no data
         * access, gated further by the generation check below.
         */
        @JavascriptInterface
        public void refreshDone(int gen) {
            runOnUiThread(() -> endRefresh(gen));
        }
    }

    /**
     * Retract the pull-to-refresh spinner, but only for the pull that armed this call — a newer pull
     * has already bumped refreshGeneration. UI thread only.
     */
    private void endRefresh(int generation) {
        if (generation != refreshGeneration || swipeRefresh == null) return;
        swipeRefresh.setRefreshing(false);
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
        /*
         * ⚠️ THE SPINNER WAS THE PLATFORM DEFAULT — a grey arc on a white puck, in an app whose
         * every other control is brand blue, and unreadable on the dark theme because the puck
         * never changed with it. Owner, 2026-09-06: the pull-down should have "a pleasant
         * animation thats relevant". Brand arc, themed puck; both resolve per night/day from the
         * res values and values-night colors.xml, which is also where the canvas colour behind
         * this control lives.
         */
        applyRefreshColors();
        /*
         * ⛔ THE PUCK SETTLES BELOW THE APP HEADER, AND EVERY NUMBER HERE COMES FROM THE LIBRARY
         * SOURCE RATHER THAN FROM GUESSING AT IT. Two earlier versions were wrong in two ways:
         *
         * 1. setProgressViewOffset(false, 8dp, 72dp) moved the START offset. SwipeRefreshLayout.java
         *    :437 defaults it to `-mCircleDiameter` — above the top edge, hidden. A positive start
         *    parks a full-size puck permanently visible inside the header, and with scale=false it
         *    never fades. Only the REST position may move, so this uses setProgressViewEndTarget and
         *    leaves `mUsingCustomStart` false.
         * 2. `end` IS NOT THE PUCK'S TOP. With mUsingCustomStart false, :490 computes
         *    `endTarget = mSpinnerOffsetEnd + mOriginalOffsetTop`, and mOriginalOffsetTop is that
         *    negative diameter — so the circle comes to rest with its top at `end - 40dp`
         *    (CIRCLE_DIAMETER, :88, times density). Passing the header height alone therefore left
         *    the puck 40dp INSIDE the header. The diameter has to be added back.
         *
         * ⚠️ AND THE HEADER IS MEASURED, NOT A CONSTANT, because the WebView runs edge-to-edge under
         * the status bar: #app-header is a 64dp bar PLUS `padding-top: safe-area-inset-top`
         * (globals.css `html.native #app-header`). Rest target = inset + 64dp header + 16dp of air
         * + 40dp circle.
         *
         * ⛔ READ THE INSET, DO NOT INTERCEPT IT. An earlier version installed
         * setOnApplyWindowInsetsListener on this ViewGroup and returned the insets — which REPLACES
         * the group's own onApplyWindowInsets and stops the dispatch reaching the WebView, so
         * env(safe-area-inset-top) would have collapsed to 0 and the app header would have slid
         * under the notch. Reading the root insets after layout touches nothing.
         */
        /*
         * ⛔ NO WINDOW-INSETS LISTENER HERE, AND THAT IS THE POINT. Two earlier versions installed
         * one on this ViewGroup. Setting a listener REPLACES a view's onApplyWindowInsets, and for
         * a ViewGroup that method is what forwards insets to children — so the first version left
         * the WebView with no insets at all, collapsing env(safe-area-inset-top) and sliding
         * #app-header under the notch. The second forwarded them by hand, which works but had three
         * reviewers arguing about whether it also double-dispatches. A puck's rest position is not
         * worth being anywhere near that machinery: the platform's own status_bar_height resource
         * gives the same number, is available before the first traversal rather than null during
         * it, and touches no dispatch chain whatsoever.
         * ⚠️ RE-APPLIED ON CONFIGURATION CHANGE so rotation and a theme switch keep it right; see
         * onConfigurationChanged below.
         */
        /*
         * ⛔ APPLIED NOW *AND* AGAIN AFTER ATTACH, BECAUSE ONLY THE SECOND ONE CAN SEE THE INSETS.
         * At this point the view is not attached to the window, so getRootWindowInsets is null and
         * topInsetPx() returns its status_bar_height fallback — which knows nothing about a display
         * cutout. Three reviewers pointed out that nothing then corrected it until a configuration
         * change, so on a hole-punch phone the puck stayed stranded inside the header for the whole
         * session. The immediate call keeps the first frame sane; the attach callback replaces it
         * with the real number.
         */
        applyRefreshEndTarget();
        /*
         * ⛔ ON EVERY LAYOUT, NOT ON A post() — post() ONLY PROMISES "NEXT FRAME", NOT "AFTER THE
         * INSETS ARRIVED". Two reviewers pointed out the race in both directions: a cold launch
         * whose runnable beats the first traversal keeps the cutout-blind fallback for the whole
         * session, and a rotation whose runnable beats the new dispatch reads the PREVIOUS
         * orientation's inset. A layout pass, by contrast, happens after insets are applied — every
         * time, on attach, on rotation, and when the system bars change — so reading them here is
         * ordered by construction rather than by hope. It is still only a READ: no listener is
         * installed on the inset dispatch chain, which is what broke env(safe-area-inset-top) in an
         * earlier version of this block.
         * ⚠️ GUARDED ON A CHANGE, because setProgressViewEndTarget invalidates the circle and an
         * unconditional call from a layout listener is a layout loop.
         * ⚠️ KNOWN GAP, STATED RATHER THAN PAPERED OVER: an inset change that lays nothing out —
         * system bars appearing or disappearing in an immersive window whose bounds do not move —
         * would not fire this. The app never enters immersive mode, so the case is unreachable
         * today; if it ever does, the answer is an insets listener that FORWARDS (see the note
         * above about what happens when one does not), not a poll.
         */
        swipeRefresh.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or_, ob) -> applyRefreshEndTarget());
        swipeRefresh.addView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        parent.addView(swipeRefresh, index);

        swipeRefresh.setOnRefreshListener(() -> {
            final int generation = ++refreshGeneration;
            // Tag the pull with its generation so the web can echo it back through
            // EnoNative.refreshDone() and we only ever retract the spinner for THIS pull.
            webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('eno:native-refresh',{detail:{gen:" + generation + "}}))",
                    null);
            // Safety CEILING only. The spinner is normally retracted by the web's refreshDone() the
            // instant router.refresh() settles; this just guarantees it can never stick if that call
            // never arrives (an older web bundle, a failed refetch, offline). Generous so a genuinely
            // slow refresh isn't cut short.
            webView.postDelayed(() -> endRefresh(generation), 12000);
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

    /**
     * The top safe inset in px: the real one where it can be READ, the platform resource where it
     * cannot.
     *
     * ⛔ THIS READS INSETS, IT NEVER INSTALLS A LISTENER. Two earlier versions did, and setting a
     * listener REPLACES a ViewGroup's onApplyWindowInsets — which is the method that forwards
     * insets to children — so the WebView lost env(safe-area-inset-top) and #app-header slid under
     * the notch. Reading getRootWindowInsets touches no dispatch chain at all.
     *
     * ⚠️ AND IT ASKS FOR statusBars() | displayCutout(), because those are what
     * env(safe-area-inset-top) resolves to in the WebView, and the puck must clear the header the
     * WebView actually draws. On a hole-punch phone the cutout can exceed the status bar; in
     * landscape the status bar can collapse while the cutout does not. The `status_bar_height`
     * resource knows about neither, so it is only the fallback for the first frame, before the
     * window has been attached and there is nothing to read.
     */
    private int topInsetPx() {
        final View decor = getWindow() != null ? getWindow().getDecorView() : null;
        if (decor != null) {
            final WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
            if (insets != null) {
                return insets.getInsets(WindowInsetsCompat.Type.statusBars()
                        | WindowInsetsCompat.Type.displayCutout()).top;
            }
        }
        final int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
    }

    /**
     * Where the refresh puck comes to rest. `end` is NOT the puck's top: with the default (hidden)
     * start offset, SwipeRefreshLayout:490 computes `endTarget = mSpinnerOffsetEnd + mOriginalOffsetTop`
     * and mOriginalOffsetTop is -CIRCLE_DIAMETER, so the circle's top lands at `end - 40dp`. Hence
     * inset + 64dp header + 16dp of air + the 40dp diameter that gets subtracted straight back off.
     */
    private int refreshEndTargetPx = -1;

    private void applyRefreshEndTarget() {
        if (swipeRefresh == null) return;
        final float density = getResources().getDisplayMetrics().density;
        final int target = topInsetPx() + (int) ((64 + 16 + 40) * density);
        if (target == refreshEndTargetPx) return;   // see the layout-loop note at the call site
        refreshEndTargetPx = target;
        swipeRefresh.setProgressViewEndTarget(false, target);
    }

    /**
     * ⛔ RESOLVED FROM RESOURCES EVERY TIME, NEVER CACHED — A LIVE THEME SWITCH LEAVES THEM STALE
     * OTHERWISE, AND THAT REPRODUCES THE EXACT BUG THIS CHANGE WAS MADE TO FIX. AndroidManifest
     * declares `uiMode` in configChanges (Capacitor's template does), so switching the system theme
     * while the app is alive does NOT recreate the activity. The WebView repaints through
     * prefers-color-scheme, but anything resolved once in onCreate keeps the old theme's value —
     * so the page would go dark while the puck and the window canvas behind the overscroll stayed
     * light, which is the wrong-colour band the owner reported in the first place. All four
     * reviewers found this; nothing in the gates could have.
     */
    private void applyRefreshColors() {
        if (swipeRefresh == null) return;
        final boolean dark = appIsDark();
        swipeRefresh.setColorSchemeColors(ContextCompat.getColor(
                this, dark ? R.color.refreshSpinnerDark : R.color.refreshSpinnerLight));
        // The puck stays white in both themes on purpose — see values/colors.xml.
        swipeRefresh.setProgressBackgroundColorSchemeColor(
                ContextCompat.getColor(this, R.color.refreshSpinnerBg));
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(
                ContextCompat.getColor(this, dark ? R.color.cardDark : R.color.cardLight)));
    }

    /**
     * ⛔ THE APP'S OWN THEME, NOT ANDROID'S NIGHT MODE — AND THE BRIDGE FOR IT ALREADY EXISTED.
     * Every native colour here used to resolve through values/ vs values-night/, so a user who
     * explicitly picked Light in-app on a Dark phone got dark native chrome behind a light page:
     * the wrong-colour overscroll band the owner reported, for exactly the people who had opted out
     * of the system theme. Four reviewers raised it across three rounds and each time the answer
     * was "that needs a theme bridge, which is its own change". It is not: `theme-context.tsx:81`
     * has been mirroring the RESOLVED scheme into Capacitor Preferences as `eno-resolved-theme`
     * since Phase 2 M1, and Capacitor's Android Preferences plugin stores that in the
     * `CapacitorStorage` SharedPreferences group (PreferencesConfiguration.java:9). Reading it is
     * six lines and it makes the native canvas follow the same choice the page does.
     *
     * ⚠️ THE FALLBACK IS ANDROID'S NIGHT MODE, which is right for the two cases with no answer yet:
     * a first launch before the web app has ever resolved a theme, and a user who never overrode it
     * (the mirror then holds the same value anyway).
     */
    private boolean appIsDark() {
        final String mirrored = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .getString("eno-resolved-theme", null);
        if ("dark".equals(mirrored)) return true;
        if ("light".equals(mirrored)) return false;
        return (getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /**
     * ⛔ HELD AS A FIELD ON PURPOSE: SharedPreferences keeps only a WEAK reference to its listeners,
     * so a lambda passed inline is collected at the next GC and the theme silently stops following.
     */
    private final android.content.SharedPreferences.OnSharedPreferenceChangeListener themeMirrorListener =
            (prefs, key) -> {
                if ("eno-resolved-theme".equals(key)) runOnUiThread(this::applyRefreshColors);
            };

    /**
     * ⛔ OBSERVE THE MIRROR, DO NOT ONLY SAMPLE IT AT LIFECYCLE POINTS. Reading `eno-resolved-theme`
     * in onResume and onConfigurationChanged covered a system switch and a trip through the
     * background, and three reviewers pointed out the case those two miss entirely: eno.vn is a
     * single-page app, so a user changing the theme in its own settings never pauses this activity
     * and never changes its configuration. The native canvas and spinner would have stayed on the
     * old theme until something unrelated happened — which is the same wrong-colour band, reached
     * by the one route a user is most likely to take deliberately.
     * Capacitor's Preferences plugin writes through SharedPreferences.Editor, so this fires on the
     * web app's own write with no bridge, no polling and no new plumbing.
     */
    @Override
    public void onResume() {
        super.onResume();
        getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .registerOnSharedPreferenceChangeListener(themeMirrorListener);
        /*
         * ⚠️ RE-READ ON RESUME. The mirror is written by the web app whenever its resolved theme
         * changes, and nothing notifies native when that happens — a user toggling the theme in
         * app settings would otherwise keep the old canvas until the next configuration change.
         * Resume covers the realistic paths (settings screen, backgrounding, system switch) and is
         * cheap: applyRefreshColors only touches two setters and a window drawable.
         */
        applyRefreshColors();
    }

    @Override
    public void onPause() {
        super.onPause();
        getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .unregisterOnSharedPreferenceChangeListener(themeMirrorListener);
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        /*
         * Rotation changes the top inset; a rest position computed once at startup would strand the
         * puck inside the header in the other orientation.
         * ⚠️ POSTED, NOT IMMEDIATE. onConfigurationChanged runs BEFORE the window manager dispatches
         * the new insets, so reading them here would produce the previous orientation's number —
         * the same staleness this call exists to remove, one frame later.
         */
        // The layout listener installed in setup already re-reads the insets on the post-rotation
        // pass; this only makes sure a configuration change that somehow lays nothing out is still
        // reflected. Cheap, and idempotent thanks to the equality guard.
        if (swipeRefresh != null) swipeRefresh.post(this::applyRefreshEndTarget);
        // ⚠️ AND THE COLOURS, for the uiMode case above. `getResources()` has already been updated
        // with the new configuration by the time this runs, so re-resolving is all that is needed.
        // applyRefreshColors repaints the window too: styles.xml's android:windowBackground is
        // resolved by the framework when the theme is applied and does not follow a live change.
        applyRefreshColors();
    }
}
