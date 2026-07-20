package vn.eno.native_.post

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
    data class Photo(val id: Long, val bitmap: Bitmap, var url: String? = null, var failed: Boolean = false)

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

    private var nextId = 0L

    val uploadedUrls: List<String> get() = photos.mapNotNull { it.url }
    val canSubmit: Boolean
        get() = uploadedUrls.size >= 3 && categorySlug != null &&
            title.trim().length >= 3 &&
            description.trim().length >= 20 &&
            priceText.filter { it.isDigit() }.isNotEmpty() &&
            contactPhone.count { it.isDigit() } >= 9 && !submitting

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

    fun pickProvince(p: GeoUnit) {
        province = p
        ward = null
        wards.clear()
        viewModelScope.launch {
            runCatching { Api.get<WardsResponse>("api/geo", mapOf("type" to "wards", "province" to p.code)).wards }
                .getOrNull()?.let { wards.addAll(it) }
        }
    }

    fun addPhoto(ctx: Context, uri: Uri) {
        if (photos.size >= 8) return
        viewModelScope.launch {
            val bmp = withContext(Dispatchers.IO) { decodeDownscaled(ctx, uri) } ?: return@launch
            val photo = Photo(nextId++, bmp)
            photos.add(photo)
            upload(photo.id)
        }
    }

    fun removePhoto(id: Long) { photos.removeAll { it.id == id } }

    fun retryPhoto(id: Long) {
        photos.find { it.id == id }?.failed = false
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
