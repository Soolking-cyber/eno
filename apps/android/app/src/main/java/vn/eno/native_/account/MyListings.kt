package vn.eno.native_.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
    var deleteTarget by remember { mutableStateOf<MyListing?>(null) }

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
                    onEdit = { editId = l.id },
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
