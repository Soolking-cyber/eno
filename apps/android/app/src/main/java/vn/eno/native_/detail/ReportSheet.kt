package vn.eno.native_.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import vn.eno.native_.core.*

// Shared report sheet (#32, web report-button.tsx parity): a reason radio +
// optional free-text detail → POST /api/report. Targets a listing and/or a
// seller and/or a conversation; the server derives severity + anti-abuse
// weighting from the reporter's own standing, so the client only submits.
// Auth-gated by the Bearer token; a 401 surfaces a sign-in hint inline.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportSheet(
    listingId: String? = null,
    sellerId: String? = null,
    conversationId: String? = null,
    onDismiss: () -> Unit,
) {
    var reason by remember { mutableStateOf<String?>(null) }
    var detailText by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Mirrors REASONS in report-button.tsx. A chat report is about the
    // person/exchange, not a listing — only scam/offensive/other apply.
    val reasons = remember(conversationId) {
        val all = listOf(
            "scam" to L10n.tr("Scam", "Lừa đảo"),
            "counterfeit" to L10n.tr("Counterfeit / fake goods", "Hàng giả / nhái"),
            "sold" to L10n.tr("Already sold / unavailable", "Đã bán / hết hàng"),
            "wrong-info" to L10n.tr("Wrong info (price, photos…)", "Thông tin sai (giá, ảnh…)"),
            "duplicate" to L10n.tr("Duplicate listing", "Tin trùng lặp"),
            "offensive" to L10n.tr("Offensive / harassment", "Nội dung phản cảm / quấy rối"),
            "other" to L10n.tr("Other", "Khác"),
        )
        if (conversationId != null) all.filter { it.first in setOf("scam", "offensive", "other") } else all
    }
    val header = when {
        conversationId != null -> L10n.tr("Report this conversation", "Báo cáo cuộc trò chuyện")
        sellerId != null && listingId == null -> L10n.tr("Report this seller", "Báo cáo người bán")
        else -> L10n.tr("Report this listing", "Báo cáo tin đăng")
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(20.dp).verticalScroll(rememberScrollState())) {
            Text(header, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(8.dp))
            reasons.forEach { (value, label) ->
                Row(
                    Modifier.fillMaxWidth().clickable { reason = value }.padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = reason == value, onClick = { reason = value })
                    Spacer(Modifier.width(6.dp))
                    Text(label, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = detailText, onValueChange = { detailText = it.take(1000) },
                label = { Text(L10n.tr("Details (optional)", "Chi tiết (không bắt buộc)")) },
                modifier = Modifier.fillMaxWidth(), maxLines = 4,
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    val r = reason ?: return@Button
                    if (submitting) return@Button   // Compose disables async — guard double-tap
                    submitting = true; error = null
                    scope.launch {
                        val payload = buildJsonObject {
                            put("reason", r)
                            listingId?.let { put("listingId", it) }
                            sellerId?.let { put("sellerId", it) }
                            conversationId?.let { put("conversationId", it) }
                            if (detailText.isNotBlank()) put("detail", detailText.trim())
                        }.toString()
                        val code = runCatching { Api.send("POST", "api/report", payload) }.getOrDefault(-1)
                        submitting = false
                        when {
                            code in 200..299 -> onDismiss()
                            code == 401 -> error = L10n.tr("Please sign in to report.", "Vui lòng đăng nhập để báo cáo.")
                            code == 429 -> error = L10n.tr("You've reported a lot recently — try later.", "Bạn đã báo cáo nhiều gần đây — thử lại sau.")
                            else -> error = L10n.tr("Could not send — try again.", "Không gửi được — thử lại.")
                        }
                    }
                },
                enabled = reason != null && !submitting,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (submitting) L10n.tr("Sending…", "Đang gửi…") else L10n.tr("Submit report", "Gửi báo cáo"))
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
