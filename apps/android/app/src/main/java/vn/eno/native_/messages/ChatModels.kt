package vn.eno.native_.messages

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import vn.eno.native_.core.Api
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Codable mirrors of the conversations API (src/app/api/conversations/*),
// ported field-for-field from apps/ios Messages/ChatModels.swift — the iOS
// mirrors are the verified server contract. Unknown keys are ignored by
// Api.json, so server-side additions never break decoding.

// GET /api/conversations → { conversations: [...] } (newest-first, take 100)
@Serializable
data class InboxConvo(
    val id: String,
    val listingId: String = "",
    val listingTitle: String = "",
    val listingImage: String? = null,
    val lastMessageAt: String = "",
    val lastMessageText: String? = null,
    val lastOffer: LastOffer? = null,
    val unread: Int = 0,
    val counterpart: Counterpart,
) {
    @Serializable data class LastOffer(val mine: Boolean = false, val amount: Long? = null, val status: String? = null)
    @Serializable data class Counterpart(val name: String = "", val avatarColor: String? = null, val avatarUrl: String? = null)
}

@Serializable
data class InboxResponse(val conversations: List<InboxConvo> = emptyList())

// GET /api/conversations/[id] → thread + last 200 messages (chronological);
// opening clears the caller's unread server-side.
@Serializable
data class ChatThread(
    val id: String,
    val me: String = "",
    val iAmSeller: Boolean = false,
    val listing: ThreadListing,
    val counterpart: ThreadCounterpart,
    val messages: List<ChatMsg> = emptyList(),
) {
    @Serializable data class ThreadListing(
        val id: String,
        val title: String = "",
        val image: String? = null,
        val price: Long = 0,
        val negotiable: Boolean = true,
        val status: String? = null,
    )
    @Serializable data class ThreadCounterpart(
        val name: String = "",
        val avatarColor: String? = null,
        val avatarUrl: String? = null,
        val sellerId: String? = null,
    )
}

@Serializable
data class ChatMsg(
    val id: String,
    val mine: Boolean = false,
    val body: String = "",
    val createdAt: String = "",
    val kind: String? = null,
    val offerAmount: Long? = null,
    val offerStatus: String? = null,
) {
    // Client-side send states (never from the server) — carried across the
    // poll-merge so an in-flight bubble doesn't blink out. See ThreadViewModel.
    @kotlinx.serialization.Transient var pending: Boolean = false
    @kotlinx.serialization.Transient var failed: Boolean = false

    val isOffer: Boolean get() = kind == "offer"
}

@Serializable
data class UnreadResponse(val unread: Int = 0)

// ── Auth-aware network helpers (POST/DELETE that core/Api doesn't expose) ──
// Same conventions as Api.get: pre-request token freshness, native UA, Bearer.
// Kept in THIS package so Core.kt (Kyle's auth lane) stays untouched.
class HttpStatusException(val code: Int) : RuntimeException("http $code")

internal suspend inline fun <reified T> msgGet(path: String): T = withContext(Dispatchers.IO) {
    Api.ensureFreshToken?.invoke()
    val req = Request.Builder()
        .url("https://eno.vn/$path")
        .header("User-Agent", "EnoNativeApp/1 android-native")
        .apply { Api.accessToken?.let { header("Authorization", "Bearer $it") } }
        .build()
    Api.client.newCall(req).execute().use { res ->
        if (!res.isSuccessful) throw HttpStatusException(res.code)
        Api.json.decodeFromString<T>(res.body!!.string())
    }
}

internal suspend inline fun <reified T> msgPost(path: String, bodyJson: String): T = withContext(Dispatchers.IO) {
    Api.ensureFreshToken?.invoke()
    val req = Request.Builder()
        .url("https://eno.vn/$path")
        .header("User-Agent", "EnoNativeApp/1 android-native")
        .apply { Api.accessToken?.let { header("Authorization", "Bearer $it") } }
        .post(bodyJson.toRequestBody("application/json".toMediaType()))
        .build()
    Api.client.newCall(req).execute().use { res ->
        if (!res.isSuccessful) throw HttpStatusException(res.code)
        Api.json.decodeFromString<T>(res.body!!.string())
    }
}

// Fire a request where only the status matters (offer accept/decline, delete).
internal suspend fun msgSendStatus(method: String, path: String, bodyJson: String? = null): Int =
    withContext(Dispatchers.IO) {
        Api.ensureFreshToken?.invoke()
        val body = bodyJson?.toRequestBody("application/json".toMediaType())
        val builder = Request.Builder()
            .url("https://eno.vn/$path")
            .header("User-Agent", "EnoNativeApp/1 android-native")
            .apply { Api.accessToken?.let { header("Authorization", "Bearer $it") } }
        when (method) {
            "DELETE" -> if (body != null) builder.delete(body) else builder.delete()
            else -> builder.post(body ?: ByteArray(0).toRequestBody(null))
        }
        runCatching { Api.client.newCall(builder.build()).execute().use { it.code } }.getOrDefault(0)
    }

// ── date helpers (Core has none; local to messages) ──
internal object ChatTime {
    private val hm: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())
    private val md: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM").withZone(ZoneId.systemDefault())

    fun instant(iso: String): Instant? = runCatching { Instant.parse(iso) }.getOrNull()
    fun hourMinute(iso: String): String = instant(iso)?.let { hm.format(it) } ?: ""
    fun localDate(iso: String): LocalDate? = instant(iso)?.atZone(ZoneId.systemDefault())?.toLocalDate()
    fun shortDate(iso: String): String = instant(iso)?.let { md.format(it) } ?: ""
    fun secondsAgo(iso: String): Long = instant(iso)?.let { (System.currentTimeMillis() / 1000) - it.epochSecond } ?: Long.MAX_VALUE
}
