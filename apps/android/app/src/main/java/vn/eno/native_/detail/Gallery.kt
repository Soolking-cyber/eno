package vn.eno.native_.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import vn.eno.native_.core.ImageUrl

// Fullscreen gallery (Android parity with apps/ios GalleryViewer): swipeable
// pages, pinch-to-zoom + double-tap reset, dark chrome, tap-X to dismiss.
@Composable
fun GalleryOverlay(images: List<String>, start: Int, onDismiss: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val pager = rememberPagerState(initialPage = start) { images.size.coerceAtLeast(1) }
        HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
            var scale by remember(page) { mutableStateOf(1f) }
            var offsetX by remember(page) { mutableStateOf(0f) }
            var offsetY by remember(page) { mutableStateOf(0f) }
            AsyncImage(
                model = images.getOrNull(page)?.let { ImageUrl.optimized(it, 1080) },
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offsetX, translationY = offsetY)
                    .pointerInput(page) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 4f)
                            if (scale > 1f) { offsetX += pan.x; offsetY += pan.y }
                            else { offsetX = 0f; offsetY = 0f }
                        }
                    }
                    .pointerInput(page) {
                        detectTapGestures(onDoubleTap = {
                            if (scale > 1f) { scale = 1f; offsetX = 0f; offsetY = 0f } else scale = 2.5f
                        })
                    },
            )
        }
        Icon(
            Icons.Filled.Close,
            contentDescription = "Close",
            tint = Color.White,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 40.dp, end = 16.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.15f))
                .let { m -> m.then(Modifier.pointerInput(Unit) { detectTapGestures { onDismiss() } }) }
                .padding(10.dp)
                .size(18.dp),
        )
    }
}
