package vn.eno.native_.messages

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import vn.eno.native_.core.Auth
import vn.eno.native_.core.Format
import vn.eno.native_.core.L10n
import vn.eno.native_.ui.WebTab

// The Messages tab (Android port of apps/ios InboxView): native inbox with the
// eno-AI pinned row, offer-aware preview line, unread rail + count, and
// swipe-free delete (long-press). Guest → sign-in hero that opens the web
// /signin in Kyle's origin-scoped WebTab; the enoAuth bridge flips isSignedIn
// live. Inbox↔thread nav is INTERNAL to this composable so the app's NavHost
// (MainActivity, Kyle's) needs no change to host it.

internal fun hexColor(hex: String?): Color? {
    val h = hex?.removePrefix("#") ?: return null
    return runCatching { Color(("FF$h").toLong(16)) }.getOrNull()
}

class InboxViewModel : ViewModel() {
    private val _convos = MutableStateFlow<List<InboxConvo>>(emptyList())
    val convos: StateFlow<List<InboxConvo>> = _convos
    var loaded by mutableStateOf(false)
        private set
    var actionError by mutableStateOf<String?>(null)

    fun clearError() { actionError = null }

    fun load() {
        viewModelScope.launch {
            runCatching { msgGet<InboxResponse>("api/conversations") }.getOrNull()?.let {
                _convos.value = it.conversations
                loaded = true
            }
        }
    }

    // Review #12: the row used to disappear whether or not the server agreed, so
    // a 403/429/500 — or no network at all — left the user believing a
    // conversation was deleted until it reappeared on the next refresh.
    // NOTE: msgSendStatus returns 0 when the request never completed.
    fun delete(convo: InboxConvo) {
        val idx = _convos.value.indexOfFirst { it.id == convo.id }
        if (idx < 0) return
        _convos.value = _convos.value.filterNot { it.id == convo.id }
        viewModelScope.launch {
            val status = msgSendStatus("DELETE", "api/conversations/${convo.id}")
            // 404 = already gone server-side, which is the outcome we wanted.
            if (status !in 200..299 && status != 404) {
                // A concurrent load() may already have restored the row. Adding
                // it again would put two items with the same id in the list, and
                // LazyColumn keys by id — a duplicate key crashes the screen.
                _convos.value = _convos.value.let { cur ->
                    if (cur.any { it.id == convo.id }) cur
                    else cur.toMutableList().also { it.add(idx.coerceAtMost(it.size), convo) }
                }
                actionError = L10n.tr(
                    "Could not delete that conversation. Try again.",
                    "Không xóa được cuộc trò chuyện. Thử lại.",
                )
            }
        }
    }
}

@Composable
fun MessagesScreen() {
    val signedIn = Auth.isSignedIn
    var openThread by rememberSaveable { mutableStateOf<String?>(null) }

    // A sign-out while a thread is open must not strand the user in it.
    LaunchedEffect(signedIn) { if (!signedIn) openThread = null }

    if (!signedIn) {
        GuestHero()
        return
    }
    val id = openThread
    if (id != null) {
        BackHandler { openThread = null }
        ThreadScreen(convoId = id, onBack = { openThread = null })
    } else {
        Inbox(onOpen = { openThread = it })
    }
}

@Composable
private fun GuestHero() {
    val signedIn = Auth.isSignedIn
    var showSignIn by remember { mutableStateOf(false) }
    LaunchedEffect(signedIn) { if (signedIn) showSignIn = false }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.AutoMirrored.Outlined.Chat, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(16.dp))
        Text(
            L10n.tr("Sign in to see your messages.", "Đăng nhập để xem tin nhắn của bạn."),
            fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        Button(onClick = { showSignIn = true }) {
            Text(L10n.tr("Sign in", "Đăng nhập"), fontWeight = FontWeight.SemiBold)
        }
    }
    if (showSignIn) {
        // Full-screen web sign-in; the origin-scoped enoAuth bridge (Kyle's
        // WebTab) adopts the session → signedIn flips → this dismisses.
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { showSignIn = false }) { Text(L10n.tr("Close", "Đóng")) }
                }
                WebTab("/signin")
            }
        }
    }
}

@Composable
private fun Inbox(onOpen: (String) -> Unit) {
    val vm: InboxViewModel = viewModel()
    val convos by vm.convos.collectAsState()
    var aiOpen by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.load() }

    LazyColumn(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        item {
            // eno AI — synthetic pinned row (web parity: not a DB conversation).
            Row(
                Modifier.fillMaxWidth().clickable { aiOpen = true }.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(44.dp).background(MaterialTheme.colorScheme.primary, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("eno AI", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                    Text(
                        L10n.tr("Ask anything — find products by chat", "Hỏi bất cứ điều gì — tìm đồ bằng chat"),
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }

        items(convos, key = { it.id }) { c ->
            ConvoRow(c, onClick = { onOpen(c.id) }, onDelete = { vm.delete(c) })
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
        }

        if (vm.loaded && convos.isEmpty()) {
            item {
                Text(
                    L10n.tr(
                        "No messages yet. Tap \"Message\" on a listing to start a chat.",
                        "Chưa có tin nhắn. Nhấn \"Nhắn tin\" trên một tin đăng để bắt đầu.",
                    ),
                    fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
            }
        }
    }

    if (aiOpen) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { aiOpen = false }) { Text(L10n.tr("Close", "Đóng")) }
                }
                WebTab("/messages/ai")
            }
        }
    }

    vm.actionError?.let { err ->
        AlertDialog(
            onDismissRequest = { vm.clearError() },
            confirmButton = { TextButton(onClick = { vm.clearError() }) { Text("OK") } },
            text = { Text(err) },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConvoRow(c: InboxConvo, onClick: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val unreadBg = if (c.unread > 0) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.background
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .background(unreadBg)
                .combinedClickable(onClick = onClick, onLongClick = { menu = true })
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(44.dp).background(hexColor(c.counterpart.avatarColor) ?: MaterialTheme.colorScheme.primary, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    c.counterpart.name.take(1).uppercase(),
                    fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        c.counterpart.name, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (c.unread > 0) {
                        Spacer(Modifier.width(6.dp))
                        Box(
                            Modifier.background(MaterialTheme.colorScheme.primary, CircleShape).padding(horizontal = 6.dp, vertical = 1.dp),
                        ) { Text("${c.unread}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White) }
                    }
                }
                Text(
                    c.listingTitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                PreviewLine(c)
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(L10n.tr("Delete", "Xóa")) },
                onClick = { menu = false; onDelete() },
            )
        }
    }
}

// Offer-aware preview (conversation-list.tsx / iOS preview() rules).
@Composable
private fun PreviewLine(c: InboxConvo) {
    val sub = MaterialTheme.colorScheme.onSurfaceVariant
    val o = c.lastOffer
    if (o != null) {
        val amt = o.amount?.let { Format.vnd(it) } ?: ""
        when (o.status) {
            "accepted" -> Text(L10n.tr("✅ Offer accepted", "✅ Đã chấp nhận đề nghị"), fontSize = 13.sp, color = sub, maxLines = 1)
            "declined" -> Text(L10n.tr("❌ Offer declined", "❌ Đã từ chối đề nghị"), fontSize = 13.sp, color = sub, maxLines = 1)
            "countered" -> Text(L10n.tr("↩️ Counter-offer", "↩️ Đã trả giá khác"), fontSize = 13.sp, color = sub, maxLines = 1)
            else -> if (o.mine) {
                Text(L10n.tr("You offered $amt", "Bạn đề nghị $amt"), fontSize = 13.sp, color = sub, maxLines = 1)
            } else {
                Text(L10n.tr("💰 New offer: $amt", "💰 Đề nghị mới: $amt"), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, maxLines = 1)
            }
        }
    } else {
        Text(
            c.lastMessageText ?: L10n.tr("New conversation", "Cuộc trò chuyện mới"),
            fontSize = 13.sp,
            fontWeight = if (c.unread > 0) FontWeight.SemiBold else FontWeight.Normal,
            color = if (c.unread > 0) MaterialTheme.colorScheme.onBackground else sub,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}
