package vn.eno.native_.feed

import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import vn.eno.native_.core.*

// The browse feed, mirroring apps/ios FeedView v1: wordmark + search hint,
// category chip rail, 2-column card grid with offset paging.
class FeedViewModel : ViewModel() {
    private val _items = MutableStateFlow<List<ListingCard>>(emptyList())
    val items: StateFlow<List<ListingCard>> = _items
    private val _rails = MutableStateFlow<List<Pair<String, List<ListingCard>>>>(emptyList())
    val rails: StateFlow<List<Pair<String, List<ListingCard>>>> = _rails
    private val _recentlyViewed = MutableStateFlow<List<ListingCard>>(emptyList())
    val recentlyViewed: StateFlow<List<ListingCard>> = _recentlyViewed
    var category: String? = null
        set(value) {
            field = value
            _items.value = emptyList()
            load(reset = true)
        }
    var subcategory: String? = null
        set(value) { field = value; _items.value = emptyList(); load(reset = true) }
    var brand: String? = null
        set(value) { field = value; _items.value = emptyList(); load(reset = true) }
    var model: String? = null
        set(value) { field = value; _items.value = emptyList(); load(reset = true) }
    private val _subcategoryCounts = MutableStateFlow<Map<String, Int>>(emptyMap())
    val subcategoryCounts: StateFlow<Map<String, Int>> = _subcategoryCounts
    // First-paint skeleton (#10) vs pull-to-refresh spinner (#6): initialLoading
    // is true until the very first load settles; refreshing drives PullToRefreshBox.
    private val _initialLoading = MutableStateFlow(true)
    val initialLoading: StateFlow<Boolean> = _initialLoading
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing
    // Offline/failed first load (#17): true only when a load errored AND we have
    // nothing to show — drives the Try-again panel instead of a blank grid.
    private val _failed = MutableStateFlow(false)
    val failed: StateFlow<Boolean> = _failed
    var sort: String = "newest"
        set(value) {
            field = value
            _items.value = emptyList()
            load(reset = true)
        }
    private var offset = 0
    private var exhausted = false
    private var loading = false
    // Latest-wins generation (review #2/#5/#7): a reset (filter/sort change)
    // always supersedes an in-flight load; a stale response drops its result
    // instead of painting the old filter's data under the new chip.
    private var loadGen = 0

    init {
        load(reset = true)
        viewModelScope.launch { Fx.ensureLoaded() }
        viewModelScope.launch { loadRails() }
    }

    @kotlinx.serialization.Serializable
    private data class RailsEnvelope(val rails: List<Rail> = emptyList()) {
        @kotlinx.serialization.Serializable
        data class Rail(val slug: String, val listings: List<ListingCard> = emptyList())
    }

    // Home rails (web landing parity): Outstanding businesses + per-category.
    private suspend fun loadRails() {
        val out = mutableListOf<Pair<String, List<ListingCard>>>()
        runCatching { Api.get<FeedPage>("api/businesses/top") }.getOrNull()?.listings
            ?.takeIf { it.isNotEmpty() }
            ?.let { out += L10n.tr("Outstanding businesses", "Doanh nghiệp nổi bật") to it }
        runCatching { Api.get<RailsEnvelope>("api/category-rails") }.getOrNull()?.rails
            ?.forEach { rail ->
                val cat = Categories.all.firstOrNull { it.slug == rail.slug } ?: return@forEach
                if (rail.listings.isNotEmpty()) out += cat.name to rail.listings
            }
        _rails.value = out
    }

    fun load(reset: Boolean = false) {
        // Pagination coalesces (one page at a time); a RESET always supersedes —
        // it must never be dropped just because a stale filter's load is in flight.
        if (loading && !reset) return
        if (reset) { offset = 0; exhausted = false }
        val gen = ++loadGen
        loading = true
        viewModelScope.launch {
            try {
                val q = buildMap {
                    put("limit", "24")
                    put("offset", offset.toString())
                    category?.let { put("category", it) }
                    subcategory?.let { put("subcategory", it) }
                    brand?.let { put("brand", it) }
                    model?.let { put("model", it) }
                    if (sort != "newest") put("sort", sort)
                }
                val page: FeedPage = Api.get("api/listings", q)
                if (gen != loadGen) return@launch // a newer reset superseded us
                if (page.subcategoryCounts.isNotEmpty()) _subcategoryCounts.value = page.subcategoryCounts
                val known = _items.value.map { it.id }.toSet()
                _items.value = if (reset) page.listings
                else _items.value + page.listings.filter { it.id !in known }
                // Fresh bases arrived — drop these listings' save-deltas (#26).
                if (reset) Favorites.clearDeltas(page.listings.map { it.id })
                offset += page.listings.size
                exhausted = page.listings.size < 24
                _failed.value = false
            } catch (_: Exception) {
                if (_items.value.isEmpty()) _failed.value = true
            } finally {
                if (gen == loadGen) { loading = false; _initialLoading.value = false }
            }
        }
    }

    // Pull-to-refresh (#6): re-pull the first page + rails, hold the spinner
    // until both settle. Reuses the reset path so filters/sort are preserved.
    fun refresh() {
        if (_refreshing.value) return
        _refreshing.value = true
        val gen = ++loadGen
        loading = true
        viewModelScope.launch {
            try {
                val q = buildMap {
                    put("limit", "24"); put("offset", "0")
                    category?.let { put("category", it) }
                    subcategory?.let { put("subcategory", it) }
                    brand?.let { put("brand", it) }
                    model?.let { put("model", it) }
                    if (sort != "newest") put("sort", sort)
                }
                val page: FeedPage = Api.get("api/listings", q)
                if (gen != loadGen) return@launch
                if (page.subcategoryCounts.isNotEmpty()) _subcategoryCounts.value = page.subcategoryCounts
                _items.value = page.listings
                Favorites.clearDeltas(page.listings.map { it.id })
                offset = page.listings.size
                exhausted = page.listings.size < 24
                _failed.value = false
                loadRails()
            } catch (_: Exception) {
                if (_items.value.isEmpty()) _failed.value = true
            } finally {
                if (gen == loadGen) loading = false
                _refreshing.value = false
            }
        }
    }

    fun loadMoreIfNeeded(index: Int) {
        if (!exhausted && index >= _items.value.size - 6) load()
    }

    // Recently-viewed rail: device-local ids → order-preserving ids= fast path.
    fun loadRecentlyViewed(ctx: android.content.Context) {
        val ids = RecentStore.viewedIds(ctx)
        if (ids.isEmpty()) { _recentlyViewed.value = emptyList(); return }
        viewModelScope.launch {
            val page = runCatching { Api.get<FeedPage>("api/listings", mapOf("ids" to ids.joinToString(","))) }.getOrNull()
                ?: return@launch
            val byId = page.listings.associateBy { it.id }
            _recentlyViewed.value = ids.mapNotNull { byId[it] }
        }
    }
}

private val SORTS = listOf(
    "newest" to ("Recommended" to "Đề xuất"),
    "recent" to ("Newest" to "Mới nhất"),
    "price-low" to ("Price: low" to "Giá thấp trước"),
    "price-high" to ("Price: high" to "Giá cao trước"),
    "popular" to ("Most contacted" to "Được quan tâm"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    onOpen: (String) -> Unit,
    onSearch: () -> Unit = {},
    onBell: () -> Unit = {},
    vm: FeedViewModel = viewModel(),
) {
    val items by vm.items.collectAsState()
    val rails by vm.rails.collectAsState()
    val refreshing by vm.refreshing.collectAsState()
    val initialLoading by vm.initialLoading.collectAsState()
    val failed by vm.failed.collectAsState()
    var filtered by remember { mutableStateOf(false) }
    var sort by remember { mutableStateOf("newest") }
    val feedCtx = androidx.compose.ui.platform.LocalContext.current
    // Refresh the recently-viewed rail whenever the feed re-composes into view
    // (returning from a PDP changes it).
    LaunchedEffect(items.size) { vm.loadRecentlyViewed(feedCtx) }

    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.refresh() }) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(12.dp),
    ) {
        item(span = { GridItemSpan(2) }) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "eno",
                        fontSize = 26.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .clickable(onClick = onSearch)
                            .padding(horizontal = 14.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Text(
                            L10n.tr("Find products…", "Tìm sản phẩm…"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 15.sp,
                        )
                    }
                    // Notification bell with red dot while unread (web header parity).
                    Box(
                        Modifier
                            .padding(start = 10.dp)
                            .size(40.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .clickable(onClick = onBell),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Outlined.Notifications, null,
                            Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onBackground)
                        if (vn.eno.native_.account.Notifs.unread > 0) {
                            Box(
                                Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(6.dp)
                                    .size(9.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.error),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
                // The quick-find cascading selector (category → subcat → brand →
                // model) replaces the plain chip rail and filters the feed in place.
                QuickFindBar(vm, onActiveChange = { filtered = it })
                // Rails render only on the unfiltered landing (web parity).
                if (!filtered) {
                    val recent by vm.recentlyViewed.collectAsState()
                    (listOf(L10n.tr("Recently viewed", "Đã xem gần đây") to recent).filter { it.second.isNotEmpty() } + rails)
                        .forEach { (title, cards) ->
                        Spacer(Modifier.height(16.dp))
                        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                        Spacer(Modifier.height(8.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(cards) { card ->
                                Box(Modifier.width(168.dp)) {
                                    ListingCardView(card) { onOpen(card.id) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Text(
                        L10n.tr("Latest listings", "Tin mới nhất"),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                }
                Spacer(Modifier.height(8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(SORTS) { (value, labels) ->
                        Chip(L10n.tr(labels.first, labels.second), sort == value) {
                            sort = value
                            vm.sort = value
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
            }
        }
        if (items.isEmpty() && initialLoading) {
            items(6) { SkeletonCard() }
        } else if (items.isEmpty() && failed) {
            item(span = { GridItemSpan(2) }) { OfflineRetry { vm.load(reset = true) } }
        } else {
            items(items.size) { idx ->
                val card = items[idx]
                LaunchedEffect(card.id) { vm.loadMoreIfNeeded(idx) }
                ListingCardView(card) { onOpen(card.id) }
            }
        }
    }
    }
}

// Offline / failed-load panel (#17): shown only when the first load errored and
// there's nothing cached — a friendly message + a Try-again that re-pulls page 0.
@Composable
private fun OfflineRetry(onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.CloudOff, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Text(L10n.tr("Couldn't load listings", "Không tải được tin"),
            fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(4.dp))
        Text(L10n.tr("Check your connection and try again.", "Kiểm tra kết nối rồi thử lại."),
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        Box(
            Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary)
                .clickable(onClick = onRetry).padding(horizontal = 20.dp, vertical = 10.dp),
        ) {
            Text(L10n.tr("Try again", "Thử lại"), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

// First-paint skeleton card (#10/#96): matches ListingCardView geometry — 10:11
// image + two text lines — with a left-to-right shimmer sweep.
@Composable
fun SkeletonCard() {
    Column(
        Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp)),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(10f / 11f).shimmer())
        Column(Modifier.padding(10.dp)) {
            Box(Modifier.fillMaxWidth(0.55f).height(15.dp).clip(RoundedCornerShape(4.dp)).shimmer())
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth(0.85f).height(12.dp).clip(RoundedCornerShape(4.dp)).shimmer())
        }
    }
}

// Animated shimmer sweep for skeletons — reduced-motion is honored by the
// static base tint if the transition is disabled by the platform.
@Composable
fun Modifier.shimmer(): Modifier {
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "shimmer")
    val x by transition.animateFloat(
        initialValue = -2f, targetValue = 2f,
        animationSpec = androidx.compose.animation.core.infiniteRepeatable(
            animation = androidx.compose.animation.core.tween(1100, easing = androidx.compose.animation.core.LinearEasing),
        ),
        label = "shimmerX",
    )
    val base = MaterialTheme.colorScheme.surfaceVariant
    val hi = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    return this.background(
        androidx.compose.ui.graphics.Brush.linearGradient(
            colors = listOf(base, hi, base),
            start = androidx.compose.ui.geometry.Offset(x * 300f, 0f),
            end = androidx.compose.ui.geometry.Offset((x + 1f) * 300f, 300f),
        ),
    )
}

// Trust ladder chip (web trust-score.tsx). Thresholds match src/lib/trust-score.ts
// (60/85/110/160). The EARNED tiers (Trusted/Exceptional/Elite) carry the vivid
// glossy gradient FILL from globals.css .trust-fill-*; Building/Restricted stay a
// quiet currentColor tint. onTap (optional) opens the /trust explainer — PDP/chat
// pass it; cards leave it null so the card itself owns the tap.
private class TrustBandStyle(val text: Color, val fill: List<Color>?, val onFill: Color)

@Composable
fun TrustMini(score: Int, onTap: (() -> Unit)? = null) {
    val dark = isSystemInDarkTheme()
    val b = when {
        score >= 160 -> TrustBandStyle(               // Elite — violet
            text = if (dark) Color(0xFFA78BFA) else Color(0xFF6D28D9),
            fill = listOf(Color(0xFF7C3AED), Color(0xFF6D28D9), Color(0xFF5B21B6)), onFill = Color.White)
        score >= 110 -> TrustBandStyle(               // Exceptional — gold
            text = if (dark) Color(0xFFFACC15) else Color(0xFFA16207),
            fill = listOf(Color(0xFFFDE047), Color(0xFFFACC15), Color(0xFFF59E0B)), onFill = Color(0xFF713F12))
        score >= 85 -> TrustBandStyle(                // Trusted — brand blue
            text = if (dark) Color(0xFF60A5FA) else Color(0xFF1D4ED8),
            fill = listOf(Color(0xFF3B82F6), Color(0xFF2563EB), Color(0xFF1D4ED8)), onFill = Color.White)
        score >= 60 -> TrustBandStyle(                // Building — neutral slate, quiet
            text = if (dark) Color(0xFFA3A3A3) else Color(0xFF525252), fill = null, onFill = Color.Unspecified)
        else -> TrustBandStyle(                        // Restricted — red, quiet
            text = if (dark) Color(0xFFF87171) else Color(0xFFB91C1C), fill = null, onFill = Color.Unspecified)
    }
    val content = if (b.fill != null) b.onFill else b.text
    val fillMod = if (b.fill != null) Modifier.background(Brush.linearGradient(b.fill), CircleShape)
                  else Modifier.background(b.text.copy(alpha = 0.12f), CircleShape)
    Row(
        Modifier
            .clip(CircleShape)
            .then(fillMod)
            .then(if (onTap != null) Modifier.clickable(onClick = onTap) else Modifier)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(Icons.Outlined.Shield, null, Modifier.size(10.dp), tint = content)
        Text("$score", color = content, fontSize = 9.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Chip(label: String, active: Boolean, onClick: () -> Unit) {
    val bg = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (active) androidx.compose.ui.graphics.Color.White else MaterialTheme.colorScheme.onSurface
    Box(
        Modifier
            .clip(CircleShape)
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) {
        Text(label, color = fg, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun ListingCardView(card: ListingCard, onClick: () -> Unit) {
    Column(
        Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
    ) {
        Box {
            AsyncImage(
                model = card.images.firstOrNull()?.let { ImageUrl.optimized(it) },
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(10f / 11f)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            // Top-left chip priority (card-badges.tsx): urgent > -N% > New(48h).
            val (chip, chipBg) = when {
                // Solid SLATE (not red) so it doesn't collide with the red -N% drop badge (#5).
                card.urgent -> L10n.tr("⚡ Urgent", "⚡ Bán gấp") to MaterialTheme.colorScheme.onBackground
                card.dropPercent != null -> "-${card.dropPercent}%" to MaterialTheme.colorScheme.error
                card.isNew -> L10n.tr("New", "Mới") to MaterialTheme.colorScheme.onSurface.copy(alpha = 0.85f)
                else -> null to MaterialTheme.colorScheme.error
            }
            if (chip != null) {
                Text(
                    chip,
                    color = androidx.compose.ui.graphics.Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .padding(8.dp)
                        .clip(CircleShape)
                        .background(chipBg)
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
            val ctx = androidx.compose.ui.platform.LocalContext.current
            LaunchedEffect(Unit) { Favorites.ensureLoaded(ctx) }
            val fav = Favorites.isFavorite(card.id)
            Icon(
                if (fav) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                contentDescription = null,
                tint = if (fav) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.White,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .clip(CircleShape)
                    .background(
                        if (fav) androidx.compose.ui.graphics.Color.White
                        else androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.25f)
                    )
                    .clickable { Favorites.toggle(ctx, card.id) }
                    .padding(6.dp)
                    .size(16.dp),
            )
            // Landmine (web/iOS parity): displayed saves = server base + session
            // delta, floored — never derived from the favorited flag (#26).
            val savedShown = (card.savedCount + Favorites.delta(card.id)).coerceAtLeast(0)
            if (savedShown >= 3) {
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(8.dp)
                        .clip(CircleShape)
                        .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.55f))
                        .padding(horizontal = 7.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Icon(Icons.Filled.Favorite, null, Modifier.size(10.dp),
                        tint = androidx.compose.ui.graphics.Color.White)
                    Text(
                        "$savedShown",
                        color = androidx.compose.ui.graphics.Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
        Column(Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    Format.vnd(card.price),
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val prev = card.prevPrice?.takeIf { it > card.price }
                if (prev != null) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        Format.vnd(prev),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                        textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
                        maxLines = 1,
                    )
                } else {
                    Fx.approxUSD(card.price)?.let { approx ->
                        Spacer(Modifier.width(6.dp))
                        Text(approx, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp, maxLines = 1)
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                card.displayTitle,
                fontSize = 14.sp,
                minLines = 2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = 18.sp,
            )
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    card.displayLocation,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TrustMini(card.seller.trustScore)
            }
        }
    }
}
