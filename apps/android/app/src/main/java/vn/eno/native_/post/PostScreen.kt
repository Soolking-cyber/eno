package vn.eno.native_.post

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import vn.eno.native_.core.*

// The Post tab, native (Android): photos → category → details → price →
// location → contact → submit. Uploads start on pick; the button explains
// exactly what's missing; success shows a confirmation.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostScreen() {
    val vm: PostViewModel = viewModel()
    val ctx = LocalContext.current
    var signedInGate by remember { mutableStateOf(Auth.isSignedIn) }

    LaunchedEffect(Unit) { vm.start() }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(8),
    ) { uris -> uris.forEach { vm.addPhoto(ctx, it) } }
    val videoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> uri?.let { vm.addVideo(ctx, it) } }

    vm.createdId?.let {
        SuccessCard { vm.createdId = null }
        return
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        SectionTitle(L10n.tr("Photos", "Hình ảnh"))
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier
                    .size(84.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable {
                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(L10n.tr("+ Add", "+ Thêm"), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            }
            vm.photos.forEach { photo ->
                Box(Modifier.size(84.dp)) {
                    androidx.compose.foundation.Image(
                        bitmap = photo.bitmap.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)),
                    )
                    if (photo.url == null && !photo.failed) {
                        CircularProgressIndicator(Modifier.align(Alignment.Center).size(24.dp))
                    }
                    if (photo.failed) {
                        Text(
                            "↻",
                            color = Color.White,
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color.Black.copy(alpha = 0.45f))
                                .clickable { vm.retryPhoto(photo.id) }
                                .wrapContentSize(Alignment.Center),
                        )
                    }
                    Text(
                        "✕",
                        color = Color.White,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(4.dp)
                            .background(Color.Black.copy(alpha = 0.55f), androidx.compose.foundation.shape.CircleShape)
                            .clickable { vm.removePhoto(photo.id) }
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
            }
        }
        Text(
            L10n.tr("At least 3 photos from different angles.", "Ít nhất 3 ảnh chụp các góc khác nhau."),
            fontSize = 12.sp,
            color = if (vm.uploadedUrls.size >= 3) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(top = 6.dp),
        )
        // Optional single clip (≤60s).
        if (vm.videoUploading) {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(L10n.tr("Uploading video…", "Đang tải video…"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else if (vm.videoUrl != null) {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(L10n.tr("✓ Video added", "✓ Đã thêm video"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.weight(1f))
                Text(L10n.tr("Remove", "Xóa"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.error, modifier = Modifier.clickable { vm.removeVideo() })
            }
        } else {
            Text(L10n.tr("+ Add video (optional)", "+ Thêm video (tùy chọn)"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 8.dp).clickable {
                    videoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
                })
        }
        vm.videoError?.let {
            Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
        }
        // ✨ On-device AI auto-fill — appears once a photo is added.
        if (vm.photos.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { vm.autofill(ctx) },
                enabled = !vm.autofilling,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (vm.autofilling) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("✨  " + L10n.tr("Auto-fill from photo", "Điền tự động từ ảnh"), fontWeight = FontWeight.SemiBold)
                }
            }
            vm.autofillError?.let {
                Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
            }
        }

        SectionTitle(L10n.tr("Category", "Danh mục"))
        Dropdown(
            value = Categories.all.firstOrNull { it.slug == vm.categorySlug }?.name ?: L10n.tr("Choose…", "Chọn…"),
            options = Categories.all.map { it.name to it.slug },
        ) { vm.categorySlug = it }

        SectionTitle(L10n.tr("Details", "Chi tiết"))
        OutlinedTextField(vm.title, { vm.title = it }, label = { Text(L10n.tr("Title", "Tiêu đề")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            vm.description, { vm.description = it },
            label = { Text(L10n.tr("Description", "Mô tả")) },
            minLines = 3, modifier = Modifier.fillMaxWidth(),
            supportingText = {
                val n = vm.description.trim().length
                if (n < 20) Text(L10n.tr("At least 20 characters ($n/20).", "Ít nhất 20 ký tự ($n/20)."))
            },
        )
        Spacer(Modifier.height(8.dp))
        Dropdown(
            value = PostViewModel.conditions.firstOrNull { it.first == vm.condition }
                ?.let { L10n.tr(it.second.first, it.second.second) } ?: L10n.tr("Condition (optional)", "Tình trạng (tùy chọn)"),
            options = PostViewModel.conditions.map { L10n.tr(it.second.first, it.second.second) to it.first },
        ) { vm.condition = it }

        SectionTitle(L10n.tr("Price", "Giá"))
        OutlinedTextField(
            vm.priceText, { vm.priceText = it.filter { c -> c.isDigit() } },
            label = { Text("đ") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(vm.negotiable, { vm.negotiable = it })
            Text(L10n.tr("Open to offers", "Cho phép trả giá"), color = MaterialTheme.colorScheme.onBackground)
        }

        SectionTitle(L10n.tr("Location", "Khu vực"))
        Dropdown(
            value = vm.province?.name ?: L10n.tr("Province", "Tỉnh / Thành"),
            options = vm.provinces.map { it.name to it.code },
        ) { code -> vm.provinces.firstOrNull { it.code == code }?.let { vm.pickProvince(it) } }
        if (vm.wards.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Dropdown(
                value = vm.ward?.name ?: L10n.tr("Ward", "Phường / Xã"),
                options = vm.wards.map { it.name to it.code },
            ) { code -> vm.ward = vm.wards.firstOrNull { it.code == code } }
        }

        SectionTitle(L10n.tr("Contact", "Liên hệ"))
        OutlinedTextField(
            vm.contactPhone, { vm.contactPhone = it },
            label = { Text(L10n.tr("Phone number", "Số điện thoại")) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Text(
            L10n.tr("Buyers chat in-app; your number is only revealed after you reply.",
                "Người mua nhắn tin trong ứng dụng; số của bạn chỉ hiện sau khi bạn trả lời."),
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp),
        )

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { vm.submit() },
            enabled = vm.canSubmit,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) {
            if (vm.submitting) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White)
            else Text(L10n.tr("Post listing", "Đăng tin"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        vm.errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Dropdown(value: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (label, key) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { onPick(key); open = false })
            }
        }
    }
}

@Composable
private fun SuccessCard(onDone: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("✓", fontSize = 52.sp, color = Color(0xFF16A34A), fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        Text(
            L10n.tr("Your listing is live!", "Tin của bạn đã được đăng!"),
            fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            L10n.tr("Buyers can see it right away. You'll be notified about messages and offers.",
                "Người mua có thể xem ngay. Bạn sẽ nhận thông báo khi có tin nhắn hoặc trả giá."),
            fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onDone, shape = RoundedCornerShape(14.dp)) {
            Text(L10n.tr("Done", "Xong"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
