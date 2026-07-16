package vn.eno.app;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.BridgeActivity;

/**
 * Native pull-to-refresh on Android: wrap Capacitor's WebView in a SwipeRefreshLayout (the real
 * Material refresh spinner). On pull we fire the SAME `eno:native-refresh` event the iOS
 * UIRefreshControl uses — native-bootstrap soft-refreshes the route via router.refresh() (no full
 * reload). The pull only engages when the WebView is scrolled to the very top.
 */
public class MainActivity extends BridgeActivity {
    private SwipeRefreshLayout swipeRefresh;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebView webView = getBridge().getWebView();
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
        // Engage the pull ONLY at the very top — otherwise a normal scroll-up would trigger it.
        swipeRefresh.setOnChildScrollUpCallback((parent1, child) -> webView.getScrollY() > 0);
    }
}
