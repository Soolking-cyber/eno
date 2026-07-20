package vn.eno.native_.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.serialization.Serializable
import vn.eno.native_.feed.ListingCardView
import vn.eno.native_.feed.TrustMini
import vn.eno.native_.core.*

@Serializable private data class Storefront(
    val seller: StoreSeller, val listings: List<ListingCard> = emptyList(), val reviews: StoreReviews = StoreReviews(),
)
@Serializable private data class StoreSeller(
    val id: String, val name: String, val avatarUrl: String? = null, val avatarColor: String? = null,
    val bio: String? = null, val location: String? = null, val isBusiness: Boolean = false,
    val trustScore: Int = 100, val rating: Double = 0.0, val reviewCount: Int = 0,
    val memberSinceYear: Int = 0, val responseLabel: ResponseLabel? = null,
)
@Serializable private data class ResponseLabel(val en: String, val vi: String)
@Serializable private data class StoreReviews(val reviews: List<StoreReview> = emptyList(), val total: Int = 0, val avg: Double = 0.0)
@Serializable private data class StoreReview(val author: String, val rating: Int, val text: String = "", val verified: Boolean = false, val createdAt: String = "")

// Native seller storefront (#9 Android parity) — replaces the external-browser
// ACTION_VIEW redirect the PDP seller card used. GET /api/sellers/[id]: header
// (avatar/name/business/trust/rating/member-since/bucketed response/bio) +
// reviews + the seller's active listings (tap → native PDP).
@Composable
fun StorefrontScreen(sellerId: String, onOpen: (String) -> Unit, onBack: () -> Unit) {
    var data by remember { mutableStateOf<Storefront?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(sellerId) {
        data = runCatching { Api.get<Storefront>("api/sellers/$sellerId") }.getOrNull(); loading = false
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(L10n.tr("‹ Back", "‹ Quay lại"), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(12.dp))
            Text(data?.seller?.name ?: L10n.tr("Storefront", "Gian hàng"), fontWeight = FontWeight.Bold, maxLines = 1, color = MaterialTheme.colorScheme.onBackground)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        val d = data
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(L10n.tr("This storefront isn't available.", "Gian hàng này không có sẵn."), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(12.dp),
            ) {
                item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) { header(d.seller) }
                if (d.reviews.reviews.isNotEmpty()) {
                    item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) { reviews(d.reviews) }
                }
                if (d.listings.isNotEmpty()) {
                    item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                        Text(L10n.tr("Listings", "Tin đăng"), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.padding(top = 6.dp))
                    }
                    items(d.listings, key = { it.id }) { card -> ListingCardView(card) { onOpen(card.id) } }
                }
            }
        }
    }
}

@Composable
private fun header(s: StoreSeller) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (s.avatarUrl != null) {
                AsyncImage(model = ImageUrl.optimized(s.avatarUrl, 160), contentDescription = null, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(60.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant))
            } else {
                Box(Modifier.size(60.dp).clip(CircleShape).background(runCatching { Color(android.graphics.Color.parseColor(s.avatarColor ?: "#0A66C2")) }.getOrDefault(MaterialTheme.colorScheme.primary)), contentAlignment = Alignment.Center) {
                    Text(s.name.take(1).uppercase(), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(s.name, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                    if (s.isBusiness) { Spacer(Modifier.width(6.dp)); Icon(Icons.Outlined.Store, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TrustMini(s.trustScore)
                    if (s.reviewCount > 0) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Star, null, Modifier.size(11.dp), tint = Color(0xFFF59E0B))
                            Text(" ${"%.1f".format(s.rating)} (${s.reviewCount})", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        val meta = buildList {
            if (s.memberSinceYear > 0) add(L10n.tr("Since ${s.memberSinceYear}", "Từ ${s.memberSinceYear}"))
            s.responseLabel?.let { add(if (L10n.isVi) it.vi else it.en) }
            if (!s.location.isNullOrEmpty()) add(s.location)
        }
        if (meta.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(meta.joinToString(" · "), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!s.bio.isNullOrEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(s.bio, fontSize = 14.sp, color = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@Composable
private fun reviews(r: StoreReviews) {
    Column(Modifier.fillMaxWidth()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Text(L10n.tr("Reviews", "Đánh giá"), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.padding(vertical = 8.dp))
        r.reviews.take(3).forEach { rv ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                repeat(5) { i -> Icon(Icons.Filled.Star, null, Modifier.size(10.dp), tint = if (i < rv.rating) Color(0xFFF59E0B) else MaterialTheme.colorScheme.outline) }
                Spacer(Modifier.width(4.dp))
                Text(rv.author, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground)
                if (rv.verified) { Spacer(Modifier.width(4.dp)); Text(L10n.tr("Verified", "Đã xác minh"), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary) }
            }
            if (rv.text.isNotEmpty()) Text(rv.text, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))
        }
    }
}
