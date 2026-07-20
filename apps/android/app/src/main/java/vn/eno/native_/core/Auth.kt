package vn.eno.native_.core

import android.content.Context
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

// Messages tab badge (mirror of apps/ios UnreadModel): 9+ cap rendered at the
// nav; refreshes on app start, sign-in flips, and tab visits.
object Unread {
    @Serializable
    private data class UnreadResponse(val unread: Int = 0)

    var count by mutableStateOf(0)
        private set

    suspend fun refresh() {
        if (!Auth.isSignedIn) { count = 0; return }
        count = runCatching { Api.get<UnreadResponse>("api/conversations/unread").unread }.getOrDefault(count)
    }
}

// Native session (Android port of apps/ios AuthModel, WITH the iOS review
// lessons baked in from day one): tokens arrive from the embedded web sign-in
// over the origin-scoped WebMessageListener bridge (platform-enforced to
// https://eno.vn — the hijack class iOS finding #1 had to close by hand),
// live in EncryptedSharedPreferences, refresh single-flight against Supabase
// with a session GENERATION so a stale refresh can never wipe a fresh session
// (#2/#3), and ride every API call as Bearer via Api.ensureFreshToken (#5).
object Auth {
    private const val SUPABASE = "https://xihiryllwmjoouipkyhw.supabase.co"
    private const val KEY = "sb_publishable_He0wwlDfz9YW35sjys3O5Q_qyJ5qwB1" // public by design

    data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long)

    var session: Session? by mutableStateOf(null)
        private set
    val isSignedIn: Boolean get() = session != null

    // @Volatile: the generation guard is read on IO (refresh) and written on
    // main (adopt/signOut) — visibility matters for the guard to actually fire.
    @Volatile private var sessionGen = 0
    private val refreshMutex = Mutex()
    private var prefs: android.content.SharedPreferences? = null
    private var initDone = false

    fun init(ctx: Context) {
        if (initDone) return
        initDone = true
        // FAIL CLOSED on encryption unavailability: tokens are NEVER written in
        // plaintext. If the keystore is unavailable (rare), the session lives in
        // memory only for this run — the user re-signs-in after a restart, which
        // is the safe tradeoff for auth material vs. a plaintext downgrade.
        prefs = runCatching {
            val master = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(
                ctx, "eno-auth", master,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }.getOrNull()
        val p = prefs
        if (p != null) {
            val at = p.getString("access", null)
            val rt = p.getString("refresh", null)
            if (at != null && rt != null) {
                session = Session(at, rt, p.getLong("exp", 0L))
                Api.accessToken = at
            }
        }
        Api.ensureFreshToken = { refreshIfNeeded() }
        Api.onUnauthorized = { handleUnauthorized() }
    }

    fun adopt(accessToken: String, refreshToken: String) {
        val current = session
        if (accessToken == current?.accessToken) return
        val exp = jwtExpiry(accessToken) ?: (now() + 3000)
        // Discriminate by user id (review #5): the stale-token guard must only
        // reject an OLDER token of the SAME user (a stale tab re-posting rotated
        // tokens). A DIFFERENT user is an account switch — always adopt, even if
        // the new token expires sooner, or web and native desync.
        if (current != null && jwtSub(accessToken) == jwtSub(current.accessToken) && exp <= current.expiresAt) return
        sessionGen++
        session = Session(accessToken, refreshToken, exp)
        persist()
        Api.accessToken = accessToken
    }

    /// A request with a token came back 401 (review #3): force a refresh — if the
    /// token merely expired mid-flight it recovers; if the refresh token is dead
    /// too, refresh()'s 400/401 branch signs the user out, breaking the loop.
    suspend fun handleUnauthorized() {
        refreshMutex.withLock {
            val cur = session ?: return
            refresh(cur)
        }
    }

    fun signOut() {
        sessionGen++
        val token = session?.accessToken
        session = null
        prefs?.edit()?.clear()?.apply()
        Api.accessToken = null
        if (token != null) {
            CoroutineScope(Dispatchers.IO).launch {
                runCatching {
                    val req = Request.Builder()
                        .url("$SUPABASE/auth/v1/logout")
                        .header("apikey", KEY)
                        .header("Authorization", "Bearer $token")
                        .post(ByteArray(0).toRequestBody(null))
                        .build()
                    Api.client.newCall(req).execute().close()
                }
            }
        }
    }

    suspend fun refreshIfNeeded() {
        val s = session ?: return
        if (s.expiresAt > now() + 60) return
        // Single-flight: concurrent callers coalesce; Supabase rotates refresh
        // tokens, so a double-send burns the session.
        refreshMutex.withLock {
            val cur = session ?: return
            if (cur.expiresAt > now() + 60) return
            refresh(cur)
        }
    }

    private suspend fun refresh(s: Session) {
        val gen = sessionGen
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val body = JSONObject().put("refresh_token", s.refreshToken).toString()
                    .toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url("$SUPABASE/auth/v1/token?grant_type=refresh_token")
                    .header("apikey", KEY)
                    .post(body)
                    .build()
                Api.client.newCall(req).execute().use { res ->
                    res.code to (res.body?.string() ?: "")
                }
            }.getOrNull()
        } ?: return
        // Apply the outcome on Main so the generation re-check + session write is
        // serialized with adopt()/signOut() (both main-thread) — matches iOS's
        // @MainActor model, no torn session state.
        withContext(Dispatchers.Main.immediate) {
            // The world moved while suspended (adopt/signOut): drop this result.
            if (sessionGen != gen || session == null) return@withContext
            val (code, text) = result
            if (code in 200..299) {
                runCatching {
                    val o = JSONObject(text)
                    val at = o.getString("access_token")
                    val rt = o.getString("refresh_token")
                    sessionGen++
                    session = Session(at, rt, o.optLong("expires_at").takeIf { it > 0 } ?: jwtExpiry(at) ?: (now() + 3000))
                    persist()
                    Api.accessToken = at
                }
            } else if (code == 400 || code == 401) {
                signOut()
            }
        }
    }

    private fun persist() {
        val s = session ?: return
        prefs?.edit()
            ?.putString("access", s.accessToken)
            ?.putString("refresh", s.refreshToken)
            ?.putLong("exp", s.expiresAt)
            ?.apply()
    }

    private fun now(): Long = System.currentTimeMillis() / 1000

    private fun jwtExpiry(jwt: String): Long? = jwtClaim(jwt) { it.optLong("exp").takeIf { e -> e > 0 } }

    /// The `sub` (user id) claim — identity discriminator for account switches.
    private fun jwtSub(jwt: String): String? = jwtClaim(jwt) { it.optString("sub").takeIf { s -> s.isNotEmpty() } }

    private fun <T> jwtClaim(jwt: String, pick: (JSONObject) -> T?): T? = runCatching {
        val payload = jwt.split(".").getOrNull(1) ?: return null
        val json = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
        pick(JSONObject(json))
    }.getOrNull()
}
