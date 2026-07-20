package vn.eno.native_.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import vn.eno.native_.core.*

@Serializable
private data class SuggestResponse(
    val listings: List<SuggestListing> = emptyList(),
    val categories: List<SuggestCategory> = emptyList(),
) {
    @Serializable data class SuggestListing(
        val id: String, val title: String, val titleVi: String? = null,
        val price: Long, val location: String = "", val image: String? = null,
    ) { val displayTitle get() = if (L10n.isVi) (titleVi ?: title) else title }
    @Serializable data class SuggestCategory(val slug: String, val name: String, val nameVi: String)
}

@Serializable
private data class TrendingResponse(val trending: List<String> = emptyList())

// Native search v2 (Android), mirroring apps/ios SearchView: empty focus =
// recent searches (device-local) + trending; typing streams the ranked
// typeahead (/api/search/suggest); submit = full ranked results grid.
@Composable
fun SearchScreen(onOpen: (String) -> Unit) {
    val ctx = LocalContext.current
    var query by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }
    var categoryFilter by remember { mutableStateOf<String?>(null) }
    var results by remember { mutableStateOf<List<ListingCard>>(emptyList()) }
    var suggest by remember { mutableStateOf<SuggestResponse?>(null) }
    var searching by remember { mutableStateOf(false) }
    var offset by remember { mutableStateOf(0) }
    var exhausted by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var recents by remember { mutableStateOf(RecentStore.searches(ctx)) }
    var trending by remember { mutableStateOf<List<String>>(emptyList()) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        trending = runCatching { Api.get<TrendingResponse>("api/search/trending").trending }.getOrDefault(emptyList())
    }

    LaunchedEffect(query, submitted) {
        if (submitted) return@LaunchedEffect
        val q = query.trim()
        if (q.length < 2) { suggest = null; return@LaunchedEffect }
        delay(200)
        suggest = try {
            Api.get<SuggestResponse>("api/search/suggest", mapOf("q" to q))
        } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
    }

    suspend fun fetchPage(off: Int): List<ListingCard> = try {
        Api.get<FeedPage>("api/listings", buildMap {
            put("q", query.trim()); put("limit", "24"); put("offset", off.toString())
            categoryFilter?.let { put("category", it) }
        }).listings
    } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }

    fun submit(term: String, category: String? = null) {
        val q = term.trim()
        if (q.length < 2) return
        query = q; categoryFilter = category
        RecentStore.recordSearch(ctx, q); recents = RecentStore.searches(ctx)
        submitted = true
    }

    // Fresh results whenever the (query, category) submission changes.
    LaunchedEffect(submitted, query, categoryFilter) {
        if (!submitted) return@LaunchedEffect
        searching = true; offset = 0; exhausted = false
        val page = fetchPage(0)
        results = page; offset = page.size; exhausted = page.size < 24
        searching = false
    }

    fun loadMore() {
        if (loadingMore || exhausted) return
        loadingMore = true
        scope.launch {
            val page = fetchPage(offset)
            val known = results.map { it.id }.toSet()
            results = results + page.filter { it.id !in known }
            offset += page.size; exhausted = page.size < 24; loadingMore = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it; submitted = false; categoryFilter = null },
            placeholder = { Text(L10n.tr("Find products…", "Tìm sản phẩm…")) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { submit(query) }),
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
            modifier = Modifier.fillMaxWidth().padding(12.dp),
        )
        when {
            submitted -> ResultsGrid(results, searching, query, onOpen, onLoadMore = { loadMore() })
            query.trim().length >= 2 -> SuggestList(suggest, query, onOpen,
                onCategory = { slug, label -> submit(query.ifBlank { label }.ifBlank { " " }, slug) },
                onSubmit = { submit(query) })
            else -> EmptyState(recents, trending, onPick = { submit(it) }, onClear = { RecentStore.clearSearches(ctx); recents = emptyList() })
        }
    }
}

@Composable
private fun ResultsGrid(results: List<ListingCard>, searching: Boolean, query: String, onOpen: (String) -> Unit, onLoadMore: () -> Unit) {
    if (searching && results.isEmpty()) {
        Box(Modifier.fillMaxWidth().padding(top = 24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    } else if (results.isEmpty()) {
        Text(
            L10n.tr("No results for \"${query.trim()}\"", "Không tìm thấy \"${query.trim()}\""),
            fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp),
        )
    } else {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(12.dp),
        ) {
            items(results.size) { idx ->
                // Infinite scroll: load the next page as the tail approaches.
                if (idx >= results.size - 6) LaunchedEffect(results.size) { onLoadMore() }
                ListingCardView(results[idx]) { onOpen(results[idx].id) }
            }
        }
    }
}

@Composable
private fun SuggestList(
    suggest: SuggestResponse?,
    query: String,
    onOpen: (String) -> Unit,
    onCategory: (String, String) -> Unit,
    onSubmit: () -> Unit,
) {
    LazyColumn {
        // Category matches (were parsed then dropped — P0 #2): tap scopes the
        // search to that category.
        suggest?.categories?.let { cats ->
            items(cats) { c ->
                val label = if (L10n.isVi) c.nameVi else c.name
                Row(
                    Modifier.fillMaxWidth().clickable { onCategory(c.slug, label) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(LucideIcons.forCategory(c.slug), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(12.dp))
                    Text(L10n.tr("in $label", "trong $label"), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onBackground)
                }
            }
        }
        suggest?.listings?.let { list ->
            items(list) { l ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(l.id) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(
                        model = l.image?.let { ImageUrl.optimized(it, 96) },
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(l.displayTitle, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, color = MaterialTheme.colorScheme.onBackground)
                        Text("${Format.vnd(l.price)} · ${l.location}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                }
            }
        }
        item {
            Text(
                L10n.tr("Search \"${query.trim()}\"", "Tìm \"${query.trim()}\""),
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.fillMaxWidth().clickable(onClick = onSubmit).padding(16.dp),
            )
        }
    }
}

@Composable
private fun EmptyState(recents: List<String>, trending: List<String>, onPick: (String) -> Unit, onClear: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        if (recents.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(L10n.tr("Recent searches", "Tìm kiếm gần đây"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                Spacer(Modifier.weight(1f))
                Text(L10n.tr("Clear", "Xóa"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.clickable(onClick = onClear))
            }
            Spacer(Modifier.height(8.dp))
            TermFlow(recents, "🕘", onPick)
            Spacer(Modifier.height(18.dp))
        }
        if (trending.isNotEmpty()) {
            Text(L10n.tr("Trending", "Xu hướng tìm kiếm"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
            Spacer(Modifier.height(8.dp))
            TermFlow(trending, "🔥", onPick)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TermFlow(terms: List<String>, icon: String, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        terms.forEach { term ->
            Row(
                Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable { onPick(term) }.padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("$icon ", fontSize = 12.sp)
                Text(term, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onBackground)
            }
        }
    }
}
