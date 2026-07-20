package vn.eno.native_.account

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import vn.eno.native_.core.*

@Serializable private data class DisputeCase(
    val id: String, val role: String, val reason: String, val status: String,
    val createdAt: String = "", val lastActivityAt: String = "", val listing: DisputeListing? = null,
)
@Serializable private data class DisputeListing(val id: String, val title: String, val image: String? = null)
@Serializable private data class DisputesEnvelope(val cases: List<DisputeCase> = emptyList())

// Native disputes list (#61/#14 Android parity). GET /api/disputes → both roles;
// tap opens the native case room. Wired from the Android Settings screen.
@Composable
fun DisputesScreen(onBack: () -> Unit) {
    var cases by remember { mutableStateOf<List<DisputeCase>?>(null) }
    var room by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        cases = runCatching { Api.get<DisputesEnvelope>("api/disputes").cases }.getOrNull() ?: emptyList()
    }
    room?.let { id -> DisputeRoomScreen(id, onBack = { room = null }); return }

    Column(Modifier.fillMaxSize()) {
        BackBar(L10n.tr("Disputes", "Khiếu nại"), onBack)
        val list = cases
        when {
            list == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            list.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(L10n.tr("No disputes", "Chưa có khiếu nại nào"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn {
                items(list) { c ->
                    Row(Modifier.fillMaxWidth().clickable { room = c.id }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(model = c.listing?.image?.let { ImageUrl.optimized(it, 120) }, contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.listing?.title ?: L10n.tr("Account dispute", "Khiếu nại tài khoản"),
                                fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, color = MaterialTheme.colorScheme.onBackground)
                            Row {
                                Text(if (c.role == "reporter") L10n.tr("You filed", "Bạn gửi") else L10n.tr("About you", "Về bạn"),
                                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(" · ", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(statusLabel(c.status), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = statusColor(c.status))
                            }
                        }
                        Text("›", fontSize = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }
}

@Serializable private data class DisputeRoom(
    val id: String, val role: String, val reason: String, val status: String, val stage: String,
    val canPost: Boolean = false, val submitted: Boolean = false, val withdrawn: Boolean = false,
    val decisionNote: String? = null, val counterparty: String? = null,
    val listing: DisputeListing? = null, val timeline: List<TimelineItem> = emptyList(),
)
@Serializable private data class TimelineItem(
    val id: String, val kind: String, val role: String, val body: String = "", val images: List<String> = emptyList(), val at: String = "",
)

// Native dispute case room (#10 Android parity): stage stepper, evidence
// timeline (reporter identity shielded), one-shot statement+photos, withdraw.
@Composable
private fun DisputeRoomScreen(caseId: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var data by remember { mutableStateOf<DisputeRoom?>(null) }
    var loading by remember { mutableStateOf(true) }
    var statement by remember { mutableStateOf("") }
    var evidence by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() { data = runCatching { Api.get<DisputeRoom>("api/disputes/$caseId") }.getOrNull(); loading = false }
    LaunchedEffect(caseId) { reload() }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(6)) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            for (uri in uris) {
                if (evidence.size >= 6) break
                val url = runCatching {
                    val jpeg = withContext(Dispatchers.IO) { jpegOf(ctx, uri) }
                    Api.uploadImages(listOf(jpeg)).firstOrNull()
                }.getOrNull()
                if (url != null) evidence = evidence + url
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        BackBar(L10n.tr("Dispute", "Khiếu nại"), onBack)
        val d = data
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(L10n.tr("Couldn't load this case.", "Không tải được hồ sơ này.")) }
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                Text(reasonLabel(d.reason), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                d.listing?.let { l ->
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(model = l.image?.let { ImageUrl.optimized(it, 100) }, contentDescription = null, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
                        Spacer(Modifier.width(10.dp))
                        Text(l.title, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                    }
                }
                Spacer(Modifier.height(10.dp))
                // Stage stepper
                Row(Modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                    val stages = listOf("evidence", "review", "decided")
                    val labels = listOf(L10n.tr("Evidence", "Bằng chứng"), L10n.tr("Review", "Xem xét"), L10n.tr("Decided", "Kết luận"))
                    val idx = stages.indexOf(d.stage).coerceAtLeast(0)
                    labels.forEachIndexed { i, lb ->
                        val on = i <= idx
                        Text(lb, fontSize = 11.sp, fontWeight = if (i == idx) FontWeight.Bold else FontWeight.Medium,
                            color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.clip(CircleShape).background((if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant).copy(alpha = 0.1f)).padding(horizontal = 8.dp, vertical = 4.dp))
                        if (i < 2) Text(" › ", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                d.timeline.forEach { entry(d, it) }
                d.decisionNote?.takeIf { it.isNotEmpty() }?.let {
                    Spacer(Modifier.height(8.dp))
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)).padding(12.dp)) {
                        Text(L10n.tr("Decision", "Kết luận"), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onBackground)
                    }
                }
                if (d.canPost && !d.submitted) {
                    Spacer(Modifier.height(12.dp))
                    Text(L10n.tr("Your response (one submission)", "Phản hồi của bạn (một lần)"), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                    OutlinedTextField(value = statement, onValueChange = { statement = it }, minLines = 3,
                        label = { Text(L10n.tr("Explain your side…", "Giải thích phía bạn…")) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (evidence.isNotEmpty()) Text("${evidence.size}/6", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !busy && evidence.size < 6) {
                            Text(L10n.tr("Add photos", "Thêm ảnh"))
                        }
                        if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    }
                    err?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
                    Button(
                        onClick = {
                            if (busy || (statement.trim().isEmpty() && evidence.isEmpty())) return@Button
                            busy = true; err = null
                            scope.launch {
                                val body = JSONObject().put("body", statement.trim()).put("images", JSONArray(evidence)).toString()
                                val code = runCatching { Api.send("POST", "api/disputes/$caseId/messages", body) }.getOrNull()
                                busy = false
                                if (code != null && code in 200..299) { statement = ""; evidence = emptyList(); reload() }
                                else err = if (code == 409) L10n.tr("The window is closed or you already responded.", "Đã hết hạn hoặc bạn đã phản hồi.") else L10n.tr("Couldn't submit. Try again.", "Không gửi được. Thử lại.")
                            }
                        },
                        enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    ) { Text(L10n.tr("Submit response", "Gửi phản hồi")) }
                } else if (d.submitted) {
                    Spacer(Modifier.height(10.dp))
                    Text(L10n.tr("You've submitted your response.", "Bạn đã gửi phản hồi."), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (d.role == "reporter" && d.status == "open" && !d.withdrawn) {
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = {
                        scope.launch { val code = runCatching { Api.send("POST", "api/disputes/$caseId/withdraw", "{}") }.getOrNull(); if (code != null && code in 200..299) reload() }
                    }) { Text(L10n.tr("Withdraw this report", "Rút lại báo cáo"), color = MaterialTheme.colorScheme.error) }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun entry(d: DisputeRoom, item: TimelineItem) {
    val author = when (item.role) {
        "reporter" -> if (d.role == "reporter") L10n.tr("You", "Bạn") else L10n.tr("The reporter", "Người báo cáo")
        "respondent" -> if (d.role == "respondent") L10n.tr("You", "Bạn") else (d.counterparty ?: L10n.tr("The seller", "Người bán"))
        else -> L10n.tr("eno.vn moderation", "Kiểm duyệt eno.vn")
    }
    Column(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(9.dp)).background(MaterialTheme.colorScheme.surface).padding(10.dp)) {
        Text(author, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (item.kind == "decision") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground)
        if (item.body.isNotEmpty()) Text(item.body, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (item.images.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                item.images.forEach { url ->
                    AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop,
                        modifier = Modifier.size(72.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
                }
            }
        }
    }
}

@Composable
private fun BackBar(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(L10n.tr("‹ Back", "‹ Quay lại"), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onBack))
        Spacer(Modifier.width(12.dp))
        Text(title, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
}

private fun statusLabel(s: String): String = when (s) {
    "open" -> L10n.tr("Open", "Đang mở"); "confirmed" -> L10n.tr("Upheld", "Đã xác nhận")
    "dismissed" -> L10n.tr("Dismissed", "Đã bác"); "abusive" -> L10n.tr("Rejected", "Bị từ chối")
    else -> s.replaceFirstChar { it.uppercase() }
}
@Composable private fun statusColor(s: String) = when (s) {
    "open" -> MaterialTheme.colorScheme.primary
    "confirmed" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}
private fun reasonLabel(r: String): String = when (r) {
    "scam" -> L10n.tr("Scam / fraud", "Lừa đảo"); "counterfeit" -> L10n.tr("Counterfeit", "Hàng giả")
    "misrepresentation" -> L10n.tr("Not as described", "Không đúng mô tả"); "offensive" -> L10n.tr("Offensive", "Xúc phạm")
    "spam" -> L10n.tr("Spam", "Spam"); else -> L10n.tr("Report", "Báo cáo")
}
private fun jpegOf(ctx: Context, uri: Uri): ByteArray {
    val bmp = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) } ?: error("decode")
    return ByteArrayOutputStream().use { out -> bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
}
