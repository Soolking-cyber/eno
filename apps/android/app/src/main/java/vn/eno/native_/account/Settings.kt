package vn.eno.native_.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import vn.eno.native_.core.*

// Native Settings (#19) — replaces the /dashboard/settings WebTab. Profile edit
// (name/phone → PATCH /api/profile), account-type switch (→ POST /api/profile/
// account-type), and delete account (typed DELETE → POST /api/account/delete,
// with an identity re-check so a session swap can't delete the wrong account).
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    var initial by remember { mutableStateOf<MeUser?>(null) }
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var accountType by remember { mutableStateOf("individual") }
    var businessName by remember { mutableStateOf("") }
    var savingProfile by remember { mutableStateOf(false) }
    var profileMsg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var savingType by remember { mutableStateOf(false) }
    var typeMsg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var showDelete by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf("") }
    var deleteMsg by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val me = runCatching { Api.get<MeResponse>("api/me").user }.getOrNull()
        initial = me
        me?.let {
            name = it.displayName ?: ""; phone = it.phone ?: ""
            accountType = it.accountType ?: "individual"; businessName = it.businessName ?: ""
        }
    }

    val nameValid = name.trim().length >= 2

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(L10n.tr("‹ Back", "‹ Quay lại"), color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(12.dp))
            Text(L10n.tr("Settings", "Cài đặt"), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            // ── Profile ──
            Text(L10n.tr("Profile", "Hồ sơ"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(L10n.tr("Name", "Tên")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text(L10n.tr("Phone", "Số điện thoại")) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
            profileMsg?.let { Text(it.first, fontSize = 12.sp, color = if (it.second) Color0xFF16A34A else MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    if (!nameValid || savingProfile) return@Button
                    savingProfile = true; profileMsg = null
                    scope.launch {
                        val body = JSONObject().put("displayName", name.trim()).put("phone", phone.trim()).toString()
                        val code = runCatching { Api.send("PATCH", "api/profile", body) }.getOrNull()
                        savingProfile = false
                        profileMsg = when {
                            code != null && code in 200..299 -> L10n.tr("Saved", "Đã lưu") to true
                            code == 409 -> L10n.tr("That phone is already used by another account.", "Số điện thoại này đã được tài khoản khác dùng.") to false
                            code == 400 -> L10n.tr("Check your name and phone number.", "Kiểm tra tên và số điện thoại.") to false
                            else -> L10n.tr("Couldn't save. Try again.", "Không lưu được. Thử lại.") to false
                        }
                    }
                },
                enabled = nameValid && !savingProfile, modifier = Modifier.fillMaxWidth(),
            ) { if (savingProfile) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(L10n.tr("Save profile", "Lưu hồ sơ")) }

            Spacer(Modifier.height(22.dp))
            // ── Account type ──
            Text(L10n.tr("Account type", "Loại tài khoản"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TypePill(L10n.tr("Individual", "Cá nhân"), accountType == "individual", Modifier.weight(1f)) { accountType = "individual" }
                TypePill(L10n.tr("Business", "Doanh nghiệp"), accountType == "business", Modifier.weight(1f)) { accountType = "business" }
            }
            if (accountType == "business") {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = businessName, onValueChange = { businessName = it }, label = { Text(L10n.tr("Business name", "Tên doanh nghiệp")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            typeMsg?.let { Text(it.first, fontSize = 12.sp, color = if (it.second) Color0xFF16A34A else MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    val bizOk = accountType != "business" || businessName.trim().isNotEmpty()
                    if (!bizOk || savingType) return@Button
                    savingType = true; typeMsg = null
                    scope.launch {
                        val body = JSONObject().put("accountType", accountType)
                        if (accountType == "business") body.put("businessName", businessName.trim())
                        val code = runCatching { Api.send("POST", "api/profile/account-type", body.toString()) }.getOrNull()
                        savingType = false
                        typeMsg = if (code != null && code in 200..299) L10n.tr("Saved", "Đã lưu") to true
                        else L10n.tr("Couldn't update. Try again.", "Không cập nhật được. Thử lại.") to false
                    }
                },
                enabled = !savingType && (accountType != "business" || businessName.trim().isNotEmpty()), modifier = Modifier.fillMaxWidth(),
            ) { if (savingType) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(L10n.tr("Save account type", "Lưu loại tài khoản")) }

            Spacer(Modifier.height(24.dp))
            // ── Danger zone ──
            Text(L10n.tr("Delete account", "Xóa tài khoản"), color = MaterialTheme.colorScheme.error,
                fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { deleteConfirm = ""; deleteMsg = null; showDelete = true }.padding(vertical = 10.dp))
            deleteMsg?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
            Text(L10n.tr("Permanently deletes your account and listings.", "Xóa vĩnh viễn tài khoản và tin đăng của bạn."),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))
        }
    }

    if (showDelete) {
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text(L10n.tr("Delete account?", "Xóa tài khoản?")) },
            text = {
                Column {
                    Text(L10n.tr("Type DELETE to confirm. This can't be undone.", "Nhập DELETE để xác nhận. Không thể hoàn tác."))
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(value = deleteConfirm, onValueChange = { deleteConfirm = it }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (deleteConfirm != "DELETE") { deleteMsg = L10n.tr("Type DELETE to confirm.", "Nhập DELETE để xác nhận."); showDelete = false; return@TextButton }
                    showDelete = false
                    scope.launch {
                        // Identity guard: never delete blind if the session swapped.
                        val now = runCatching { Api.get<MeResponse>("api/me").user }.getOrNull()
                        if (now == null || now.email != initial?.email || now.phone != initial?.phone) {
                            deleteMsg = L10n.tr("Couldn't verify your account — reopen Settings.", "Không xác minh được tài khoản — mở lại Cài đặt."); return@launch
                        }
                        val code = runCatching { Api.send("POST", "api/account/delete", """{"confirm":"DELETE"}""") }.getOrNull()
                        if (code != null && code in 200..299) { Auth.signOut(); onBack() }
                        else deleteMsg = L10n.tr("Couldn't delete the account. Try again.", "Không xóa được tài khoản. Thử lại.")
                    }
                }) { Text(L10n.tr("Delete", "Xóa"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text(L10n.tr("Cancel", "Hủy")) } },
        )
    }
}

private val Color0xFF16A34A = androidx.compose.ui.graphics.Color(0xFF16A34A)

@Composable
private fun TypePill(label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(CircleShape)
            .background(if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick).padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            color = if (active) androidx.compose.ui.graphics.Color.White else MaterialTheme.colorScheme.onSurface)
    }
}

