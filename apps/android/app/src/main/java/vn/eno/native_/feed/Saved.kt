package vn.eno.native_.feed

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import vn.eno.native_.core.*

// Native Saved tab: device-local ids hydrated through the order-preserving
// /api/listings?ids= fast path; sold/hidden ids self-heal out of the store.
@Composable
fun SavedScreen(onOpen: (String) -> Unit) {
    val ctx = LocalContext.current
    LaunchedEffect(Unit) { Favorites.ensureLoaded(ctx) }
    val ids = Favorites.ids
    var listings by remember { mutableStateOf<List<ListingCard>>(emptyList()) }

    LaunchedEffect(ids.toList()) {
        if (ids.isEmpty()) { listings = emptyList(); return@LaunchedEffect }
        val requested = ids.toList()
        val page = runCatching {
            Api.get<FeedPage>("api/listings", mapOf("ids" to requested.joinToString(",")))
        }.getOrNull() ?: return@LaunchedEffect
        listings = page.listings
        Favorites.prune(ctx, requested, page.listings.map { it.id }.toSet())
    }

    if (ids.isEmpty()) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                L10n.tr("Nothing saved yet", "Chưa lưu tin nào"),
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                L10n.tr("Tap the heart on any listing to keep it here.", "Nhấn trái tim trên tin đăng để lưu lại đây."),
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    } else {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(12.dp),
        ) {
            items(listings.size) { idx ->
                val card = listings[idx]
                ListingCardView(card) { onOpen(card.id) }
            }
        }
    }
}
