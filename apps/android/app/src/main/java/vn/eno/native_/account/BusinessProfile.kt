package vn.eno.native_.account

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import vn.eno.native_.core.*

// Native business-storefront editor (#63/#21, Android parity with iOS). Public
// storefront (name/bio/location/contact/LOGO) + Đ.29 legal identity, prefilled
// from /api/dashboard; saved via PATCH /api/seller; logo via /api/upload → PATCH.
@Serializable
private data class SellerDashEnvelope(val dashboard: Dash? = null) {
    @Serializable data class Dash(val seller: Seller? = null)
    @Serializable data class Seller(
        val name: String? = null, val bio: String? = null, val location: String? = null, val phone: String? = null,
        val avatarUrl: String? = null,
        val legalName: String? = null, val legalAddress: String? = null, val idNumber: String? = null, val taxCode: String? = null,
    )
}

@Composable
fun BusinessProfileScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    var loading by remember { mutableStateOf(true) }
    var name by remember { mutableStateOf("") }
    var bio by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var legalName by remember { mutableStateOf("") }
    var legalAddress by remember { mutableStateOf("") }
    var idNumber by remember { mutableStateOf("") }
    var taxCode by remember { mutableStateOf("") }
    var logoUrl by remember { mutableStateOf<String?>(null) }
    var logoBusy by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val s = runCatching { Api.get<SellerDashEnvelope>("api/dashboard").dashboard?.seller }.getOrNull()
        s?.let {
            name = it.name ?: ""; bio = it.bio ?: ""; location = it.location ?: ""; phone = it.phone ?: ""
            legalName = it.legalName ?: ""; legalAddress = it.legalAddress ?: ""
            idNumber = it.idNumber ?: ""; taxCode = it.taxCode ?: ""; logoUrl = it.avatarUrl
        }
        loading = false
    }

    val logoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        logoBusy = true; msg = null
        scope.launch {
            val url = runCatching {
                val jpeg = withContext(Dispatchers.IO) { compressToJpeg(ctx, uri) }
                Api.uploadImages(listOf(jpeg)).firstOrNull()
            }.getOrNull()
            if (url != null) {
                val code = runCatching { Api.send("PATCH", "api/seller", JSONObject().put("avatarUrl", url).toString()) }.getOrNull()
                if (code != null && code in 200..299) { logoUrl = url; msg = L10n.tr("Logo updated", "Đã cập nhật logo") to true }
                else msg = L10n.tr("Couldn't save the logo.", "Không lưu được logo.") to false
            } else msg = L10n.tr("Couldn't upload the logo.", "Không tải được logo.") to false
            logoBusy = false
        }
    }

    val nameValid = name.trim().length >= 2

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(L10n.tr("‹ Back", "‹ Quay lại"), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(12.dp))
            Text(L10n.tr("Business profile", "Hồ sơ doanh nghiệp"), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            return
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            // Logo
            Row(verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(model = logoUrl?.let { ImageUrl.optimized(it, 120) }, contentDescription = null, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
                Spacer(Modifier.width(12.dp))
                if (logoBusy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else TextButton(onClick = { logoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    Text(if (logoUrl == null) L10n.tr("Add logo", "Thêm logo") else L10n.tr("Change logo", "Đổi logo"))
                }
            }
            Spacer(Modifier.height(12.dp))
            Field(name, { name = it }, L10n.tr("Business name", "Tên doanh nghiệp"))
            Field(bio, { bio = it }, L10n.tr("About", "Giới thiệu"), single = false)
            Field(location, { location = it }, L10n.tr("Address / area", "Địa chỉ / khu vực"))
            Field(phone, { phone = it }, L10n.tr("Contact phone", "SĐT liên hệ"), keyboard = KeyboardType.Phone)
            Spacer(Modifier.height(10.dp))
            Text(L10n.tr("Legal identity", "Thông tin pháp lý"), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
            Text(L10n.tr("Shown to buyers and authorities on request — never public.", "Chỉ cung cấp khi được yêu cầu — không công khai."),
                fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))
            Field(legalName, { legalName = it }, L10n.tr("Legal name", "Tên pháp lý"))
            Field(legalAddress, { legalAddress = it }, L10n.tr("Legal address", "Địa chỉ pháp lý"), single = false)
            Field(idNumber, { idNumber = it.filter { c -> c.isDigit() } }, L10n.tr("ID number", "Số CCCD/CMND"), keyboard = KeyboardType.Number)
            Field(taxCode, { taxCode = it }, L10n.tr("Tax code", "Mã số thuế"))
            msg?.let { Text(it.first, fontSize = 12.sp, color = if (it.second) Color0xFF16A34A else MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    if (!nameValid || saving) return@Button
                    saving = true; msg = null
                    scope.launch {
                        val body = JSONObject().put("name", name.trim()).put("bio", bio.trim()).put("location", location.trim())
                            .put("phone", phone.trim()).put("legalName", legalName.trim()).put("legalAddress", legalAddress.trim())
                            .put("idNumber", idNumber.trim()).put("taxCode", taxCode.trim()).toString()
                        val code = runCatching { Api.send("PATCH", "api/seller", body) }.getOrNull()
                        saving = false
                        msg = when {
                            code != null && code in 200..299 -> L10n.tr("Saved", "Đã lưu") to true
                            code == 409 -> L10n.tr("That phone is already used by another account.", "Số điện thoại đã được dùng.") to false
                            else -> L10n.tr("Check the fields — name, phone, ID (9–13 digits), tax code.", "Kiểm tra thông tin — tên, SĐT, CCCD (9–13 số), MST.") to false
                        }
                    }
                },
                enabled = nameValid && !saving, modifier = Modifier.fillMaxWidth(),
            ) { if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(L10n.tr("Save", "Lưu")) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun compressToJpeg(ctx: Context, uri: Uri): ByteArray {
    val bmp = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
        ?: error("decode")
    return ByteArrayOutputStream().use { out -> bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, single: Boolean = true, keyboard: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = single,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        minLines = if (single) 1 else 2,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    )
}

private val Color0xFF16A34A = androidx.compose.ui.graphics.Color(0xFF16A34A)
