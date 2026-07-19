package vn.eno.native_

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.*
import vn.eno.native_.core.L10n
import vn.eno.native_.core.Palette
import vn.eno.native_.detail.DetailScreen
import vn.eno.native_.feed.FeedScreen
import vn.eno.native_.ui.WebTab

// eno native Android — the same product as apps/ios, Compose UI, same APIs.
// v1: native Explore (feed + PDP); the remaining tabs embed the real web app
// (EnoNativeTabs UA — eno.vn hides its own bottom nav on that marker) until
// their native screens land, mirroring how the iOS rewrite proceeded.
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { EnoApp() }
    }
}

@Composable
fun EnoTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) {
        darkColorScheme(
            primary = Palette.brandDark,
            background = Palette.canvasDark,
            surface = Palette.cardDark,
            surfaceVariant = Palette.tintDark,
            onBackground = Palette.fgDark,
            onSurface = Palette.fgDark,
            onSurfaceVariant = Palette.subDark,
            outline = Palette.ringDark,
            error = Palette.danger,
        )
    } else {
        lightColorScheme(
            primary = Palette.brandLight,
            background = Palette.canvasLight,
            surface = Palette.cardLight,
            surfaceVariant = Palette.tintLight,
            onBackground = Palette.fgLight,
            onSurface = Palette.fgLight,
            onSurfaceVariant = Palette.subLight,
            outline = Palette.ringLight,
            error = Palette.danger,
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

private data class Tab(val route: String, val label: String, val icon: @Composable () -> Unit)

@Composable
fun EnoApp() {
    EnoTheme {
        val nav = rememberNavController()
        val tabs = listOf(
            Tab("explore", L10n.tr("Explore", "Khám phá")) { Icon(Icons.Outlined.Explore, null) },
            Tab("saved", L10n.tr("Saved", "Đã lưu")) { Icon(Icons.Outlined.FavoriteBorder, null) },
            Tab("post", L10n.tr("Post", "Đăng tin")) { Icon(Icons.Filled.AddBox, null) },
            Tab("messages", L10n.tr("Messages", "Tin nhắn")) { Icon(Icons.Outlined.ChatBubbleOutline, null) },
            Tab("account", L10n.tr("Account", "Tài khoản")) { Icon(Icons.Outlined.Person, null) },
        )
        val backStack by nav.currentBackStackEntryAsState()
        val currentRoute = backStack?.destination?.route

        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute == tab.route || (tab.route == "explore" && currentRoute?.startsWith("listing/") == true),
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo("explore") { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = tab.icon,
                            label = { Text(tab.label) },
                        )
                    }
                }
            },
        ) { padding ->
            NavHost(nav, startDestination = "explore", modifier = Modifier.padding(padding)) {
                composable("explore") {
                    FeedScreen(
                        onOpen = { id -> nav.navigate("listing/$id") },
                        onSearch = { nav.navigate("search") },
                    )
                }
                composable("search") {
                    vn.eno.native_.feed.SearchScreen(onOpen = { id -> nav.navigate("listing/$id") })
                }
                composable("listing/{id}") { entry ->
                    DetailScreen(entry.arguments?.getString("id") ?: "", onOpen = { id -> nav.navigate("listing/$id") })
                }
                composable("saved") { vn.eno.native_.feed.SavedScreen(onOpen = { id -> nav.navigate("listing/$id") }) }
                composable("post") { WebTab("/post") }
                composable("messages") { WebTab("/messages") }
                composable("account") { WebTab("/dashboard") }
            }
        }
    }
}
