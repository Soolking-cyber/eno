package vn.eno.native_.post

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONArray
import org.json.JSONObject
import vn.eno.native_.account.MeResponse
import vn.eno.native_.core.*
import java.io.ByteArrayOutputStream

@kotlinx.serialization.Serializable
data class CreateListingResponse(val id: String, val verified: Boolean = true)

// Post-a-listing (Android v1), mirroring apps/ios PostModel's core contract:
// photos upload immediately on pick (multipart /api/upload), then one JSON POST
// /api/listings. Required server-side: categorySlug + title(≥3) + contactPhone
// (≥9 digits) + price + ≥3 DISTINCT-ANGLE photos (dHash, server-enforced);
// phone numbers in any text are rejected (contact_in_text). Guest posting is
// allowed (identity rides the phone); the Bearer attaches when signed in.
// Per-category facets (year/km/brand) are a follow-up — the same order iOS took.
class PostViewModel : ViewModel() {
    // Immutable (review #6): updates go through .copy() so the SnapshotStateList
    // sees a new element and recomposes.
    data class Photo(val id: Long, val bitmap: Bitmap, val url: String? = null, val failed: Boolean = false)

    val photos = mutableStateListOf<Photo>()
    var categorySlug by mutableStateOf<String?>(null)
    var title by mutableStateOf("")
    var description by mutableStateOf("")
    var priceText by mutableStateOf("")
    var negotiable by mutableStateOf(true)
    var condition by mutableStateOf<String?>(null)
    var contactPhone by mutableStateOf("")
    val provinces = mutableStateListOf<GeoUnit>()
    val wards = mutableStateListOf<GeoUnit>()
    var province by mutableStateOf<GeoUnit?>(null)
    var ward by mutableStateOf<GeoUnit?>(null)
    var submitting by mutableStateOf(false)
    var errorMessage by mutableStateOf<String?>(null)
    var createdId by mutableStateOf<String?>(null)
    var autofilling by mutableStateOf(false)
    var autofillError by mutableStateOf<String?>(null)
    // Optional single clip (≤60s). No client compression yet (media3-transformer
    // is a follow-up), so a clip over the 50MB Supabase ceiling is refused.
    var videoUrl by mutableStateOf<String?>(null)
    var videoUploading by mutableStateOf(false)
    var videoError by mutableStateOf<String?>(null)

    private var nextId = 0L

    // ✨ AI auto-fill from the cover photo. Owner directive (2026-07-20): the
    // on-device model (ML Kit labels + OCR) is too weak — ALWAYS use the server
    // Gemini 3.5-flash classifier (/api/ai/classify). Login-gated (burns paid
    // credit), but posting is already auth-gated. OnDeviceAI.classify is kept in
    // the tree but no longer called.
    fun autofill(ctx: Context) {
        val bitmap = photos.firstOrNull()?.bitmap ?: run {
            autofillError = L10n.tr("Add a photo first.", "Thêm ảnh trước đã.")
            return
        }
        if (!Auth.isSignedIn) {
            autofillError = L10n.tr("Sign in to auto-fill with AI.", "Đăng nhập để điền tự động bằng AI.")
            return
        }
        autofilling = true
        autofillError = null
        viewModelScope.launch {
            try {
                val r = OnDeviceAI.serverClassify(OnDeviceAI.jpeg(bitmap), if (L10n.isVi) "vi" else "en")
                if (r == null) {
                    autofillError = L10n.tr("Couldn't read the item — pick the category below.",
                                            "Chưa nhận ra món đồ — chọn danh mục bên dưới.")
                    return@launch
                }
                r.categorySlug?.let { slug -> if (Categories.all.any { it.slug == slug }) categorySlug = slug }
                r.condition?.let { if (it == "new" || it == "used") condition = it }
                if (title.trim().isEmpty()) r.title?.let { if (it.isNotBlank()) title = it.take(140) }
            } finally {
                autofilling = false
            }
        }
    }

    val uploadedUrls: List<String> get() = photos.mapNotNull { it.url }
    val canSubmit: Boolean
        get() = uploadedUrls.size >= 3 && categorySlug != null &&
            title.trim().length >= 3 &&
            description.trim().length >= 20 &&
            priceText.filter { it.isDigit() }.isNotEmpty() &&
            contactPhone.count { it.isDigit() } >= 9 && !submitting && !videoUploading

    fun start() {
        viewModelScope.launch {
            if (Auth.isSignedIn && contactPhone.isEmpty()) {
                runCatching { Api.get<MeResponse>("api/me").user?.phone }.getOrNull()?.let { contactPhone = it }
            }
            if (provinces.isEmpty()) {
                runCatching { Api.get<ProvincesResponse>("api/geo", mapOf("type" to "provinces")).provinces }
                    .getOrNull()?.let { provinces.addAll(it) }
            }
        }
    }

    private var wardGen = 0
    fun pickProvince(p: GeoUnit) {
        province = p
        ward = null
        wards.clear()
        // Latest-wins (codex #11): switching provinces while a ward request is in
        // flight must not let the old province's wards populate the new one.
        val gen = ++wardGen
        viewModelScope.launch {
            val w = runCatching { Api.get<WardsResponse>("api/geo", mapOf("type" to "wards", "province" to p.code)).wards }.getOrNull()
            if (gen == wardGen && w != null) { wards.clear(); wards.addAll(w) }
        }
    }

    fun addPhoto(ctx: Context, uri: Uri) {
        // Re-check the cap AFTER the async decode (codex #12): the pre-decode
        // check alone let a burst of picks with 7 present overshoot to 15 while
        // the server keeps only 8.
        if (photos.size >= 8) return
        viewModelScope.launch {
            val bmp = withContext(Dispatchers.IO) { decodeDownscaled(ctx, uri) } ?: return@launch
            if (photos.size >= 8) return@launch
            val photo = Photo(nextId++, bmp)
            photos.add(photo)
            upload(photo.id)
        }
    }

    fun removePhoto(id: Long) { photos.removeAll { it.id == id } }

    @kotlinx.serialization.Serializable
    private data class VideoSign(val path: String, val token: String, val signedUrl: String)
    @kotlinx.serialization.Serializable
    private data class VideoDone(val url: String)

    // Add a single clip: read bytes → sign → PUT (raw, storage-js raw-body path)
    // → complete → canonical URL. The export step iOS does isn't available here
    // yet, so anything over the 50MB ceiling is refused rather than compressed.
    fun addVideo(ctx: Context, uri: Uri) {
        videoUploading = true
        videoError = null
        viewModelScope.launch {
            try {
                val app = ctx.applicationContext
                val mime = app.contentResolver.getType(uri) ?: "video/mp4"
                // Gate size + duration BEFORE reading any bytes: a big clip read
                // into a single ByteArray would OOM, and OutOfMemoryError is an
                // Error (not Exception) — it would escape catch and crash the app.
                val size = withContext(Dispatchers.IO) {
                    app.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
                }
                if (size <= 0L) {
                    videoError = L10n.tr("Couldn't read this video.", "Không đọc được video này."); return@launch
                }
                if (size > 50L * 1024 * 1024) {
                    videoError = L10n.tr("Video is too large (50MB max) — try a shorter clip.", "Video quá lớn (tối đa 50MB) — thử clip ngắn hơn."); return@launch
                }
                val durationMs = withContext(Dispatchers.IO) {
                    val r = MediaMetadataRetriever()
                    try {
                        r.setDataSource(app, uri)
                        r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                    } catch (_: Exception) { 0L } finally { r.release() }
                }
                if (durationMs > 61_000L) {
                    videoError = L10n.tr("Video must be 60 seconds or less.", "Video phải dài tối đa 60 giây."); return@launch
                }
                val sign = Api.post<VideoSign>("api/upload/video/sign",
                    JSONObject().put("type", mime).put("size", size).toString())
                val ok = withContext(Dispatchers.IO) {
                    // STREAM the bytes straight from the content Uri — never hold
                    // the whole clip in memory.
                    val streamBody = object : RequestBody() {
                        override fun contentType() = mime.toMediaType()
                        override fun contentLength() = size
                        override fun writeTo(sink: BufferedSink) {
                            app.contentResolver.openInputStream(uri)?.use { input -> sink.writeAll(input.source()) }
                                ?: throw java.io.IOException("no stream")
                        }
                    }
                    val req = Request.Builder()
                        .url(sign.signedUrl)
                        .put(streamBody)
                        .header("x-upsert", "false")
                        .header("cache-control", "max-age=31536000")
                        .build()
                    Api.client.newCall(req).execute().use { it.isSuccessful }
                }
                if (!ok) { videoError = L10n.tr("Upload failed. Try again.", "Tải lên thất bại. Thử lại."); return@launch }
                val done = Api.post<VideoDone>("api/upload/video/complete", JSONObject().put("path", sign.path).toString())
                videoUrl = done.url
            } catch (e: Exception) {
                videoError = L10n.tr("Couldn't add the video. Try again.", "Không thêm được video. Thử lại.")
            } finally {
                videoUploading = false
            }
        }
    }

    fun removeVideo() { videoUrl = null; videoError = null }

    fun retryPhoto(id: Long) {
        // Replace the element, don't mutate its field in place (review #6): a
        // SnapshotStateList tracks element identity, not a data class's internal
        // `var` — an in-place mutation wouldn't recompose the thumbnail.
        val idx = photos.indexOfFirst { it.id == id }
        if (idx >= 0) photos[idx] = photos[idx].copy(failed = false)
        viewModelScope.launch { upload(id) }
    }

    private suspend fun upload(id: Long) {
        val photo = photos.find { it.id == id } ?: return
        val jpeg = withContext(Dispatchers.IO) {
            ByteArrayOutputStream().use { out -> photo.bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
        }
        runCatching { Api.uploadImages(listOf(jpeg)) }
            .onSuccess { urls ->
                val idx = photos.indexOfFirst { it.id == id }
                if (idx >= 0) {
                    if (urls.isNotEmpty()) photos[idx] = photos[idx].copy(url = urls.first())
                    else photos[idx] = photos[idx].copy(failed = true)
                }
            }
            .onFailure {
                val idx = photos.indexOfFirst { it.id == id }
                if (idx >= 0) photos[idx] = photos[idx].copy(failed = true)
            }
    }

    fun submit() {
        val slug = categorySlug ?: return
        submitting = true
        errorMessage = null
        viewModelScope.launch {
            try {
                val body = JSONObject().apply {
                    put("categorySlug", slug)
                    put("title", title.trim())
                    put("price", priceText.filter { it.isDigit() }.toLong())
                    put("contactPhone", contactPhone)
                    put("negotiable", negotiable)
                    put("images", JSONArray(uploadedUrls))
                    videoUrl?.let { put("video", it) }
                    if (description.trim().isNotEmpty()) put("description", description.trim())
                    condition?.let { put("condition", it) }
                    province?.let {
                        put("city", it.name)
                        put("district", ward?.name ?: it.name)
                        put("location", ward?.name ?: it.name)
                    }
                }
                val r = Api.post<CreateListingResponse>("api/listings", body.toString())
                createdId = r.id
                reset()
            } catch (e: ApiHttpException) {
                errorMessage = explain(e.code)
            } catch (e: Exception) {
                errorMessage = L10n.tr("Could not post. Check your connection and try again.",
                    "Không đăng được. Kiểm tra kết nối rồi thử lại.")
            } finally {
                submitting = false
            }
        }
    }

    private fun reset() {
        photos.clear(); title = ""; description = ""; priceText = ""; negotiable = true; condition = null
        videoUrl = null; videoError = null
    }

    private fun explain(code: Int): String = when (code) {
        400 -> L10n.tr(
            "Check your listing: at least 3 photos from different angles, and no phone numbers or links in the text.",
            "Kiểm tra tin đăng: cần ít nhất 3 ảnh chụp các góc khác nhau, và không để số điện thoại hay liên kết trong nội dung.")
        409 -> L10n.tr("This looks like a duplicate, or the phone number belongs to another account.",
            "Tin này trùng lặp, hoặc số điện thoại thuộc tài khoản khác.")
        429 -> L10n.tr("Too many listings for now — try again later.", "Bạn đăng hơi nhiều — thử lại sau nhé.")
        403 -> L10n.tr("Your account can't post right now.", "Tài khoản của bạn hiện chưa thể đăng tin.")
        else -> L10n.tr("Could not post. Try again.", "Không đăng được. Thử lại.")
    }

    companion object {
        val conditions = listOf("new" to ("New / Like new" to "Mới / Như mới"), "used" to ("Used" to "Đã dùng"))

        val categories: List<AppCategory> get() = Categories.all

        // Decode a picked image downscaled to ≤2000px longest edge (server re-scales to 1600).
        private fun decodeDownscaled(ctx: Context, uri: Uri, maxEdge: Int = 2000): Bitmap? {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxEdge) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            return ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        }
    }
}

@kotlinx.serialization.Serializable
data class MeResponse(val user: MeUser? = null) {
    @kotlinx.serialization.Serializable
    data class MeUser(val phone: String? = null)
}
