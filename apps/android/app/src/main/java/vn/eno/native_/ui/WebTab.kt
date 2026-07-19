package vn.eno.native_.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

// Hybrid escape hatch (same pattern as apps/ios WebTabView): a not-yet-native
// tab renders the REAL web app. The EnoNativeTabs UA marker makes eno.vn hide
// its own bottom nav + the Google OAuth button (Google rejects OAuth in raw
// WebViews).
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebTab(path: String) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.userAgentString = settings.userAgentString + " EnoNativeApp/1 EnoNativeTabs/1"
                webViewClient = WebViewClient()
                loadUrl("https://eno.vn$path")
            }
        },
    )
}
