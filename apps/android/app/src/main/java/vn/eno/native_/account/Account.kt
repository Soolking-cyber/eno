package vn.eno.native_.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.Serializable
import vn.eno.native_.core.*
import vn.eno.native_.ui.WebTab

// Native Account tab (Android port of apps/ios AccountView): guest → the web
// sign-in inside the tab (phone/email OTP work in place; the enoAuth bridge
// adopts the session and the view flips native); signed in → /api/me profile
// with web-sheet links + sign out.
@Serializable
data class MeUser(
    val displayName: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val accountType: String? = null,
    val businessName: String? = null,
)

@Serializable
data class MeResponse(val user: MeUser? = null)

@Composable
fun AccountScreen() {
    val signedIn = Auth.isSignedIn
    var me by remember { mutableStateOf<MeUser?>(null) }
    var showSignIn by remember { mutableStateOf(false) }
    var webPath by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(signedIn) {
        if (signedIn) {
            showSignIn = false
            me = runCatching { Api.get<MeResponse>("api/me").user }.getOrNull()
        } else {
            me = null
        }
    }

    when {
        webPath != null -> {
            // Simple inline web surface with a Close row.
            Column(Modifier.fillMaxSize()) {
                Text(
                    L10n.tr("‹ Back", "‹ Quay lại"),
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clickable { webPath = null }
                        .padding(14.dp),
                )
                WebTab(webPath!!)
            }
        }
        signedIn -> Profile(me, onOpen = { webPath = it }, onSignOut = { Auth.signOut() })
        showSignIn -> Column(Modifier.fillMaxSize()) {
            Text(
                L10n.tr("‹ Back", "‹ Quay lại"),
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clickable { showSignIn = false }
                    .padding(14.dp),
            )
            WebTab("/signin")
        }
        else -> GuestHero { showSignIn = true }
    }
}

@Composable
private fun GuestHero(onSignIn: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("eno", fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(12.dp))
        Text(
            L10n.tr(
                "Sign in to chat with sellers, save listings and manage your posts.",
                "Đăng nhập để nhắn tin với người bán, lưu tin và quản lý tin đăng.",
            ),
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onSignIn,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) {
            Text(L10n.tr("Sign in", "Đăng nhập"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Profile(me: MeUser?, onOpen: (String) -> Unit, onSignOut: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(56.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (me?.displayName ?: "e").take(1).uppercase(),
                    color = Color.White,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(me?.displayName ?: "…", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground)
                Text(me?.phone ?: me?.email ?: "", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (me?.accountType == "business") {
                    Text(
                        me.businessName ?: L10n.tr("Business", "Doanh nghiệp"),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        listOf(
            L10n.tr("My listings", "Tin đăng của tôi") to "/dashboard/listings",
            L10n.tr("Settings", "Cài đặt") to "/dashboard/settings",
        ).forEach { (label, path) ->
            Text(
                label,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(path) }
                    .padding(vertical = 14.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
        Spacer(Modifier.height(20.dp))
        Text(
            L10n.tr("Sign out", "Đăng xuất"),
            color = MaterialTheme.colorScheme.error,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable(onClick = onSignOut).padding(vertical = 8.dp),
        )
    }
}
