package vn.eno.native_.core

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray

// Device-local favorites (the web's design too — no per-user server state):
// ordered id list in SharedPreferences, anonymous aggregate-counter POST on
// toggle, fire-and-forget. Mirror of apps/ios FavoritesStore.
object Favorites {
    private const val PREFS = "eno"
    private const val KEY = "eno-favorites"

    val ids = mutableStateListOf<String>()
    private var loaded = false
    // Per-id debounced sync (review #11): rapid toggles no longer race the
    // anonymous counter into the wrong order. Each toggle cancels the pending
    // send for that id and schedules one that posts the NET final membership
    // after a short settle — so a save→unsave double-tap sends exactly one
    // {saved:false}, never a reordered pair that inflates savedCount.
    private val syncScope = CoroutineScope(Dispatchers.IO)
    private val pending = mutableMapOf<String, Job>()

    fun ensureLoaded(ctx: Context) {
        if (loaded) return
        loaded = true
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) ids.add(arr.getString(i))
        }
    }

    fun isFavorite(id: String): Boolean = id in ids

    fun toggle(ctx: Context, id: String) {
        if (id in ids) ids.remove(id) else ids.add(0, id)
        persist(ctx)
        val finalState = id in ids // net membership AFTER this toggle
        pending.remove(id)?.cancel()
        pending[id] = syncScope.launch {
            delay(450) // coalesce a rapid toggle burst into one net send
            runCatching {
                val body = """{"saved":$finalState}""".toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url("https://eno.vn/api/listings/$id/save")
                    .header("User-Agent", "EnoNativeApp/1 android-native")
                    .post(body)
                    .build()
                Api.client.newCall(req).execute().close()
            }
        }
    }

    fun prune(ctx: Context, requested: List<String>, returned: Set<String>) {
        val gone = requested.toSet() - returned
        if (gone.isEmpty()) return
        ids.removeAll(gone)
        persist(ctx)
    }

    private fun persist(ctx: Context) {
        val arr = JSONArray()
        ids.forEach { arr.put(it) }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }
}
