package vn.eno.native_.feed

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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

// Web mobile "quick find" cascading selector (Android twin of QuickFind.swift):
// a CATEGORY icon swiper unfolding an inline blue-tint subcategory panel + a
// BRAND-logo swiper (7 brandable categories) unfolding a model panel. Icons in
// the muted body tone (not filled black), matching the web typography.
private val BRANDABLE = setOf(
    "electronics", "fashion-beauty", "vehicles", "rentals",
    "furniture-appliances", "baby-kids", "hobbies-sports",
)
private val panelLight = Color(0xFFE8F1FB) // web bg-brand-50
private val panelDark = Color(0xFF17314D)

private data class ChipData(val label: String, val icon: ImageVector?, val count: Int?, val active: Boolean, val onClick: () -> Unit)

class BrandRailViewModel : ViewModel() {
    private val _brands = MutableStateFlow<List<BrandItem>>(emptyList())
    val brands: StateFlow<List<BrandItem>> = _brands
    private val _models = MutableStateFlow<List<ModelItem>>(emptyList())
    val models: StateFlow<List<ModelItem>> = _models
    private var scope = ""

    fun loadBrands(category: String?, subcategory: String?) {
        val key = "$category|$subcategory"
        if (key == scope) return
        scope = key
        _models.value = emptyList()
        if (category == null || category !in BRANDABLE) { _brands.value = emptyList(); return }
        viewModelScope.launch {
            _brands.value = runCatching {
                Api.get<BrandsResponse>("api/brands", buildMap {
                    put("category", category); put("subcategory", subcategory ?: "all"); put("limit", "40")
                }).brands
            }.getOrDefault(emptyList())
        }
    }

    fun loadModels(brand: String, category: String?, subcategory: String?) {
        _models.value = emptyList()
        if (category == null) return
        viewModelScope.launch {
            _models.value = runCatching {
                Api.get<ModelsResponse>("api/brands/$brand/models", buildMap {
                    put("category", category); put("subcategory", subcategory ?: "all")
                }).models
            }.getOrDefault(emptyList())
        }
    }
}

@Composable
fun QuickFindBar(vm: FeedViewModel, onActiveChange: (Boolean) -> Unit = {}, brandVm: BrandRailViewModel = viewModel()) {
    var category by remember { mutableStateOf<String?>(null) }
    var subcategory by remember { mutableStateOf<String?>(null) }
    var brand by remember { mutableStateOf<String?>(null) }
    var model by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(category, brand) { onActiveChange(category != null || brand != null) }
    val brands by brandVm.brands.collectAsState()
    val models by brandVm.models.collectAsState()
    val counts by vm.subcategoryCounts.collectAsState()
    var subsByCat by remember { mutableStateOf<Map<String, List<ApiSubcategory>>>(emptyMap()) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(category, subcategory) { brandVm.loadBrands(category, subcategory) }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        // ── category rail ──
        val catState = rememberLazyListState()
        LaunchedEffect(category) {
            category?.let { c -> catState.animateScrollToItem((Categories.all.indexOfFirst { it.slug == c } + 1).coerceAtLeast(0)) }
        }
        LazyRow(state = catState, horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(horizontal = 12.dp)) {
            item {
                Tile(name = L10n.tr("All", "Tất cả"), active = category == null, icon = Icons.Outlined.Layers) {
                    category = null; subcategory = null; brand = null; model = null
                    vm.category = null; vm.subcategory = null; vm.brand = null; vm.model = null
                }
            }
            items(Categories.all, key = { it.slug }) { cat ->
                Row {
                    Tile(name = cat.name, active = category == cat.slug, icon = LucideIcons.forCategory(cat.slug)) {
                        val next = if (category == cat.slug) null else cat.slug
                        category = next; subcategory = null; brand = null; model = null
                        vm.category = next; vm.subcategory = null; vm.brand = null; vm.model = null
                        if (next != null && subsByCat[next] == null) {
                            scope.launch { subsByCat = subsByCat + (next to Taxonomy.subs(next)) }
                        }
                    }
                    AnimatedVisibility(visible = category == cat.slug) {
                        val subs = (subsByCat[cat.slug] ?: emptyList()).sortedByDescending { counts[it.slug] ?: 0 }
                        val chips = buildList {
                            add(ChipData(L10n.tr("All", "Tất cả"), null, null, subcategory == null) {
                                subcategory = null; brand = null; model = null; vm.subcategory = null; vm.brand = null; vm.model = null
                            })
                            subs.forEach { sub ->
                                add(ChipData(sub.displayName, LucideIcons.get(sub.icon), counts[sub.slug], subcategory == sub.slug) {
                                    val next = if (subcategory == sub.slug) null else sub.slug
                                    subcategory = next; brand = null; model = null
                                    vm.subcategory = next; vm.brand = null; vm.model = null
                                })
                            }
                        }
                        ExpansionPanel(chips)
                    }
                }
            }
        }

        // ── brand rail ──
        if (brands.isNotEmpty()) {
            val brandState = rememberLazyListState()
            LaunchedEffect(brand) {
                brand?.let { b -> brandState.animateScrollToItem(brands.indexOfFirst { it.slug == b }.coerceAtLeast(0)) }
            }
            LazyRow(state = brandState, horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(horizontal = 12.dp)) {
                items(brands, key = { it.slug }) { b ->
                    Row {
                        BrandTile(b, active = brand == b.slug) {
                            if (brand == b.slug) { brand = null; model = null; vm.brand = null; vm.model = null }
                            else {
                                brand = b.slug; model = null; vm.brand = b.slug; vm.model = null
                                brandVm.loadModels(b.slug, category, subcategory)
                            }
                        }
                        AnimatedVisibility(visible = brand == b.slug) {
                            val chips = buildList {
                                add(ChipData(L10n.tr("All", "Tất cả"), null, null, model == null) { model = null; vm.model = null })
                                models.forEach { m ->
                                    add(ChipData(m.model, null, m.count, model == m.model) {
                                        val next = if (model == m.model) null else m.model
                                        model = next; vm.model = next
                                    })
                                }
                            }
                            ExpansionPanel(chips)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(name: String, active: Boolean, icon: ImageVector, onClick: () -> Unit) {
    Column(
        Modifier.width(76.dp).clickable(onClick = onClick).padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
            // Muted body tone (not filled black); active = brand blue.
            Icon(icon, null, Modifier.size(26.dp),
                tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(name, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
            maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

@Composable
private fun BrandTile(b: BrandItem, active: Boolean, onClick: () -> Unit) {
    val hex = if (active) "0a66c2" else "525252"
    Column(
        Modifier.width(76.dp).clickable(onClick = onClick).padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            AsyncImage(
                model = "https://eno.vn/api/brands/${b.slug}/logo?w=96&c=$hex",
                contentDescription = b.name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(44.dp),
            )
        }
        Text(b.name, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
            maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ExpansionPanel(chips: List<ChipData>) {
    val dark = isSystemInDarkTheme()
    Row(Modifier.padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(1.dp).height(48.dp).background(MaterialTheme.colorScheme.outline))
        Spacer(Modifier.width(8.dp))
        // 3-row COLUMN-major grid: chunk chips into columns of 3 (non-lazy — small N).
        Row(
            Modifier.clip(RoundedCornerShape(11.dp)).background(if (dark) panelDark else panelLight).padding(6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            chips.chunked(3).forEach { col ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    col.forEach { Chip(it) }
                }
            }
        }
    }
}

@Composable
private fun Chip(data: ChipData) {
    val tint = if (data.active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.clip(RoundedCornerShape(7.dp))
            .background(if (data.active) MaterialTheme.colorScheme.surface else Color.Transparent)
            .clickable(onClick = data.onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (data.icon != null) Icon(data.icon, null, Modifier.size(14.dp), tint = tint)
        Text(data.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = tint, maxLines = 1)
        if (data.count != null) Text("${data.count}", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
