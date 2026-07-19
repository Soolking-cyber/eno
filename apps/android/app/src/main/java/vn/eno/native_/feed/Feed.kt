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
    var category: String? = null
        set(value) {
            field = value
            _items.value = emptyList()
            load(reset = true)
        }
    private var offset = 0
    private var exhausted = false
    private var loading = false

    init { load(reset = true) }

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
}

@Composable
fun FeedScreen(onOpen: (String) -> Unit, vm: FeedViewModel = viewModel()) {
    val items by vm.items.collectAsState()
    var selected by remember { mutableStateOf<String?>(null) }

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
                            .padding(horizontal = 14.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Text(
                            L10n.tr("Find products…", "Tìm sản phẩm…"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 15.sp,
                        )
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
            if (card.urgent) {
                Text(
                    L10n.tr("Urgent", "Bán gấp"),
                    color = androidx.compose.ui.graphics.Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .padding(8.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.error)
                        .padding(horizontal = 8.dp, vertical = 3.dp),
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
                card.prevPrice?.takeIf { it > card.price }?.let {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        Format.vnd(it),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                        textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
                        maxLines = 1,
                    )
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
            if (card.displayLocation.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    card.displayLocation,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
