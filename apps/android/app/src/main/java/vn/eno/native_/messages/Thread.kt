package vn.eno.native_.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import vn.eno.native_.core.Format
import vn.eno.native_.core.ImageUrl
import vn.eno.native_.core.L10n
import java.time.LocalDate
import java.util.UUID
import kotlin.math.roundToInt

// Chat thread (Android port of apps/ios ThreadView, v13 — with the two
// confirmed iOS review fixes already in the source): chronological bubbles,
// day separators, offer CARDS derived from offerAmount/offerStatus (never the
// body) with Accept/Decline for the recipient and Counter gated by negotiable
// (landmine: the server 409s + docks trust on a fixed-price counter),
// first-contact safety note, optimistic sends with clientId idempotency +
// tap-to-retry, and a 12s poll backstop. A network-failed counter shows
// tap-to-retry (NOT a live pending offer — iOS #7), and offer accept/decline
// only reloads on a real 2xx and surfaces every other outcome (iOS #6).
class ThreadViewModel(val convoId: String) : ViewModel() {
    var thread by mutableStateOf<ChatThread?>(null)
        private set
    var notFound by mutableStateOf(false)
        private set
    var actionError by mutableStateOf<String?>(null)

    private var poller: kotlinx.coroutines.Job? = null

    fun clearError() { actionError = null }

    fun start() {
        if (poller != null) return
        poller = viewModelScope.launch {
            load()
            while (true) {
                delay(12_000)
                load()
            }
        }
    }

    suspend fun load() {
        try {
            val t = msgGet<ChatThread>("api/conversations/$convoId")
            val server = t.messages
            val serverIds = server.map { it.id }.toHashSet()
            // Duplication guard for the poll-vs-send race: a poll that STARTED
            // before a send committed returns the list WITHOUT it (would blink
            // the bubble out); a poll that finished AFTER returns the DB copy
            // while the local bubble is still pending. Keep pending/failed/
            // recent-own locals that the server hasn't echoed, but drop a
            // pending local whose content matches a recent own server message
            // (that IS the same message — let the late replace() no-op).
            val recentMineKeys = server.filter { it.mine }.takeLast(10)
                .map { "${it.body}|${it.offerAmount ?: -1}" }.toHashSet()
            val keep = thread?.messages.orEmpty().filter { m ->
                if (serverIds.contains(m.id)) return@filter false
                val key = "${m.body}|${m.offerAmount ?: -1}"
                when {
                    m.pending -> !recentMineKeys.contains(key)
                    m.failed -> true
                    m.mine && ChatTime.secondsAgo(m.createdAt) < 60 -> !recentMineKeys.contains(key)
                    else -> false
                }
            }
            thread = t.copy(messages = server + keep)
            notFound = false
        } catch (e: HttpStatusException) {
            if (e.code == 404 || e.code == 403) notFound = true
        } catch (_: Exception) { /* transient; the poll retries */ }
    }

    fun send(text: String) {
        val body = text.trim()
        if (body.isEmpty() || body.length > 2000) return
        deliver(JSONObject().put("body", body).put("clientId", UUID.randomUUID().toString()), body, null)
    }

    fun counter(amount: Long) {
        if (amount <= 0) return
        deliver(JSONObject().put("offerAmount", amount).put("clientId", UUID.randomUUID().toString()), "", amount)
    }

    private fun deliver(payload: JSONObject, localBody: String, offerAmount: Long?) {
        val localId = "local-${UUID.randomUUID()}"
        val local = ChatMsg(
            id = localId, mine = true, body = localBody,
            createdAt = java.time.Instant.now().toString(),
            kind = if (offerAmount != null) "offer" else "text",
            offerAmount = offerAmount, offerStatus = if (offerAmount != null) "pending" else null,
        ).apply { pending = true }
        thread = thread?.let { it.copy(messages = it.messages + local) }
        viewModelScope.launch {
            try {
                val sent = msgPost<ChatMsg>("api/conversations/$convoId/messages", payload.toString())
                replace(localId, sent)
                if (offerAmount != null) load() // a counter flips older offers server-side
            } catch (_: Exception) {
                mark(localId, failed = true)
            }
        }
    }

    fun retry(msg: ChatMsg) {
        if (!msg.failed) return
        thread = thread?.let { it.copy(messages = it.messages.filterNot { m -> m.id == msg.id }) }
        val amt = msg.offerAmount
        if (amt != null) counter(amt) else send(msg.body)
    }

    // iOS review #6: only reload on a real 2xx; surface every other outcome so a
    // swallowed failure can't leave optimistic accept/decline state standing.
    fun act(msg: ChatMsg, action: String) {
        viewModelScope.launch {
            val status = msgSendStatus(
                "POST", "api/conversations/$convoId/offer",
                JSONObject().put("messageId", msg.id).put("action", action).toString(),
            )
            when {
                status in 200..299 -> load()
                status == 409 -> {
                    actionError = L10n.tr("This offer can't be updated anymore.", "Đề nghị này không còn hiệu lực.")
                    load()
                }
                else -> actionError = L10n.tr("Could not update the offer. Try again.", "Không cập nhật được đề nghị. Thử lại.")
            }
        }
    }

    private fun replace(localId: String, server: ChatMsg) {
        val t = thread ?: return
        thread = if (t.messages.any { it.id == server.id }) {
            // The poll already delivered the server copy — drop the local bubble
            // instead of swapping (a swap would duplicate the id → crash LazyColumn).
            t.copy(messages = t.messages.filterNot { it.id == localId })
        } else {
            t.copy(messages = t.messages.map { if (it.id == localId) server else it })
        }
    }

    private fun mark(localId: String, failed: Boolean) {
        val t = thread ?: return
        thread = t.copy(messages = t.messages.map { m ->
            if (m.id == localId) m.copy().also { it.pending = false; it.failed = failed } else m
        })
    }
}

@Composable
fun ThreadScreen(convoId: String, onBack: () -> Unit) {
    // Key the ViewModel by conversation so opening a different thread gets a
    // fresh instance rather than the previous thread's messages.
    val vm: ThreadViewModel = viewModel(key = "thread-$convoId") { ThreadViewModel(convoId) }
    var counterPrompt by remember { mutableStateOf(false) }
    LaunchedEffect(convoId) { vm.start() }

    val t = vm.thread
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(title = t?.counterpart?.name ?: "", onBack = onBack)
        when {
            vm.notFound -> CenterNote(L10n.tr("Conversation not found.", "Không tìm thấy cuộc trò chuyện."))
            t == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            else -> ThreadBody(t, vm, onCounter = { counterPrompt = true }, modifier = Modifier.weight(1f))
        }
    }

    vm.actionError?.let { err ->
        AlertDialog(
            onDismissRequest = { vm.clearError() },
            confirmButton = { TextButton(onClick = { vm.clearError() }) { Text("OK") } },
            text = { Text(err) },
        )
    }
    if (counterPrompt) {
        CounterDialog(onDismiss = { counterPrompt = false }, onSend = { vm.counter(it); counterPrompt = false })
    }
}

@Composable
private fun ThreadBody(t: ChatThread, vm: ThreadViewModel, onCounter: () -> Unit, modifier: Modifier) {
    Column(modifier) {
        ListingBar(t.listing)
        val listState = rememberLazyListState()
        val msgs = t.messages
        LaunchedEffect(msgs.size) {
            if (msgs.isNotEmpty()) listState.animateScrollToItem(msgs.size)
        }
        LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(12.dp)) {
            item { SafetyNote(msgs) }
            itemsIndexed(msgs, key = { _, m -> m.id }) { idx, m ->
                if (daySeparatorNeeded(msgs, idx)) DaySeparator(m.createdAt)
                if (m.isOffer) OfferCard(m, t, vm, onCounter) else Bubble(m, vm)
            }
            if (msgs.isEmpty()) {
                item {
                    Text(
                        L10n.tr("Say hello — this seller will be notified.", "Gửi lời chào — người bán sẽ được thông báo."),
                        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 24.dp),
                    )
                }
            }
        }
        Composer(onSend = { vm.send(it) })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(title: String, onBack: () -> Unit) {
    TopAppBar(
        title = { Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, L10n.tr("Back", "Quay lại")) }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

@Composable
private fun CenterNote(text: String) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Text(text, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ListingBar(listing: ChatThread.ThreadListing) {
    Column {
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            listing.image?.let { img ->
                AsyncImage(
                    model = ImageUrl.optimized(img, 96), contentDescription = null,
                    modifier = Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)),
                )
                Spacer(Modifier.width(10.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(listing.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(Format.vnd(listing.price), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}

// First-contact safety note (chat-safety-note.tsx rule: ≤3 msgs, none mine).
@Composable
private fun SafetyNote(msgs: List<ChatMsg>) {
    if (msgs.size <= 3 && msgs.none { it.mine }) {
        Text(
            L10n.tr(
                "First chat — never pay or ship before meeting. Meet in public, inspect, then pay.",
                "Lần đầu trò chuyện — đừng thanh toán hay gửi hàng trước khi gặp. Gặp nơi công cộng, kiểm tra, rồi mới trả tiền.",
            ),
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .padding(bottom = 8.dp)
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                .padding(10.dp),
        )
    }
}

private fun daySeparatorNeeded(msgs: List<ChatMsg>, idx: Int): Boolean {
    if (idx == 0) return true
    val a = ChatTime.localDate(msgs[idx - 1].createdAt)
    val b = ChatTime.localDate(msgs[idx].createdAt)
    return a != b
}

@Composable
private fun DaySeparator(iso: String) {
    val today = LocalDate.now()
    val d = ChatTime.localDate(iso)
    val label = when (d) {
        today -> L10n.tr("Today", "Hôm nay")
        today.minusDays(1) -> L10n.tr("Yesterday", "Hôm qua")
        else -> ChatTime.shortDate(iso)
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), Alignment.Center) {
        Text(
            label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.background(MaterialTheme.colorScheme.surfaceVariant, CircleShape).padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun Bubble(m: ChatMsg, vm: ThreadViewModel) {
    val mine = m.mine
    Column(
        Modifier.fillMaxWidth().padding(start = if (mine) 60.dp else 0.dp, end = if (mine) 0.dp else 60.dp, top = 2.dp, bottom = 2.dp),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        val bg = when {
            m.failed -> MaterialTheme.colorScheme.error.copy(alpha = 0.15f)
            mine -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.surface
        }
        Text(
            m.body, fontSize = 15.sp,
            color = if (mine && !m.failed) Color.White else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier
                .background(bg, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Meta(m, vm)
    }
}

@Composable
private fun Meta(m: ChatMsg, vm: ThreadViewModel) {
    when {
        m.failed -> TextButton(onClick = { vm.retry(m) }, contentPadding = PaddingValues(0.dp)) {
            Text(L10n.tr("Not sent — tap to retry", "Chưa gửi — chạm để thử lại"), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
        }
        m.pending -> Text(L10n.tr("Sending…", "Đang gửi…"), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> Text(ChatTime.hourMinute(m.createdAt), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// Offer card (derived from offerAmount/offerStatus, never the body).
@Composable
private fun OfferCard(m: ChatMsg, t: ChatThread, vm: ThreadViewModel, onCounter: () -> Unit) {
    val mine = m.mine
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .background(
                if (mine) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else MaterialTheme.colorScheme.surface,
                RoundedCornerShape(12.dp),
            )
            .padding(12.dp),
    ) {
        Text(L10n.tr("💰 Offer", "💰 Đề nghị"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        m.offerAmount?.let { amt ->
            Text(L10n.tr("Offered ${Format.vnd(amt)}", "Đã trả giá ${Format.vnd(amt)}"), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            if (t.listing.price > 0) {
                val pct = (amt.toDouble() / t.listing.price * 100).roundToInt()
                Text("$pct% ${L10n.tr("of asking", "của giá rao")}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (m.body.isNotEmpty() && !m.body.startsWith("💰")) {
            Text(m.body, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
        }
        // iOS review #7: a network-failed counter must NOT read as a live offer.
        when {
            m.failed -> TextButton(onClick = { vm.retry(m) }, contentPadding = PaddingValues(0.dp)) {
                Text(L10n.tr("Not sent — tap to retry", "Chưa gửi — chạm để thử lại"), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
            }
            m.pending -> Text(L10n.tr("Sending…", "Đang gửi…"), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> OfferStatus(m.offerStatus)
        }
        if (!mine && m.offerStatus == "pending") {
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { vm.act(m, "accept") }, contentPadding = PaddingValues(horizontal = 16.dp)) {
                    Text(L10n.tr("Accept", "Chấp nhận"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
                FilledTonalButton(onClick = { vm.act(m, "decline") }, contentPadding = PaddingValues(horizontal = 16.dp)) {
                    Text(L10n.tr("Decline", "Từ chối"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
                // Landmine invariant: Counter only on negotiable listings.
                if (t.listing.negotiable) {
                    TextButton(onClick = onCounter) {
                        Text(L10n.tr("Counter", "Trả giá"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        if (mine && m.offerStatus == "pending" && !m.pending && !m.failed) {
            Text(L10n.tr("Waiting for a response…", "Đang chờ phản hồi…"), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun OfferStatus(status: String?) {
    val green = Color(0xFF16A34A)
    when (status) {
        "accepted" -> Text(L10n.tr("Accepted", "Đã chấp nhận"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = green)
        "declined" -> Text(L10n.tr("Declined", "Đã từ chối"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
        "countered" -> Text(L10n.tr("Countered", "Đã trả giá khác"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        "pending" -> Text(L10n.tr("Pending", "Đang chờ"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFFEA580C))
    }
}

@Composable
private fun Composer(onSend: (String) -> Unit) {
    var draft by remember { mutableStateOf("") }
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = draft, onValueChange = { draft = it },
            placeholder = { Text(L10n.tr("Write a message…", "Nhập tin nhắn…")) },
            maxLines = 4,
            modifier = Modifier.weight(1f),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            shape = RoundedCornerShape(14.dp),
        )
        Spacer(Modifier.width(10.dp))
        val enabled = draft.trim().isNotEmpty()
        IconButton(
            onClick = { val t = draft; draft = ""; onSend(t) },
            enabled = enabled,
            modifier = Modifier.size(40.dp).background(if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, CircleShape),
        ) {
            Icon(Icons.Filled.ArrowUpward, L10n.tr("Send", "Gửi"), tint = Color.White)
        }
    }
}

@Composable
private fun CounterDialog(onDismiss: () -> Unit, onSend: (Long) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(L10n.tr("Counter-offer (VND)", "Trả giá (đ)")) },
        text = {
            TextField(
                value = text, onValueChange = { text = it },
                placeholder = { Text(L10n.tr("Amount", "Số tiền")) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(onClick = { text.filter { it.isDigit() }.toLongOrNull()?.let(onSend) ?: onDismiss() }) {
                Text(L10n.tr("Send", "Gửi"))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(L10n.tr("Cancel", "Hủy")) } },
    )
}
