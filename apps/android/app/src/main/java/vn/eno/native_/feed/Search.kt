package vn.eno.native_.feed

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import vn.eno.native_.core.*

// Native search (Android v2): debounced q → /api/listings (same ranked results
// as the web), grid reuse. Recents/trending/typeahead come next — iOS parity.
@Composable
fun SearchScreen(onOpen: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<ListingCard>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(250)
        searching = true
        results = runCatching {
            Api.get<FeedPage>("api/listings", mapOf("q" to q, "limit" to "24")).listings
        }.getOrDefault(emptyList())
        searching = false
    }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text(L10n.tr("Find products…", "Tìm sản phẩm…")) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
        )
        if (searching) {
            Box(Modifier.fillMaxWidth().padding(top = 24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (results.isEmpty() && query.trim().length >= 2) {
            Text(
                L10n.tr("No results for \"${query.trim()}\"", "Không tìm thấy \"${query.trim()}\""),
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(24.dp).align(Alignment.CenterHorizontally),
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(12.dp),
            ) {
                items(results.size) { idx ->
                    val card = results[idx]
                    ListingCardView(card) { onOpen(card.id) }
                }
            }
        }
    }
}
