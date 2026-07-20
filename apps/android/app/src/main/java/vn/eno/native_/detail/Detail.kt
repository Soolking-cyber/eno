package vn.eno.native_.detail

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import vn.eno.native_.core.*
import vn.eno.native_.feed.TrustMini

// PDP v2 (Android), parity with the iOS detail: gallery (save/share overlay) →
// price block (prevPrice strikethrough, ≈USD, urgent, market gauge) → title →
// meta chips (posted-ago, condition, year, km) → description → seller card
// (trust ladder, rating, business, member-since, storefront tap) → safety
// strip → Chat CTA.
@Composable
fun DetailScreen(
    id: String,
    onOpen: (String) -> Unit,
    openThread: (String) -> Unit = {},
    openSignIn: () -> Unit = {},
) {
    var detail by remember { mutableStateOf<ListingDetail?>(null) }
    var band by remember { mutableStateOf<PriceBand?>(null) }
    var unavailable by remember { mutableStateOf(false) }
    var chatBusy by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var viewerPage by remember { mutableStateOf<Int?>(null) }
    var fav by remember { mutableStateOf(false) }

    LaunchedEffect(id) {
        RecentStore.recordViewed(ctx, id)
        Favorites.ensureLoaded(ctx)
        fav = Favorites.isFavorite(id)
        try {
            val env = Api.get<ListingDetailEnvelope>("api/listings/$id")
            detail = env.listing; band = env.priceBand
        } catch (e: Exception) { unavailable = true } // 404 = sold/hidden/removed
    }

    val d = detail
    if (d == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (unavailable) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Outlined.Block, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Text(L10n.tr("This listing is no longer available", "Tin này không còn nữa"),
                        fontSize = 17.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                    Spacer(Modifier.height(6.dp))
                    Text(L10n.tr("It may have been sold or removed.", "Có thể đã bán hoặc bị gỡ."),
                        fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else CircularProgressIndicator()
        }
        return
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f)) {
                // ── gallery + save/share overlay (item 21) ──
                item {
                    Box {
                        val pager = rememberPagerState { d.images.size.coerceAtLeast(1) }
                        HorizontalPager(pager) { page ->
                            AsyncImage(
                                model = d.images.getOrNull(page)?.let { ImageUrl.optimized(it, 1080) },
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxWidth().aspectRatio(1f)
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable { viewerPage = page },
                            )
                        }
                        Row(Modifier.align(Alignment.TopEnd).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircleIcon(if (fav) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                                tint = if (fav) MaterialTheme.colorScheme.primary else Color.White) {
                                Favorites.toggle(ctx, id); fav = Favorites.isFavorite(id)
                            }
                            CircleIcon(Icons.Outlined.Share, tint = Color.White) {
                                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "https://eno.vn/listings/$id")
                                }, null))
                            }
                        }
                    }
                }
                item {
                    Column(Modifier.padding(16.dp)) {
                        // ── price block: prevPrice strikethrough + ≈USD + urgent (item 19) ──
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(Format.vnd(d.price), color = MaterialTheme.colorScheme.primary, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(8.dp))
                            val prev = d.prevPrice?.takeIf { it > d.price }
                            if (prev != null) {
                                Text(Format.vnd(prev), fontSize = 14.sp, textDecoration = TextDecoration.LineThrough,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else Fx.approxUSD(d.price)?.let {
                                Text(it, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (d.urgent) {
                                Spacer(Modifier.width(8.dp))
                                Chip(L10n.tr("Urgent", "Bán gấp"), MaterialTheme.colorScheme.error, Color.White)
                            }
                        }
                        // ── market gauge (item 18) ──
                        band?.let { MarketGauge(d.price, it) }
                        Spacer(Modifier.height(10.dp))
                        Text(d.displayTitle, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            listOfNotNull(d.displayLocation.ifEmpty { null }, Format.ago(d.postedAt).ifEmpty { null },
                                "${d.views} ${L10n.tr("views", "lượt xem")}").joinToString(" · "),
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        // ── condition / year / km chips (item 20) ──
                        val facts = listOfNotNull(
                            d.condition?.let { conditionLabel(it) },
                            d.year?.toString(),
                            d.mileageKm?.let { "%,d km".format(it) },
                        )
                        if (facts.isNotEmpty()) {
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                facts.forEach { Chip(it, MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurface) }
                            }
                        }
                        if (d.description.isNotEmpty()) {
                            Spacer(Modifier.height(14.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outline); Spacer(Modifier.height(14.dp))
                            Text(d.description, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface, lineHeight = 21.sp)
                        }
                        // ── seller card (item 29) ──
                        Spacer(Modifier.height(14.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outline); Spacer(Modifier.height(14.dp))
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                                .clickable { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://eno.vn/sellers/${d.seller.id}"))) }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(44.dp).clip(CircleShape).background(hexColor(d.seller.avatarColor) ?: MaterialTheme.colorScheme.primary),
                                contentAlignment = Alignment.Center) {
                                Text(d.seller.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(d.seller.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                                    Spacer(Modifier.width(6.dp))
                                    TrustMini(d.seller.trustScore)
                                }
                                val sub = listOfNotNull(
                                    d.seller.rating?.takeIf { d.seller.reviewCount > 0 }?.let { "★ %.1f (${d.seller.reviewCount})".format(it) },
                                    if (d.seller.isBusiness) L10n.tr("Business", "Doanh nghiệp") else null,
                                    memberSinceYear(d.seller.memberSince)?.let { L10n.tr("Member since $it", "Thành viên từ $it") },
                                ).joinToString(" · ")
                                if (sub.isNotEmpty()) Text(sub, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        // ── safety strip (item 23) ──
                        Spacer(Modifier.height(16.dp))
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)).padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.Shield, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.width(10.dp))
                            Text(safetyCopy(d.categorySafetyKey()), fontSize = 12.sp, lineHeight = 17.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Spacer(Modifier.height(24.dp))
                    }
                }
            }
            // ── Chat CTA ──
            Button(
                onClick = {
                    if (!Auth.isSignedIn) { openSignIn(); return@Button }
                    if (chatBusy) return@Button
                    chatBusy = true
                    scope.launch {
                        try {
                            val r = Api.post<CreateConvoResponse>("api/conversations", """{"listingId":"$id"}""")
                            openThread(r.id)
                        } catch (_: Exception) {
                            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://eno.vn/listings/$id")))
                        } finally { chatBusy = false }
                    }
                },
                enabled = !chatBusy,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().padding(16.dp).height(50.dp),
            ) {
                Text(L10n.tr("Chat with seller", "Nhắn tin cho người bán"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        viewerPage?.let { p -> GalleryOverlay(d.images, p) { viewerPage = null } }
    }
}

@Composable
private fun CircleIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.35f)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, Modifier.size(20.dp), tint = tint) }
}

@Composable
private fun Chip(text: String, bg: Color, fg: Color) {
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = fg,
        modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 4.dp))
}

// Market gauge (web MarketPrice): p25–p75 band with the price marker; green
// below the band, brand in-band, gray above. Caption states the median.
@Composable
private fun MarketGauge(price: Long, band: PriceBand) {
    val span = (band.p75 - band.p25).coerceAtLeast(1.0)
    val pos = ((price - band.p25) / span).coerceIn(0.0, 1.0).toFloat()
    val accent = when {
        price < band.p25 -> Color(0xFF16A34A)
        price > band.p75 -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.primary
    }
    Column(Modifier.padding(top = 8.dp)) {
        Box(Modifier.fillMaxWidth().height(12.dp)) {
            Box(Modifier.fillMaxWidth().height(6.dp).align(Alignment.CenterStart).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant))
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                Box(Modifier.padding(start = (maxWidth - 12.dp) * pos).size(12.dp).clip(CircleShape).background(accent))
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Format.vnd(band.p25.toLong()), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(L10n.tr("Market ${Format.vnd(band.median.toLong())}", "Giá thị trường ${Format.vnd(band.median.toLong())}"),
                fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(Format.vnd(band.p75.toLong()), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun conditionLabel(c: String): String = when (c) {
    "new" -> L10n.tr("New", "Mới"); "like-new" -> L10n.tr("Like new", "Như mới")
    "good" -> L10n.tr("Good", "Tốt"); "fair" -> L10n.tr("Fair", "Khá"); "used" -> L10n.tr("Used", "Đã dùng")
    else -> c
}

private fun hexColor(hex: String?): Color? = runCatching {
    hex?.trim()?.removePrefix("#")?.takeIf { it.length == 6 }?.let { Color(("FF$it").toLong(16)) }
}.getOrNull()

private fun memberSinceYear(iso: String): String? =
    runCatching { java.time.Instant.parse(iso).atZone(java.time.ZoneOffset.UTC).year.toString() }.getOrNull()

// Category-aware safety copy near the contact CTA (item 23), bilingual in-file.
private fun ListingDetail.categorySafetyKey(): String = "default"
private fun safetyCopy(@Suppress("UNUSED_PARAMETER") key: String): String =
    L10n.tr("Meet in a public place, inspect the item, and never pay before you receive it.",
            "Gặp ở nơi công cộng, kiểm tra hàng, và đừng thanh toán trước khi nhận.")
