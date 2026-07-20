package vn.eno.native_.post

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import vn.eno.native_.core.Api
import java.io.ByteArrayOutputStream

// Server /api/ai/classify response (used only as the fallback below).
@Serializable
data class ClassifyResult(
    val categorySlug: String? = null,
    val subcategorySlug: String? = null,
    val listingType: String? = null,
    val condition: String? = null,
    val title: String? = null,
    val brand: String? = null,
    val brandUncertain: Boolean? = null,
    val model: String? = null,
    val unclear: Boolean? = null,
)

// ON-DEVICE listing autofill for Android (owner: "android do same for major
// brands samsung pixel oppo etc"). ML Kit image labeling + text recognition run
// FREE / private / offline on EVERY Android brand (they bundle their models —
// no Play Services download, no Gemini-Nano device gate). Labels + OCR are
// mapped to the marketplace taxonomy + a brand list entirely on-device. Returns
// null only when it can't map confidently → the caller falls back to the paid,
// login-gated server /api/ai/classify. (Gemini Nano via ML Kit GenAI could
// sharpen titles on Pixel/Samsung flagships later, but it excludes Oppo/others,
// so ML Kit vision is the correct universal base.)
object OnDeviceAI {

    private val labeler by lazy { ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS) }
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    suspend fun classify(bitmap: Bitmap): ClassifyResult? {
        val input = InputImage.fromBitmap(bitmap, 0)
        val labels = runCatching { labeler.process(input).await() }.getOrNull()
            ?.filter { it.confidence > 0.5f }?.map { it.text.lowercase() } ?: emptyList()
        val ocr = runCatching { recognizer.process(input).await() }.getOrNull()?.text ?: ""

        val slug = bestCategory(labels, ocr) ?: return null // can't place it → let the server / user decide
        val brand = detectBrand(ocr)
        val topLabel = labels.firstOrNull()?.replaceFirstChar { it.uppercase() }
        val title = listOfNotNull(brand, topLabel).joinToString(" ").ifBlank { null }
        return ClassifyResult(
            categorySlug = slug,
            title = title?.take(140),
            brand = brand,
            brandUncertain = brand == null,
            // Condition is left for the seller (a photo rarely proves new vs used).
        )
    }

    // Score each category by keyword hits across the labels + OCR; the best wins.
    private fun bestCategory(labels: List<String>, ocr: String): String? {
        val hay = (labels.joinToString(" ") + " " + ocr).lowercase()
        var best: String? = null
        var bestScore = 0
        for ((slug, keys) in CATEGORY_KEYWORDS) {
            val score = keys.count { hay.contains(it) }
            if (score > bestScore) { bestScore = score; best = slug }
        }
        return if (bestScore >= 1) best else null
    }

    private fun detectBrand(ocr: String): String? {
        val lower = ocr.lowercase()
        return BRANDS.firstOrNull { lower.contains(it.lowercase()) }
    }

    // Keyword → category slug (taxonomy.ts). Overlaps (bicycle, watch) resolve by
    // whichever category accumulates more hits.
    private val CATEGORY_KEYWORDS: Map<String, List<String>> = mapOf(
        "electronics" to listOf("phone", "mobile", "smartphone", "laptop", "computer", "tablet",
            "camera", "television", "headphone", "earphone", "earbud", "speaker", "keyboard",
            "mouse", "monitor", "console", "charger", "smartwatch", "electronic", "screen",
            "router", "drone", "printer"),
        "vehicles" to listOf("car", "motorcycle", "motorbike", "scooter", "moped", "vehicle",
            "automobile", "truck", "van", "wheel", "tire", "bicycle", "bike", "helmet"),
        "furniture-appliances" to listOf("sofa", "couch", "chair", "table", "desk", "bed",
            "mattress", "cabinet", "shelf", "wardrobe", "furniture", "refrigerator", "fridge",
            "washing machine", "microwave", "oven", "fan", "air conditioner", "lamp", "stove"),
        "fashion-beauty" to listOf("shirt", "t-shirt", "dress", "jeans", "trousers", "pants",
            "jacket", "coat", "shoe", "sneaker", "boot", "sandal", "footwear", "handbag", "bag",
            "backpack", "wallet", "sunglasses", "hat", "cap", "watch", "jewelry", "ring",
            "necklace", "clothing", "cosmetic", "perfume", "lipstick", "makeup"),
        "baby-kids" to listOf("toy", "doll", "teddy", "stroller", "pram", "crib", "baby"),
        "hobbies-sports" to listOf("ball", "football", "basketball", "guitar", "piano", "violin",
            "instrument", "dumbbell", "weight", "racket", "tennis", "skateboard", "fishing",
            "golf", "gym", "yoga", "skateboard"),
        "pets" to listOf("dog", "cat", "puppy", "kitten", "aquarium", "fish", "bird", "cage", "leash"),
        "property" to listOf("house", "apartment", "building", "bedroom", "kitchen", "real estate"),
        "tickets-travel" to listOf("luggage", "suitcase", "ticket", "travel"),
        "food-drink" to listOf("food", "fruit", "vegetable", "drink", "coffee", "tea", "snack",
            "meal", "dish", "wine", "cake", "bottle"),
    )

    private val BRANDS = listOf("Apple", "iPhone", "iPad", "MacBook", "Samsung", "Galaxy", "Sony",
        "Xiaomi", "Oppo", "Vivo", "Huawei", "Realme", "Nokia", "Google", "Pixel", "Dell", "HP",
        "Asus", "Acer", "Lenovo", "MSI", "Canon", "Nikon", "GoPro", "Bose", "JBL", "Marshall",
        "Nike", "Adidas", "Puma", "Gucci", "Chanel", "Zara", "Uniqlo", "Honda", "Yamaha", "Suzuki",
        "Toyota", "VinFast", "Piaggio", "Vespa", "Dyson", "Philips", "Panasonic", "Electrolux",
        "Toshiba", "Casio", "Rolex", "Seiko", "Logitech", "Razer", "Nintendo", "PlayStation", "Xbox", "LG")

    // Server fallback: the paid /api/ai/classify (multipart), used only when the
    // on-device map returns null. Auth-gated server-side (guest → 401 → null).
    suspend fun serverClassify(jpeg: ByteArray, lang: String): ClassifyResult? = runCatching {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", "photo.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .addFormDataPart("lang", lang)
            .build()
        val req = Request.Builder()
            .url("https://eno.vn/api/ai/classify")
            .header("User-Agent", "EnoNativeApp/1 android-native")
            .apply { Api.accessToken?.let { header("Authorization", "Bearer $it") } }
            .post(body)
            .build()
        Api.client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            Api.json.decodeFromString<ClassifyResult>(res.body!!.string())
        }
    }.getOrNull()

    fun jpeg(bitmap: Bitmap): ByteArray =
        ByteArrayOutputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it); it.toByteArray() }
}
