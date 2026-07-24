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

    // Review #9: ONE lock for the whole conversation, not per message. The
    // accept/decline endpoint is conversation-scoped (/offer), so two different
    // offer cards racing each other are as harmful as one double-tap.
    var acting by mutableStateOf(false)
        private set

    private var poller: kotlinx.coroutines.Job? = null

    // Review #3: the server dedupes a send by clientId. A retry MUST re-send the
    // ORIGINAL key or the ledger sees a new one and inserts again — a duplicate
    // OFFER. ChatMsg can't carry it (ChatModels.kt is another lane), so the
    // local-bubble id → clientId mapping lives here for the ViewModel's lifetime.
    private val clientIds = HashMap<String, String>()

    // Review #4/#14: a server message of mine may reconcile AT MOST ONE local
    // bubble, ever. Without this, a deliberate second identical message ("ok"
    // twice) matches the FIRST one's echo and vanishes from the UI.
    private val consumedServerIds = HashSet<String>()

    // Review #10: two guards, because they stop different things. `mutationGen`
    // discards a poll that a write overtook; `loadSeq` discards a poll that a
    // NEWER poll overtook (same generation, out-of-order responses).
    private var loadSeq = 0
    private var mutationGen = 0

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

    // Review #6: MessagesScreen hosts threads internally, so every keyed
    // ThreadViewModel stays in the Activity's store — without this, visiting N
    // conversations leaves N concurrent authed 12s pollers running for the
    // whole session (battery, data, and server load).
    fun stop() {
        poller?.cancel()
        poller = null
    }

    // After a write, restart the poll loop instead of just loading. Cancelling
    // kills any in-flight GET, which closes the window `mutationGen` cannot:
    // a poll that STARTED after the write but read the DB before it committed
    // is not stale by generation, yet still carries pre-write data.
    private fun restartPolling() {
        // Screen already gone (stop() ran): don't resurrect a poller nobody is
        // watching — re-entry calls start(), which loads fresh anyway.
        if (poller == null) return
        stop()
        start()
    }

    override fun onCleared() {
        poller?.cancel()
        super.onCleared()
    }

    suspend fun load() {
        val seq = ++loadSeq
        val gen = mutationGen
        try {
            val t = msgGet<ChatThread>("api/conversations/$convoId")
            // Review #10: drop a snapshot that a newer poll or a local write has
            // already superseded — otherwise a slow poll that started before an
            // Accept lands after it and reverts the card to "pending" for ~12s.
            if (seq != loadSeq || gen != mutationGen) return
            val server = t.messages
            val serverIds = server.map { it.id }.toHashSet()
            consumedServerIds.retainAll(serverIds) // bound growth to the live thread

            // Duplication guard for the poll-vs-send race: a poll that STARTED
            // before a send committed returns the list WITHOUT it (would blink
            // the bubble out); a poll that finished AFTER returns the DB copy
            // while the local bubble is still pending.
            //
            // Review #4/#14: reconcile against a POOL that each server message
            // can leave only once. Matching on content alone was wrong twice
            // over — it kept a failed bubble forever beside its delivered twin
            // (the phantom "Not sent"), and it silently ate a deliberate second
            // identical message by matching it to the first one's echo.
            val pool = server.filter { it.mine }.takeLast(10)
                .filterNot { consumedServerIds.contains(it.id) }
                .toMutableList()
            fun consumeEcho(m: ChatMsg): Boolean {
                val key = "${m.body}|${m.offerAmount ?: -1}"
                val echo = pool.firstOrNull { "${it.body}|${it.offerAmount ?: -1}" == key }
                    ?: return false
                pool.remove(echo)
                consumedServerIds.add(echo.id)
                clientIds.remove(m.id)
                return true
            }
            val keep = thread?.messages.orEmpty().filter { m ->
                if (serverIds.contains(m.id)) return@filter false
                when {
                    // A PENDING bubble is resolved exactly by replace() when its
                    // POST returns, so never content-guess at it. Guessing loses
                    // real messages: with two identical sends in flight, the
                    // older local can claim the YOUNGER one's echo and vanish —
                    // permanently, if its own POST then fails. A brief
                    // double-render until replace() lands is the cheaper evil.
                    m.pending -> true
                    // A FAILED bubble never gets a replace() — its response was
                    // the thing we lost — so content reconciliation is the only
                    // way to clear the phantom "Not sent" standing beside a
                    // message that actually committed (#4).
                    //
                    // But content matching is a GUESS (the server does not echo
                    // clientId), and on an offer a wrong guess hides real money:
                    // the bubble disappears and the seller thinks the offer
                    // landed. So never guess at an offer — leave it saying
                    // "Not sent". That is honest, and it is self-healing:
                    // retry() re-sends the ORIGINAL clientId, so if it did
                    // commit the server returns the same message and replace()
                    // resolves the bubble EXACTLY, with no duplicate.
                    m.failed -> if (m.offerAmount != null) true else !consumeEcho(m)
                    m.mine && ChatTime.secondsAgo(m.createdAt) < 60 -> !consumeEcho(m)
                    else -> false
                }
            }
            thread = t.copy(messages = server + keep)
            notFound = false
        } catch (e: HttpStatusException) {
            if (e.code == 404 || e.code == 403) notFound = true
        } catch (_: Exception) { /* transient; the poll retries */ }
    }

    // `clientId` is non-null only on a RETRY, where re-using the original key is
    // what makes the resend idempotent server-side.
    fun send(text: String, clientId: String? = null) {
        val body = text.trim()
        if (body.isEmpty() || body.length > 2000) return
        val cid = clientId ?: UUID.randomUUID().toString()
        deliver(JSONObject().put("body", body).put("clientId", cid), body, null, cid)
    }

    fun counter(amount: Long, clientId: String? = null) {
        if (amount <= 0) return
        val cid = clientId ?: UUID.randomUUID().toString()
        deliver(JSONObject().put("offerAmount", amount).put("clientId", cid), "", amount, cid)
    }

    private fun deliver(payload: JSONObject, localBody: String, offerAmount: Long?, clientId: String) {
        val localId = "local-${UUID.randomUUID()}"
        clientIds[localId] = clientId
        // CAUSALITY (money-critical). Reconciliation matches on content, so
        // without this a failed NEW offer silently matches an identical OLDER
        // one already in the thread — the bubble vanishes and the seller
        // believes an offer landed that never committed. Nothing that already
        // exists can be the echo of a send that hasn't happened yet, so retire
        // every currently-known server message from the pool up front. Only
        // messages that appear AFTER this moment can reconcile this bubble.
        thread?.messages.orEmpty().forEach { m ->
            if (!m.id.startsWith("local-")) consumedServerIds.add(m.id)
        }
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
                mutationGen++ // my own write outranks any poll already in flight
                replace(localId, sent)
                // A counter flips older offers server-side, so refresh — via a
                // poll restart, so an in-flight pre-write GET can't undo it.
                if (offerAmount != null) restartPolling()
            } catch (_: Exception) {
                mark(localId, failed = true)
            }
        }
    }

    fun retry(msg: ChatMsg) {
        if (!msg.failed) return
        val cid = clientIds[msg.id]
        val amt = msg.offerAmount
        if (cid == null && amt != null) {
            // Money path: a "failed" send may still have COMMITTED (the response
            // was what we lost). Re-sending under a fresh idempotency key is
            // exactly the duplicate-offer bug, so refuse rather than risk it.
            actionError = L10n.tr(
                "Couldn't safely resend that offer. Reopen the chat to see if it went through.",
                "Không thể gửi lại đề nghị an toàn. Hãy mở lại cuộc trò chuyện để kiểm tra.",
            )
            return
        }
        clientIds.remove(msg.id)
        thread = thread?.let { it.copy(messages = it.messages.filterNot { m -> m.id == msg.id }) }
        if (amt != null) counter(amt, cid) else send(msg.body, cid)
    }

    // iOS review #6: only reload on a real 2xx; surface every other outcome so a
    // swallowed failure can't leave optimistic accept/decline state standing.
    fun act(msg: ChatMsg, action: String) {
        // Review #9: a second tap while the first is in flight 409s, which used
        // to raise "this offer can't be updated" straight after a SUCCESSFUL
        // accept. The lock is conversation-wide because the endpoint is.
        if (acting) return
        acting = true
        viewModelScope.launch {
            try {
                val status = msgSendStatus(
                    "POST", "api/conversations/$convoId/offer",
                    JSONObject().put("messageId", msg.id).put("action", action).toString(),
                )
                when {
                    status in 200..299 -> { mutationGen++; restartPolling() }
                    status == 409 -> {
                        actionError = L10n.tr("This offer can't be updated anymore.", "Đề nghị này không còn hiệu lực.")
                        mutationGen++
                        restartPolling()
                    }
                    else -> actionError = L10n.tr("Could not update the offer. Try again.", "Không cập nhật được đề nghị. Thử lại.")
                }
            } finally {
                acting = false
            }
        }
    }

    private fun replace(localId: String, server: ChatMsg) {
        clientIds.remove(localId)
        // This server message is now accounted for, so a later identical message
        // can't be mistaken for its echo and dropped (#14).
        consumedServerIds.add(server.id)
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
    // Review #6: cancel the 12s poll when the thread leaves composition, or every
    // conversation ever opened keeps polling for the life of the session.
    DisposableEffect(convoId) {
        vm.start()
        onDispose { vm.stop() }
    }

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
                Button(onClick = { vm.act(m, "accept") }, enabled = !vm.acting, contentPadding = PaddingValues(horizontal = 16.dp)) {
                    Text(L10n.tr("Accept", "Chấp nhận"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
                FilledTonalButton(onClick = { vm.act(m, "decline") }, enabled = !vm.acting, contentPadding = PaddingValues(horizontal = 16.dp)) {
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
