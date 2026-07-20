package vn.eno.native_.core

import androidx.compose.ui.graphics.Color
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ApiHttpException(val code: Int) : RuntimeException("http $code")

// Design tokens mirroring docs/design-language.md (same values as apps/ios
// Tokens.swift). Light/dark pairs resolve in EnoTheme.
object Palette {
    // EXACT globals.css light/dark pairs — de-blued TRUE-NEUTRAL ramp (parity #11).
    val brandLight = Color(0xFF0A66C2); val brandDark = Color(0xFF3B8EE6)
    val accentLight = Color(0xFF0A66C2); val accentDark = Color(0xFF74B3F2)   // accent-foreground (selection)
    val canvasLight = Color(0xFFFAFAFA); val canvasDark = Color(0xFF1B1B1B)
    val cardLight = Color(0xFFFFFFFF); val cardDark = Color(0xFF242424)
    val tintLight = Color(0xFFF5F5F5); val tintDark = Color(0xFF262626)       // neutral-100
    val fgLight = Color(0xFF171717); val fgDark = Color(0xFFF0F0F0)           // foreground/ink
    val subLight = Color(0xFF525252); val subDark = Color(0xFFCCCCCC)         // body neutral-600
    val ink4Light = Color(0xFF616161); val ink4Dark = Color(0xFFA0A0A0)       // meta/count
    val ringLight = Color(0xFFE5E5E5); val ringDark = Color(0xFF363636)       // border
    val lineStrongLight = Color(0xFFD4D4D4); val lineStrongDark = Color(0xFF414141)
    val dangerLight = Color(0xFFB91C1C); val dangerDark = Color(0xFFF0616B)
    val danger = dangerLight
}

// tr(en, vi) — device-language driven, mirroring the web contract.
object L10n {
    val isVi: Boolean = Locale.getDefault().language.startsWith("vi")
    fun tr(en: String, vi: String): String = if (isVi) vi else en
}

object Format {
    // src/lib/vnd.ts: VI dot-thousands + đ; EN comma + VND.
    fun vnd(amount: Long): String {
        val grouped = "%,d".format(amount).let {
            if (L10n.isVi) it.replace(',', '.') else it
        }
        return if (L10n.isVi) "$grouped đ" else "$grouped VND"
    }

    // "3h ago" / "3 giờ trước" from an ISO-8601 timestamp.
    fun ago(iso: String): String = runCatching {
        val secs = (System.currentTimeMillis() / 1000) - java.time.Instant.parse(iso).epochSecond
        when {
            secs < 3600 -> (secs / 60).coerceAtLeast(1).let { L10n.tr("${it}m ago", "$it phút trước") }
            secs < 86400 -> (secs / 3600).let { L10n.tr("${it}h ago", "$it giờ trước") }
            secs < 2592000 -> (secs / 86400).let { L10n.tr("${it}d ago", "$it ngày trước") }
            else -> (secs / 2592000).let { L10n.tr("${it}mo ago", "$it tháng trước") }
        }
    }.getOrDefault("")
}

object ImageUrl {
    fun optimized(raw: String, width: Int = 640): String =
        "https://eno.vn/_next/image?url=${java.net.URLEncoder.encode(raw, "UTF-8")}&w=$width&q=60"
}

// ── API client: same BFF as iOS (https://eno.vn/api/*), Bearer-ready ──
object Api {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    @Volatile var accessToken: String? = null

    /// Pre-request hook (iOS finding #5 parity): keeps the token fresh during
    /// active use. Wired to Auth.refreshIfNeeded at startup.
    @PublishedApi
    internal var ensureFreshToken: (suspend () -> Unit)? = null

    /// A token-bearing request came back 401 (review #3): force a refresh /
    /// sign-out so a server-revoked session can't brick the UI. Wired to
    /// Auth.handleUnauthorized at startup.
    @PublishedApi
    internal var onUnauthorized: (suspend () -> Unit)? = null

    // Fire the 401 hook only when we ACTUALLY sent a token (else guest 401s like
    // auth_required would sign a real session out or loop).
    @PublishedApi
    internal suspend fun handleStatus(code: Int, hadToken: Boolean) {
        if (code == 401 && hadToken) onUnauthorized?.invoke()
    }

    @PublishedApi
    internal val client = OkHttpClient.Builder().build()

    suspend inline fun <reified T> post(path: String, jsonBody: String): T =
        withContext(Dispatchers.IO) {
            ensureFreshToken?.invoke()
            val hadToken = accessToken != null
            val req = Request.Builder()
                .url("https://eno.vn/$path")
                .header("User-Agent", "EnoNativeApp/1 android-native")
                .apply { accessToken?.let { header("Authorization", "Bearer $it") } }
                .post(jsonBody.toRequestBody("application/json".toMediaType()))
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) { handleStatus(res.code, hadToken); throw ApiHttpException(res.code) }
                json.decodeFromString<T>(res.body!!.string())
            }
        }

    // Listing-photo upload: multipart 'files' to /api/upload (server strips
    // EXIF/GPS, downscales, watermarks, fingerprints). ≤3 files/request.
    suspend fun uploadImages(jpegs: List<ByteArray>): List<String> = withContext(Dispatchers.IO) {
        ensureFreshToken?.invoke()
        val hadToken = accessToken != null
        val urls = mutableListOf<String>()
        jpegs.chunked(3).forEach { chunk ->
            val bodyBuilder = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM)
            chunk.forEachIndexed { i, bytes ->
                bodyBuilder.addFormDataPart(
                    "files", "photo$i.jpg",
                    bytes.toRequestBody("image/jpeg".toMediaType()),
                )
            }
            val req = Request.Builder()
                .url("https://eno.vn/api/upload")
                .header("User-Agent", "EnoNativeApp/1 android-native")
                .apply { accessToken?.let { header("Authorization", "Bearer $it") } }
                .post(bodyBuilder.build())
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) { handleStatus(res.code, hadToken); throw ApiHttpException(res.code) }
                urls += json.decodeFromString<UploadResponse>(res.body!!.string()).urls
            }
        }
        urls
    }

    suspend fun send(method: String, path: String, jsonBody: String? = null): Int =
        withContext(Dispatchers.IO) {
            ensureFreshToken?.invoke()
            val hadToken = accessToken != null
            // OkHttp REQUIRES a non-null body for POST/PUT/PATCH — a null body
            // throws ("method POST must have a request body"), which crashed the
            // confirm-bump path and silently broke notification-read (codex
            // review, uncaught by the other pass). Supply an empty body for the
            // body-required verbs; DELETE stays bodyless.
            val body = jsonBody?.toRequestBody("application/json".toMediaType())
                ?: if (method in setOf("POST", "PUT", "PATCH")) ByteArray(0).toRequestBody(null) else null
            val req = Request.Builder()
                .url("https://eno.vn/$path")
                .header("User-Agent", "EnoNativeApp/1 android-native")
                .apply { accessToken?.let { header("Authorization", "Bearer $it") } }
                .method(method, body)
                .build()
            client.newCall(req).execute().use { handleStatus(it.code, hadToken); it.code }
        }

    suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T =
        withContext(Dispatchers.IO) {
            ensureFreshToken?.invoke()
            val hadToken = accessToken != null
            val url = StringBuilder("https://eno.vn/").append(path)
            if (query.isNotEmpty()) {
                url.append('?').append(query.entries.joinToString("&") {
                    "${it.key}=${java.net.URLEncoder.encode(it.value, "UTF-8")}"
                })
            }
            val req = Request.Builder()
                .url(url.toString())
                .header("User-Agent", "EnoNativeApp/1 android-native")
                .apply { accessToken?.let { header("Authorization", "Bearer $it") } }
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) { handleStatus(res.code, hadToken); throw ApiHttpException(res.code) }
                json.decodeFromString<T>(res.body!!.string())
            }
        }
}

// ── Codable mirrors (subset the feed + PDP need; unknown keys ignored) ──
@Serializable
data class CategoryRef(val id: String, val name: String, val nameVi: String, val slug: String)

@Serializable
data class CardSeller(val trustScore: Int, val isBusiness: Boolean)

@Serializable
data class ListingCard(
    val id: String,
    val title: String,
    val titleVi: String? = null,
    val price: Long,
    val negotiable: Boolean = true,
    val prevPrice: Long? = null,
    val urgent: Boolean = false,
    val location: String = "",
    val district: String? = null,
    val city: String = "",
    val images: List<String> = emptyList(),
    val video: String? = null,
    val goodPrice: Boolean = false,
    val postedAt: String = "",
    val savedCount: Int = 0,
    val category: CategoryRef,
    val seller: CardSeller,
) {
    val displayTitle: String get() = if (L10n.isVi) (titleVi ?: title) else title
    val displayLocation: String get() = listOfNotNull(district, city.ifEmpty { null }).joinToString(", ")
}

@Serializable
data class FeedPage(
    val listings: List<ListingCard>,
    val subcategoryCounts: Map<String, Int> = emptyMap(),
)

@Serializable
data class DetailSeller(
    val id: String,
    val name: String,
    val trustScore: Int = 100,
    val trustTier: String? = null,
    val rating: Double? = null,
    val reviewCount: Int = 0,
    val avatarColor: String? = null,
    val memberSince: String = "",
    val isBusiness: Boolean = false,
)

@Serializable
data class ListingDetail(
    val id: String,
    val title: String,
    val titleVi: String? = null,
    val description: String = "",
    val price: Long,
    val prevPrice: Long? = null,
    val urgent: Boolean = false,
    val negotiable: Boolean = true,
    val condition: String? = null,
    val year: Int? = null,
    val mileageKm: Int? = null,
    val images: List<String> = emptyList(),
    val video: String? = null,
    val district: String? = null,
    val city: String = "",
    val postedAt: String = "",
    val views: Int = 0,
    val savedCount: Int = 0,
    val contactCount: Int = 0,
    val seller: DetailSeller,
) {
    val displayTitle: String get() = if (L10n.isVi) (titleVi ?: title) else title
    val displayLocation: String get() = listOfNotNull(district, city.ifEmpty { null }).joinToString(", ")
}

// Market-price band (src/lib/price-stat.ts) — null below the sample floor.
@Serializable
data class PriceBand(val n: Int, val p25: Double, val median: Double, val p75: Double)

@Serializable
data class ListingDetailEnvelope(val listing: ListingDetail, val priceBand: PriceBand? = null)

// POST /api/conversations → find-or-create thread (id + whether it's new).
@Serializable
data class CreateConvoResponse(val id: String, val created: Boolean = false)

@Serializable
data class UploadResponse(val urls: List<String> = emptyList(), val failed: Int = 0)

// /api/geo?type=provinces|wards (VN admin units; two-level).
@Serializable
data class GeoUnit(val code: String, val name: String, val nameEn: String = "")

@Serializable
data class ProvincesResponse(val provinces: List<GeoUnit> = emptyList())

@Serializable
data class WardsResponse(val wards: List<GeoUnit> = emptyList())

// /api/categories — subcategories from the canonical TAXONOMY (optional fields
// tolerate a stale-CDN payload, same as iOS).
@Serializable
data class ApiSubcategory(val slug: String, val name: String, val nameVi: String, val icon: String? = null) {
    val displayName: String get() = if (L10n.isVi) nameVi else name
}

// /api/brands?category=&subcategory=&limit= → { brands: [{slug,name,count,iconPath}] }
@Serializable
data class BrandItem(val slug: String, val name: String, val count: Int = 0, val iconPath: String? = null)

@Serializable
data class BrandsResponse(val brands: List<BrandItem> = emptyList())

// /api/brands/[slug]/models?category=&subcategory= → { models: [{model,count}] }
@Serializable
data class ModelItem(val model: String, val count: Int = 0)

@Serializable
data class ModelsResponse(val models: List<ModelItem> = emptyList())

@Serializable
data class ApiCategory(
    val slug: String,
    val name: String,
    val nameVi: String,
    val subcategories: List<ApiSubcategory> = emptyList(),
)

@Serializable
data class CategoriesResponse(val categories: List<ApiCategory> = emptyList())

// One cached taxonomy fetch per app run (mirror of iOS Taxonomy).
object Taxonomy {
    private var cats: List<ApiCategory>? = null

    suspend fun subs(slug: String): List<ApiSubcategory> {
        if (cats == null) {
            cats = runCatching { Api.get<CategoriesResponse>("api/categories").categories }.getOrNull()
        }
        return cats?.firstOrNull { it.slug == slug }?.subcategories ?: emptyList()
    }
}

// Card badge rules (web card-badges.tsx, same as iOS): urgent > drop% > New(48h);
// goodPrice yields to a live drop.
val ListingCard.isNew: Boolean
    get() = runCatching {
        java.time.Instant.parse(postedAt).isAfter(java.time.Instant.now().minusSeconds(48 * 3600))
    }.getOrDefault(false)

val ListingCard.dropPercent: Int?
    get() {
        val prev = prevPrice ?: return null
        if (prev <= price || price <= 0) return null
        val pct = (((prev - price).toDouble() / prev) * 100).toInt()
        return if (pct > 0) minOf(pct, 50) else null
    }

// ≈USD approximation (web currencies.ts): /api/fx rates.USD per 1 VND, 12h cache.
object Fx {
    @Volatile private var usdPerVnd: Double = 0.0

    @Serializable
    private data class FxEnvelope(val rates: Map<String, Double> = emptyMap())

    suspend fun ensureLoaded() {
        if (usdPerVnd > 0) return
        usdPerVnd = runCatching { Api.get<FxEnvelope>("api/fx").rates["USD"] ?: 0.0 }.getOrDefault(0.0)
    }

    fun approxUSD(vnd: Long): String? {
        if (usdPerVnd <= 0 || vnd <= 0) return null
        return "≈ $" + "%,d".format((vnd * usdPerVnd).toLong())
    }
}

// The 15 top-level categories (mirror of apps/ios Categories.swift / taxonomy.ts).
data class AppCategory(val slug: String, val en: String, val vi: String) {
    val name: String get() = L10n.tr(en, vi)
}

object Categories {
    val all = listOf(
        AppCategory("vehicles", "Vehicles", "Xe cộ"),
        AppCategory("rentals", "Rentals", "Cho thuê"),
        AppCategory("property", "Property", "Nhà đất"),
        AppCategory("moving-sale", "Moving", "Thanh lý"),
        AppCategory("furniture-appliances", "Home", "Nhà cửa"),
        AppCategory("electronics", "Electronics", "Điện tử"),
        AppCategory("fashion-beauty", "Fashion", "Thời trang"),
        AppCategory("baby-kids", "Kids", "Mẹ & Bé"),
        AppCategory("hobbies-sports", "Hobbies", "Sở thích"),
        AppCategory("pets", "Pets", "Thú cưng"),
        AppCategory("jobs", "Jobs", "Việc làm"),
        AppCategory("services", "Services", "Dịch vụ"),
        AppCategory("community-events", "Community", "Cộng đồng"),
        AppCategory("tickets-travel", "Travel", "Du lịch"),
        AppCategory("food-drink", "Food", "Ẩm thực"),
    )
}
