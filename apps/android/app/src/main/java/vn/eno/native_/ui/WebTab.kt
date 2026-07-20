package vn.eno.native_.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import vn.eno.native_.core.Auth

// Hybrid escape hatch (same pattern as apps/ios WebTabView): a not-yet-native
// tab renders the REAL web app. The EnoNativeTabs UA marker makes eno.vn hide
// its own bottom nav + the Google OAuth button (Google rejects OAuth in raw
// WebViews).
//
// Auth bridge: WebMessageListener injects `window.enoAuth` ONLY into
// https://eno.vn documents — the origin allowlist is enforced by the PLATFORM,
// which closes by construction the any-frame hijack the iOS review found in
// the WebKit handler. The page posts {access_token, refresh_token} JSON on
// sign-in and the "signout" sentinel on explicit sign-out.
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebTab(path: String) {
    // key(path): a path change rebuilds the WebView (AndroidView's factory runs
    // once, so without this a new path would never load — review #2). onRelease
    // destroys the WebView on leave, so the Activity context AND the enoAuth
    // message listener don't leak every time the tab is dismissed.
    key(path) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        onRelease = { it.destroy() },
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.userAgentString = settings.userAgentString + " EnoNativeApp/1 EnoNativeTabs/1"
                webViewClient = WebViewClient()
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    WebViewCompat.addWebMessageListener(this, "enoAuth", setOf("https://eno.vn")) { _, message, _, _, _ ->
                        val data = message.data ?: return@addWebMessageListener
                        if (data == "signout") {
                            Auth.signOut()
                        } else {
                            runCatching {
                                val o = JSONObject(data)
                                Auth.adopt(o.getString("access_token"), o.getString("refresh_token"))
                            }
                        }
                    }
                }
                loadUrl("https://eno.vn$path")
            }
        },
    )
    }
}
