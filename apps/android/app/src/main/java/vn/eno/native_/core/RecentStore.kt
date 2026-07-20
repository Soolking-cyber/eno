package vn.eno.native_.core

import android.content.Context
import org.json.JSONArray

// Device-local recency (mirror of apps/ios RecentStore): recently VIEWED
// listing ids feed the home rail via /api/listings?ids=; recent SEARCH terms
// feed the search screen's empty state.
object RecentStore {
    private const val PREFS = "eno"
    private const val VIEWED = "eno-recently-viewed"
    private const val SEARCHES = "eno-recent-searches"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun readList(ctx: Context, key: String): List<String> =
        runCatching {
            val arr = JSONArray(prefs(ctx).getString(key, "[]") ?: "[]")
            (0 until arr.length()).map { arr.getString(it) }
        }.getOrDefault(emptyList())

    private fun writeList(ctx: Context, key: String, list: List<String>) {
        val arr = JSONArray()
        list.forEach { arr.put(it) }
        prefs(ctx).edit().putString(key, arr.toString()).apply()
    }

    fun viewedIds(ctx: Context): List<String> = readList(ctx, VIEWED)

    fun recordViewed(ctx: Context, id: String) {
        val list = (listOf(id) + readList(ctx, VIEWED).filter { it != id }).take(12)
        writeList(ctx, VIEWED, list)
    }

    fun searches(ctx: Context): List<String> = readList(ctx, SEARCHES)

    fun recordSearch(ctx: Context, term: String) {
        val t = term.trim()
        if (t.length < 2) return
        val list = (listOf(t) + readList(ctx, SEARCHES).filter { !it.equals(t, ignoreCase = true) }).take(8)
        writeList(ctx, SEARCHES, list)
    }

    fun clearSearches(ctx: Context) = writeList(ctx, SEARCHES, emptyList())
}
