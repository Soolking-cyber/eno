package vn.eno.native_.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import vn.eno.native_.core.*

// Native notifications (Android port of apps/ios NotificationsView) over the
// web endpoints: GET /api/notifications (list + unread), POST
// /api/notifications/read (all read on open), rows deep-link to thread / PDP /
// web. Bell lives in the feed header; this is the list screen.
@Serializable
data class NotificationItem(
    val id: String,
    val title: String,
    val body: String? = null,
    val conversationId: String? = null,
    val listingId: String? = null,
    val url: String? = null,
    val read: Boolean = false,
    val createdAt: String = "",
)

@Serializable
data class NotificationsResponse(val notifications: List<NotificationItem> = emptyList(), val unread: Int = 0)

object Notifs {
    var items by mutableStateOf<List<NotificationItem>>(emptyList())
        private set
    var unread by mutableStateOf(0)
        private set
    var loaded by mutableStateOf(false)
        private set

    suspend fun refresh() {
        if (!Auth.isSignedIn) { unread = 0; return }
        runCatching { Api.get<NotificationsResponse>("api/notifications") }.getOrNull()?.let {
            items = it.notifications
            unread = it.unread
            loaded = true
        }
    }

    suspend fun openedList() {
        refresh()
        if (unread > 0) {
            runCatching { Api.send("POST", "api/notifications/read") }
            unread = 0
        }
    }

    suspend fun clearAll() {
        items = emptyList()
        unread = 0
        runCatching { Api.send("DELETE", "api/notifications") }
    }
}

@Composable
fun NotificationsScreen(onThread: (String) -> Unit, onListing: (String) -> Unit, onBack: () -> Unit) {
    LaunchedEffect(Unit) { Notifs.openedList() }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                L10n.tr("‹ Back", "‹ Quay lại"),
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onBack),
            )
            Spacer(Modifier.weight(1f))
            Text(
                L10n.tr("Notifications", "Thông báo"),
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.weight(1f))
            if (Notifs.items.isNotEmpty()) {
                val scope = rememberCoroutineScope()
                Text(
                    L10n.tr("Clear", "Xóa hết"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clickable { scope.launch { Notifs.clearAll() } },
                )
            } else {
                Spacer(Modifier.width(40.dp))
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        if (Notifs.loaded && Notifs.items.isEmpty()) {
            Text(
                L10n.tr("No notifications yet.", "Chưa có thông báo nào."),
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(24.dp),
            )
        }
        LazyColumn {
            items(Notifs.items, key = { it.id }) { n ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(if (n.read) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable {
                            when {
                                n.conversationId != null -> onThread(n.conversationId)
                                n.listingId != null -> onListing(n.listingId)
                            }
                        }
                        .padding(14.dp),
                ) {
                    Text(
                        n.title,
                        fontSize = 14.sp,
                        fontWeight = if (n.read) FontWeight.Medium else FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    n.body?.takeIf { it.isNotEmpty() }?.let {
                        Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}
