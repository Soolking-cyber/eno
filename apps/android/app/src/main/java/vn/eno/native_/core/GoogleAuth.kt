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
    // ⛔ THE AUTH HOST COMES FROM AuthConfig, NOT FROM A LITERAL. The constants that were here
    // named the RETIRED hosted Supabase project, where the Google provider is DISABLED — so this
    // entire flow asked a server the site no longer uses and was told google does not exist.

    private var verifier: String? = null
    var onResult: ((Boolean) -> Unit)? = null

    /**
     * ⛔ THE CONFIG LOOKUP IS A BLOCKING HTTP CALL AND THIS RUNS FROM A TAP. Resolving it inline on
     * the caller's thread throws `NetworkOnMainThreadException`, which `runCatching` inside
     * AuthConfig swallows into a null — so `endpoint()` returned null, `start` aborted, and Google
     * sign-in failed silently on every first launch, which is the exact bug this whole file was
     * meant to repair (external review). Resolve on IO, launch the tab back on Main.
     */
    fun start(ctx: Context) {
        val v = randomVerifier()
        verifier = v
        CoroutineScope(Dispatchers.Main).launch {
            // No config, no sign-in attempt: opening a browser at a guessed host would send the
            // PKCE challenge somewhere we have not vouched for.
            val authorize = withContext(Dispatchers.IO) { AuthConfig.endpoint("authorize") }
                ?: run { finish(false); return@launch }
            val authUrl = Uri.parse(authorize).buildUpon()
                .appendQueryParameter("provider", "google")
                .appendQueryParameter("redirect_to", "https://eno.vn/auth/callback?native=2")
                .appendQueryParameter("code_challenge", challenge(v))
                .appendQueryParameter("code_challenge_method", "s256")
                .build()
            CustomTabsIntent.Builder().build().launchUrl(ctx, authUrl)
        }
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
            // The authorization code is a credential: without a vouched-for host it goes nowhere.
            val url = AuthConfig.endpoint("token?grant_type=pkce") ?: return@withContext false
            val key = AuthConfig.anonKey() ?: return@withContext false
            val req = Request.Builder()
                .url(url)
                .header("apikey", key)
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
