package vn.eno.native_.core

import android.content.Context
import okhttp3.Request
import org.json.JSONObject
import java.net.URI

/**
 * WHERE THIS APP'S AUTH SERVER LIVES — asked for at runtime, never compiled in.
 * (The Android half of apps/ios/Eno/Core/AuthConfig.swift; read that file's notes too.)
 *
 * ⛔ THE CONSTANT THIS REPLACES WAS WRONG FOR WEEKS AND NOTHING COULD TELL. `Auth` and `GoogleAuth`
 * each hardcoded `https://xihiryllwmjoouipkyhw.supabase.co` — the OLD hosted Supabase project —
 * while eno.vn and eno.forum have served auth from the self-hosted stack on the box
 * (`https://sb.eno.vn`) since the migration. Google is enabled on the box and DISABLED on the old
 * project, so every native Google sign-in asked a server the site no longer uses and was told the
 * provider does not exist. The iOS side was fixed first; this file closes the same hole here, and
 * the two duplicated copies of the constant with it.
 *
 * ⚠️ THE VALUES ARE PUBLIC, THE REPOSITORY IS TOO, AND THOSE ARE DIFFERENT PROBLEMS. Both fields
 * are `NEXT_PUBLIC_*` — every browser already receives them — so serving them is safe. Pasting
 * them into Kotlin would instead publish them in a public git history and freeze them there: this
 * app cannot be re-released as quickly as a key can be rotated.
 *
 * ⚠️ THIS TREE IS SHELVED (the app ships through Capacitor today), which is exactly why the fix is
 * a runtime lookup rather than an updated literal: a shelved constant goes stale silently and is
 * discovered by whoever next tries to sign in.
 */
object AuthConfig {
    data class Values(val url: String, val anonKey: String)

    /** In-memory TTL. A process that started before a key rotation must not hold the old one
     *  until the app is force-quit — the same class of bug as the hardcoded host, shorter fuse. */
    private const val MEMORY_TTL_MS = 10 * 60 * 1000L
    private const val PREFS = "eno.authconfig"
    private const val K_URL = "url"
    private const val K_KEY = "anonKey"

    /** ⛔ THE HOST IS CHECKED, BECAUSE THIS VALUE DECIDES WHERE CREDENTIALS GO. Refresh tokens, the
     *  PKCE verifier and the authorization code all go to whatever this returns, so an answer that
     *  arrived over a compromised connection — or from a future bug in the endpoint — must not be
     *  able to redirect them anywhere. https only, no port, and only our own hosts. */
    private val TRUSTED = setOf("sb.eno.vn", "sb.eno.forum", "eno.vn", "www.eno.vn", "eno.forum", "www.eno.forum")

    @Volatile private var cached: Values? = null
    @Volatile private var cachedAt = 0L
    @Volatile private var appContext: Context? = null

    /** Call once from the Application/Activity so the persisted fallback is reachable. */
    fun attach(context: Context) { appContext = context.applicationContext }

    /**
     * The auth base and anon key for this deployment.
     *
     * ⚠️ IT FALLS BACK TO THE LAST KNOWN-GOOD VALUE RATHER THAN FAILING. Making auth depend on a
     * web endpoint would let a site outage expire a session while the auth server itself is
     * perfectly healthy — a failure mode the hardcoded constant did not have. Fresh answer, else
     * the stored one, else null, and every caller must handle null rather than guess a host.
     */
    /**
     * ⛔ BLOCKING. `fetch()` is a synchronous OkHttp call, so every caller of this and of
     * `endpoint()` / `anonKey()` must already be off the main thread — Android throws
     * `NetworkOnMainThreadException` otherwise and AuthConfig's own runCatching turns that into a
     * null that reads as "no config" rather than as a bug.
     */
    fun values(): Values? {
        val now = System.currentTimeMillis()
        cached?.let { if (now - cachedAt < MEMORY_TTL_MS) return it }
        fetch()?.let {
            cached = it; cachedAt = now; persist(it); return it
        }
        return loadPersisted()?.also { cached = it; cachedAt = now }
    }

    /** `https://<auth host>/auth/v1/<path>`, or null when the config is not known yet. */
    fun endpoint(path: String): String? = values()?.let { "${it.url.trimEnd('/')}/auth/v1/$path" }

    fun anonKey(): String? = values()?.anonKey

    private fun fetch(): Values? = runCatching {
        val req = Request.Builder()
            .url("https://eno.vn/api/auth/native-config")
            .header("Accept", "application/json")
            .build()
        Api.client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            val body = JSONObject(res.body?.string().orEmpty())
            val v = Values(body.optString("url"), body.optString("anonKey"))
            if (isTrusted(v)) v else null
        }
    }.getOrNull()

    private fun isTrusted(v: Values): Boolean {
        if (v.url.isBlank() || v.anonKey.isBlank()) return false
        val uri = runCatching { URI(v.url) }.getOrNull() ?: return false
        return uri.scheme == "https" && uri.port == -1 && uri.host in TRUSTED
    }

    private fun persist(v: Values) {
        val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
        prefs.edit().putString(K_URL, v.url).putString(K_KEY, v.anonKey).apply()
    }

    private fun loadPersisted(): Values? {
        val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return null
        val url = prefs.getString(K_URL, null) ?: return null
        val key = prefs.getString(K_KEY, null) ?: return null
        val v = Values(url, key)
        // A stored value is re-checked against the allow-list: the list can tighten between
        // releases, and a persisted host must not outlive its trust.
        return if (isTrusted(v)) v else null
    }
}
