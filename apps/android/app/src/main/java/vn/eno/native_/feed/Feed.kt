package vn.eno.native_.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
    var sort: String = "newest"
        set(value) {
            field = value
            _items.value = emptyList()
            load(reset = true)
        }
    private var offset = 0
    private var exhausted = false
    private var loading = false

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
        if (loading) return
        loading = true
        if (reset) { offset = 0; exhausted = false }
        viewModelScope.launch {
            try {
                val q = buildMap {
                    put("limit", "24")
                    put("offset", offset.toString())
                    category?.let { put("category", it) }
                    if (sort != "newest") put("sort", sort)
                }
                val page: FeedPage = Api.get("api/listings", q)
                val known = _items.value.map { it.id }.toSet()
                _items.value = if (reset) page.listings
                else _items.value + page.listings.filter { it.id !in known }
                offset += page.listings.size
                exhausted = page.listings.size < 24
            } catch (_: Exception) {
            } finally {
                loading = false
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

@Composable
fun FeedScreen(
    onOpen: (String) -> Unit,
    onSearch: () -> Unit = {},
    onBell: () -> Unit = {},
    vm: FeedViewModel = viewModel(),
) {
    val items by vm.items.collectAsState()
    val rails by vm.rails.collectAsState()
    var selected by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf("newest") }
    val feedCtx = androidx.compose.ui.platform.LocalContext.current
    // Refresh the recently-viewed rail whenever the feed re-composes into view
    // (returning from a PDP changes it).
    LaunchedEffect(items.size) { vm.loadRecentlyViewed(feedCtx) }

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
                        Text("🔔", fontSize = 16.sp)
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
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        Chip(L10n.tr("All", "Tất cả"), selected == null) { selected = null; vm.category = null }
                    }
                    items(Categories.all) { cat ->
                        Chip(cat.name, selected == cat.slug) { selected = cat.slug; vm.category = cat.slug }
                    }
                }
                // Rails render only on the unfiltered landing (web parity).
                if (selected == null) {
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
        items(items.size) { idx ->
            val card = items[idx]
            LaunchedEffect(card.id) { vm.loadMoreIfNeeded(idx) }
            ListingCardView(card) { onOpen(card.id) }
        }
    }
}

// Trust shield chip (web trust-score.tsx mini): band colors ≥110 gold, ≥85
// brand, ≥60 slate, else red.
@Composable
fun TrustMini(score: Int) {
    val band = when {
        score >= 110 -> androidx.compose.ui.graphics.Color(0xFFB8860B)
        score >= 85 -> MaterialTheme.colorScheme.primary
        score >= 60 -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.error
    }
    Box(
        Modifier
            .clip(CircleShape)
            .background(band.copy(alpha = 0.12f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text("🛡 $score", color = band, fontSize = 9.sp, fontWeight = FontWeight.Bold)
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
                card.urgent -> L10n.tr("Urgent", "Bán gấp") to MaterialTheme.colorScheme.error
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
            Text(
                if (fav) "♥" else "♡",
                color = if (fav) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .clip(CircleShape)
                    .background(
                        if (fav) androidx.compose.ui.graphics.Color.White
                        else androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.25f)
                    )
                    .clickable { Favorites.toggle(ctx, card.id) }
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            )
            if (card.savedCount >= 3) {
                Text(
                    "♥ ${card.savedCount}",
                    color = androidx.compose.ui.graphics.Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(8.dp)
                        .clip(CircleShape)
                        .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.55f))
                        .padding(horizontal = 7.dp, vertical = 3.dp),
                )
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
