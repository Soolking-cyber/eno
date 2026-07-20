package vn.eno.native_.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import vn.eno.native_.core.*

// Native seller self-service (Android port of apps/ios MyListingsView): own
// listings from GET /api/dashboard, stats strip, per-listing actions over the
// owner-scoped endpoints — confirm (bump), mark sold, hide, reactivate, delete.
@Serializable
data class MyListing(
    val id: String,
    val title: String,
    val titleVi: String? = null,
    val price: Long,
    val images: List<String> = emptyList(),
    val status: String? = null,
    val verified: Boolean = true,
    val views: Int = 0,
    val contactCount: Int = 0,
    // Prefill fields for the native quick-edit (#131) — the dashboard carries them.
    val description: String = "",
    val negotiable: Boolean = true,
) {
    val displayTitle: String get() = if (L10n.isVi) (titleVi ?: title) else title
}

@Serializable
data class DashboardResponse(val dashboard: Dash? = null) {
    @Serializable data class Dash(val listings: List<MyListing> = emptyList(), val stats: Stats = Stats())
    @Serializable data class Stats(val totalViews: Int = 0, val totalLeads: Int = 0, val activeCount: Int = 0, val soldCount: Int = 0)
}

@Composable
fun MyListingsScreen(onBack: () -> Unit) {
    var data by remember { mutableStateOf<DashboardResponse.Dash?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        data = runCatching { Api.get<DashboardResponse>("api/dashboard").dashboard }.getOrNull()
    }
    LaunchedEffect(Unit) { load() }

    var editId by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<MyListing?>(null) }
    var deleteTarget by remember { mutableStateOf<MyListing?>(null) }
    var discountTarget by remember { mutableStateOf<MyListing?>(null) }

    fun act(id: String, block: suspend () -> Unit) = scope.launch {
        block()
        load()
    }

    // Edit opens the listing's web page in a sheet (the full edit wizard).
    editId?.let { id ->
        Column(Modifier.fillMaxSize()) {
            Text(
                L10n.tr("‹ Back", "‹ Quay lại"),
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable { editId = null; scope.launch { load() } }.padding(14.dp),
            )
            vn.eno.native_.ui.WebTab("/listings/$id")
        }
        return
    }

    deleteTarget?.let { t ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(L10n.tr("Delete this listing?", "Xóa tin này?")) },
            text = { Text(L10n.tr("This can't be undone.", "Không thể hoàn tác.")) },
            confirmButton = {
                TextButton(onClick = {
                    act(t.id) { Api.send("DELETE", "api/listings/${t.id}") }
                    deleteTarget = null
                }) { Text(L10n.tr("Delete", "Xóa"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text(L10n.tr("Cancel", "Hủy")) } },
        )
    }

    discountTarget?.let { t ->
        DiscountSheet(t.price, onDismiss = { discountTarget = null }) { newPrice ->
            act(t.id) { Api.send("PATCH", "api/listings/${t.id}", """{"price":$newPrice}""") }
            discountTarget = null
        }
    }

    editTarget?.let { t ->
        EditSheet(
            t,
            onDismiss = { editTarget = null },
            onMoreOptions = { editTarget = null; editId = t.id },
            // Returns true only on a 2xx PATCH; the sheet stays open + shows an
            // error otherwise. runCatching keeps an airplane-mode IOException from
            // escaping the coroutine (which would crash the app).
            onSave = { title, price, description, negotiable ->
                val body = org.json.JSONObject()
                    .put("title", title).put("description", description)
                    .put("price", price).put("negotiable", negotiable)
                    .toString()
                val code = runCatching { Api.send("PATCH", "api/listings/${t.id}", body) }.getOrNull()
                val ok = code != null && code in 200..299
                if (ok) load()
                ok
            },
        )
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                L10n.tr("‹ Back", "‹ Quay lại"),
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onBack),
            )
            Spacer(Modifier.width(12.dp))
            Text(L10n.tr("My listings", "Tin đăng của tôi"), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        data?.stats?.let { s ->
            Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard("${s.totalViews}", L10n.tr("Views", "Lượt xem"), Modifier.weight(1f))
                StatCard("${s.totalLeads}", L10n.tr("Leads", "Liên hệ"), Modifier.weight(1f))
                StatCard("${s.activeCount}", L10n.tr("Active", "Đang đăng"), Modifier.weight(1f))
                StatCard("${s.soldCount}", L10n.tr("Sold", "Đã bán"), Modifier.weight(1f))
            }
        }
        LazyColumn {
            items(data?.listings ?: emptyList(), key = { it.id }) { l ->
                ListingRow(
                    l,
                    onConfirm = { act(l.id) { Api.send("POST", "api/listings/${l.id}/confirm") } },
                    onSold = { act(l.id) { Api.send("POST", "api/listings/${l.id}/status", """{"status":"sold"}""") } },
                    onHide = { act(l.id) { Api.send("POST", "api/listings/${l.id}/status", """{"status":"hidden"}""") } },
                    onReactivate = { act(l.id) { Api.send("POST", "api/listings/${l.id}/status", """{"status":"active"}""") } },
                    onDiscount = { discountTarget = l },
                    onEdit = { editTarget = l },
                    onDelete = { deleteTarget = l },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

@Composable
private fun StatCard(value: String, label: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ListingRow(
    l: MyListing,
    onConfirm: () -> Unit,
    onSold: () -> Unit,
    onHide: () -> Unit,
    onReactivate: () -> Unit,
    onDiscount: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(
            model = l.images.firstOrNull()?.let { ImageUrl.optimized(it, 96) },
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(l.displayTitle, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, color = MaterialTheme.colorScheme.onBackground)
            Text(Format.vnd(l.price), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusChip(l)
                Spacer(Modifier.width(8.dp))
                val meta = MaterialTheme.colorScheme.onSurfaceVariant
                Icon(Icons.Outlined.Visibility, null, Modifier.size(12.dp), tint = meta)
                Spacer(Modifier.width(3.dp))
                Text("${l.views}", fontSize = 11.sp, color = meta)
                Spacer(Modifier.width(8.dp))
                Icon(Icons.Outlined.ChatBubbleOutline, null, Modifier.size(12.dp), tint = meta)
                Spacer(Modifier.width(3.dp))
                Text("${l.contactCount}", fontSize = 11.sp, color = meta)
            }
        }
        Box {
            Icon(Icons.Filled.MoreVert, contentDescription = L10n.tr("Actions", "Tùy chọn"),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable { menu = true }.padding(8.dp).size(20.dp))
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (l.status == "active") {
                    DropdownMenuItem(text = { Text(L10n.tr("Still available (bump)", "Còn hàng (đẩy tin)")) }, onClick = { menu = false; onConfirm() })
                    DropdownMenuItem(text = { Text(L10n.tr("Mark sold", "Đã bán")) }, onClick = { menu = false; onSold() })
                    DropdownMenuItem(text = { Text(L10n.tr("Lower the price", "Giảm giá")) }, onClick = { menu = false; onDiscount() })
                    DropdownMenuItem(text = { Text(L10n.tr("Hide", "Ẩn tin")) }, onClick = { menu = false; onHide() })
                } else {
                    DropdownMenuItem(text = { Text(L10n.tr("Reactivate", "Đăng lại")) }, onClick = { menu = false; onReactivate() })
                }
                DropdownMenuItem(text = { Text(L10n.tr("View / edit", "Xem / sửa")) }, onClick = { menu = false; onEdit() })
                DropdownMenuItem(text = { Text(L10n.tr("Delete", "Xóa")) }, onClick = { menu = false; onDelete() })
            }
        }
    }
}

// Native quick-edit (#131) — replaces the web edit fallback for the fields
// sellers change most: title / price / negotiable / description, saved via
// PATCH. Photos + category stay on the web wizard behind "More options". The
// PATCH body is JSON-encoded (JSONObject escapes the free text safely).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditSheet(
    l: MyListing,
    onDismiss: () -> Unit,
    onMoreOptions: () -> Unit,
    onSave: suspend (String, Long, String, Boolean) -> Boolean,
) {
    var title by remember { mutableStateOf(l.title) }
    var priceText by remember { mutableStateOf(l.price.toString()) }
    var description by remember { mutableStateOf(l.description) }
    var negotiable by remember { mutableStateOf(l.negotiable) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // Never save a 0đ (free) listing: the price must be a positive number.
    val priceVal = priceText.filter { it.isDigit() }.toLongOrNull()
    val valid = title.trim().length >= 3 && priceVal != null && priceVal > 0
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(L10n.tr("Edit listing", "Sửa tin"), fontSize = 18.sp, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = title, onValueChange = { title = it },
                label = { Text(L10n.tr("Title", "Tiêu đề")) }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = priceText, onValueChange = { v -> priceText = v.filter { it.isDigit() } },
                label = { Text(L10n.tr("Price (₫)", "Giá (₫)")) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = negotiable, onCheckedChange = { negotiable = it })
                Spacer(Modifier.width(8.dp))
                Text(L10n.tr("Accept offers", "Cho phép trả giá"), color = MaterialTheme.colorScheme.onSurface)
            }
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = description, onValueChange = { description = it },
                label = { Text(L10n.tr("Description", "Mô tả")) }, minLines = 3, maxLines = 8, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onMoreOptions) {
                Text(L10n.tr("More options (photos, category…)", "Thêm tùy chọn (ảnh, danh mục…)"))
            }
            error?.let {
                Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    if (!valid || saving) return@Button
                    saving = true; error = null
                    scope.launch {
                        val ok = onSave(title.trim(), priceVal ?: 0L, description.trim(), negotiable)
                        saving = false
                        if (ok) onDismiss()
                        else error = L10n.tr("Couldn't save — check the fields and your connection.", "Không lưu được — kiểm tra thông tin và kết nối.")
                    }
                },
                enabled = valid && !saving, modifier = Modifier.fillMaxWidth(),
            ) {
                if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text(L10n.tr("Save changes", "Lưu thay đổi"))
            }
        }
    }
}

// QuickDiscount picker (#33, web quick-discount.tsx parity): preset % cuts + a
// slider; the new price is tidy-rounded (never 3.599.910 đ). Sends ONLY the new
// price via PATCH { price } — the server owns the drop-badge decision against its
// own 30-day reference; ≥20% is hinted as the badge floor.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiscountSheet(currentPrice: Long, onDismiss: () -> Unit, onApply: (Long) -> Unit) {
    var pct by remember { mutableStateOf(20f) }
    fun tidy(raw: Long): Long {
        val step = when { raw >= 1_000_000 -> 100_000L; raw >= 100_000 -> 10_000L; else -> 1_000L }
        return maxOf(1000L, Math.round(raw.toDouble() / step) * step)
    }
    val newPrice = tidy((currentPrice * (1 - pct / 100)).toLong())
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Text(L10n.tr("Lower the price", "Giảm giá"), fontSize = 18.sp, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Column {
                    Text(L10n.tr("Current price", "Giá hiện tại"), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(Format.vnd(currentPrice), fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                        textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("-${pct.toInt()}%", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    Text(Format.vnd(newPrice), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(10, 20, 30).forEach { p ->
                    val active = pct.toInt() == p
                    Text(
                        "-$p%", fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        color = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier.weight(1f).clip(CircleShape)
                            .background(if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                            .clickable { pct = p.toFloat() }.padding(vertical = 9.dp),
                    )
                }
            }
            Slider(value = pct, onValueChange = { pct = it }, valueRange = 1f..90f, steps = 88)
            if (pct >= 20) {
                Text(L10n.tr("A cut of 20% or more usually earns the price-drop badge.",
                             "Giảm từ 20% trở lên thường được gắn nhãn giảm giá."),
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = { onApply(newPrice) }, modifier = Modifier.fillMaxWidth()) {
                Text(L10n.tr("Apply new price", "Áp dụng giá mới"))
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun StatusChip(l: MyListing) {
    val (label, color) = when {
        !l.verified && l.status == "active" -> L10n.tr("Held", "Đang xét") to androidx.compose.ui.graphics.Color(0xFFF59E0B)
        l.status == "sold" -> L10n.tr("Sold", "Đã bán") to MaterialTheme.colorScheme.onSurfaceVariant
        l.status == "hidden" -> L10n.tr("Hidden", "Đã ẩn") to MaterialTheme.colorScheme.onSurfaceVariant
        else -> L10n.tr("Active", "Đang đăng") to androidx.compose.ui.graphics.Color(0xFF16A34A)
    }
    Text(
        label,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        color = color,
        modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.12f)).padding(horizontal = 7.dp, vertical = 2.dp),
    )
}
