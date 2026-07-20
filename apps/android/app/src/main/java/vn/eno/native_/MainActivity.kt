package vn.eno.native_

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
        vn.eno.native_.core.Auth.init(applicationContext)
        enableEdgeToEdge()
        setContent { EnoApp() }
        handleAuthRedirect(intent)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthRedirect(intent)
    }

    // The Google-OAuth Custom Tab redirects to enonative://auth-callback?code=…;
    // hand the code to GoogleAuth to finish the native PKCE exchange.
    private fun handleAuthRedirect(intent: android.content.Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "enonative" && data.host == "auth-callback") {
            vn.eno.native_.core.GoogleAuth.handleRedirect(data)
        }
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
            error = Palette.dangerDark,
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
            error = Palette.dangerLight,
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

// A web route hosted inside native chrome (back bar + title) — the hybrid escape
// hatch for surfaces without a native screen yet (e.g. the AI concierge, #14).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WebScreen(path: String, title: String, onBack: () -> Unit) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) { WebTab(path) }
    }
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
        val signedIn = vn.eno.native_.core.Auth.isSignedIn
        // Refresh the message-unread AND notification-unread badges on startup,
        // sign-in, and tab changes — the bell couldn't show a dot before opening
        // the list otherwise (codex #13).
        LaunchedEffect(currentRoute, signedIn) {
            vn.eno.native_.core.Unread.refresh()
            vn.eno.native_.account.Notifs.refresh()
        }

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
                            icon = {
                                if (tab.route == "messages" && vn.eno.native_.core.Unread.count > 0) {
                                    BadgedBox(badge = {
                                        Badge { Text(if (vn.eno.native_.core.Unread.count > 9) "9+" else "${vn.eno.native_.core.Unread.count}") }
                                    }) { tab.icon() }
                                } else {
                                    tab.icon()
                                }
                            },
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
                        onBell = { nav.navigate("notifications") },
                        onAiConcierge = { nav.navigate("aiconcierge") },
                    )
                }
                composable("aiconcierge") {
                    WebScreen(
                        path = "/messages/ai",
                        title = L10n.tr("AI shopping", "Mua sắm AI"),
                        onBack = { nav.popBackStack() },
                    )
                }
                composable("notifications") {
                    vn.eno.native_.account.NotificationsScreen(
                        onThread = { convoId -> nav.navigate("thread/$convoId") },
                        onListing = { id -> nav.navigate("listing/$id") },
                        onBack = { nav.popBackStack() },
                    )
                }
                composable("mylistings") {
                    vn.eno.native_.account.MyListingsScreen(onBack = { nav.popBackStack() })
                }
                composable("search") {
                    vn.eno.native_.feed.SearchScreen(onOpen = { id -> nav.navigate("listing/$id") })
                }
                composable("listing/{id}") { entry ->
                    DetailScreen(
                        entry.arguments?.getString("id") ?: "",
                        onOpen = { id -> nav.navigate("listing/$id") },
                        openThread = { convoId -> nav.navigate("thread/$convoId") },
                        openSignIn = { nav.navigate("account") },
                    )
                }
                composable("thread/{id}") { entry ->
                    vn.eno.native_.messages.ThreadScreen(
                        convoId = entry.arguments?.getString("id") ?: "",
                        onBack = { nav.popBackStack() },
                    )
                }
                composable("saved") { vn.eno.native_.feed.SavedScreen(onOpen = { id -> nav.navigate("listing/$id") }) }
                composable("post") { vn.eno.native_.post.PostScreen() }
                composable("messages") { vn.eno.native_.messages.MessagesScreen() }
                composable("account") {
                    vn.eno.native_.account.AccountScreen(onMyListings = { nav.navigate("mylistings") })
                }
            }
        }
    }
}
