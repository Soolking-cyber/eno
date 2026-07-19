package vn.eno.native_.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.Intent
import android.net.Uri
import coil.compose.AsyncImage
import vn.eno.native_.core.*

// PDP v1 (Android), mirroring the iOS detail's hierarchy: gallery pager →
// price → title/meta → description → seller. Contact opens the listing's web
// page (Custom-Tab-less v1: system browser) until native chat lands here.
@Composable
fun DetailScreen(id: String, onOpen: (String) -> Unit) {
    var detail by remember { mutableStateOf<ListingDetail?>(null) }
    val ctx = LocalContext.current

    LaunchedEffect(id) {
        detail = runCatching { Api.get<ListingDetailEnvelope>("api/listings/$id").listing }.getOrNull()
    }

    val d = detail
    if (d == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f)) {
            item {
                val pager = rememberPagerState { d.images.size.coerceAtLeast(1) }
                HorizontalPager(pager) { page ->
                    AsyncImage(
                        model = d.images.getOrNull(page)?.let { ImageUrl.optimized(it, 1080) },
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(1f)
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    )
                }
            }
            item {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        Format.vnd(d.price),
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(d.displayTitle, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        listOf(d.displayLocation, "${d.views} ${L10n.tr("views", "lượt xem")}")
                            .filter { it.isNotEmpty() }
                            .joinToString(" · "),
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (d.description.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                        Spacer(Modifier.height(12.dp))
                        Text(d.description, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface, lineHeight = 21.sp)
                    }
                    Spacer(Modifier.height(12.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(22.dp))
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                d.seller.name.take(1).uppercase(),
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 18.sp,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(d.seller.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
        Button(
            onClick = {
                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://eno.vn/listings/$id")))
            },
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .height(50.dp),
        ) {
            Text(L10n.tr("Contact seller", "Liên hệ người bán"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
