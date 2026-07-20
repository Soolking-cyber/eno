package vn.eno.native_.core

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

// Native Google sign-in (Android twin of apps/ios GoogleSignIn) — Google
// rejects OAuth in the WebView, so the web sign-in tab hides the button. This
// runs it in a Chrome Custom Tab (a real browser Google allows) with native
// PKCE, reusing the SAME server hop as iOS: redirect_to the allow-listed
// https://eno.vn/auth/callback?native=2 → server 302s the code to
// enonative://auth-callback → an intent-filter on MainActivity catches it here
// → exchange at /token?grant_type=pkce → adopt. No Supabase config change.
object GoogleAuth {
    private const val SUPABASE = "https://xihiryllwmjoouipkyhw.supabase.co"
    private const val KEY = "sb_publishable_He0wwlDfz9YW35sjys3O5Q_qyJ5qwB1" // public

    private var verifier: String? = null
    var onResult: ((Boolean) -> Unit)? = null

    fun start(ctx: Context) {
        val v = randomVerifier()
        verifier = v
        val authUrl = Uri.parse("$SUPABASE/auth/v1/authorize").buildUpon()
            .appendQueryParameter("provider", "google")
            .appendQueryParameter("redirect_to", "https://eno.vn/auth/callback?native=2")
            .appendQueryParameter("code_challenge", challenge(v))
            .appendQueryParameter("code_challenge_method", "s256")
            .build()
        CustomTabsIntent.Builder().build().launchUrl(ctx, authUrl)
    }

    /// Called from MainActivity when it receives the enonative://auth-callback deep link.
    fun handleRedirect(uri: Uri) {
        val code = uri.getQueryParameter("code") ?: run { finish(false); return }
        val v = verifier ?: run { finish(false); return }
        CoroutineScope(Dispatchers.Main).launch {
            finish(exchange(code, v))
        }
    }

    private suspend fun exchange(code: String, v: String): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val body = JSONObject().put("auth_code", code).put("code_verifier", v).toString()
                .toRequestBody("application/json".toMediaType())
            val req = Request.Builder()
                .url("$SUPABASE/auth/v1/token?grant_type=pkce")
                .header("apikey", KEY)
                .post(body)
                .build()
            Api.client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext false
                val o = JSONObject(res.body!!.string())
                val at = o.getString("access_token")
                val rt = o.getString("refresh_token")
                withContext(Dispatchers.Main) { Auth.adopt(at, rt) }
                true
            }
        }.getOrDefault(false)
    }

    private fun finish(ok: Boolean) {
        verifier = null
        onResult?.invoke(ok)
        onResult = null
    }

    private fun randomVerifier(): String {
        val bytes = ByteArray(64)
        SecureRandom().nextBytes(bytes)
        return base64URL(bytes)
    }

    private fun challenge(v: String): String =
        base64URL(MessageDigest.getInstance("SHA-256").digest(v.toByteArray()))

    private fun base64URL(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
