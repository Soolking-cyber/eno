package vn.eno.native_.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import vn.eno.native_.core.L10n
import vn.eno.native_.feed.TrustMini

// Native "How trust works" screen (#20 Android parity) — mirrors iOS
// TrustExplainerView + src/app/trust/page.tsx: the five colored tiers rendered
// with the native TrustMini chips + how it's built / what costs trust / fairness.
@Composable
fun TrustExplainerScreen(onBack: () -> Unit) {
    data class Band(val score: Int, val name: String, val range: String, val note: String)
    val bands = listOf(
        Band(175, L10n.tr("Elite", "Hàng đầu"), L10n.tr("160 and up", "160 trở lên"),
            L10n.tr("The top tier — a long, high-volume, spotless track record.", "Hạng cao nhất — lịch sử lâu dài, khối lượng lớn, không tì vết.")),
        Band(130, L10n.tr("Exceptional", "Xuất sắc"), "110–159",
            L10n.tr("≥10 deals in the last year, reviews from 5 buyers, fast replies, 6 clean months.", "≥10 giao dịch năm qua, đánh giá từ 5 người mua, phản hồi nhanh, 6 tháng sạch.")),
        Band(95, L10n.tr("Trusted", "Đáng tin cậy"), "85–109",
            L10n.tr("Verified, ≥3 deals and 60 days on eno or reviews from 3 buyers, clean last 90 days.", "Đã xác minh, ≥3 giao dịch và 60 ngày hoặc đánh giá từ 3 người mua, 90 ngày qua sạch.")),
        Band(70, L10n.tr("Building", "Đang tích lũy"), "60–84",
            L10n.tr("Where every account starts. Not a penalty — just an unproven track record.", "Nơi mọi tài khoản bắt đầu. Không phải hình phạt — chỉ là chưa có lịch sử.")),
        Band(45, L10n.tr("Caution", "Cần thận trọng"), L10n.tr("below 60", "dưới 60"),
            L10n.tr("A serious or repeated confirmed problem. New listings may be held.", "Vấn đề nghiêm trọng/lặp lại đã xác nhận. Tin mới có thể bị giữ.")),
    )
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(L10n.tr("‹ Back", "‹ Quay lại"), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(12.dp))
            Text(L10n.tr("How trust works", "Cách tin cậy hoạt động"), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(L10n.tr("Every account has one Trust Score — a single number, shown in color — recomputed every day from what an account actually does, with recent behavior weighted more.",
                "Mỗi tài khoản có một Điểm tin cậy — một con số hiển thị bằng màu — tính lại mỗi ngày từ hành vi thực tế, hành vi gần đây có trọng số cao hơn."),
                fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            Text(L10n.tr("What the colors mean", "Ý nghĩa các màu"), fontSize = 17.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
            Spacer(Modifier.height(8.dp))
            bands.forEach { b ->
                Row(Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(RoundedCornerShape(9.dp)).background(MaterialTheme.colorScheme.surface).padding(12.dp), verticalAlignment = Alignment.Top) {
                    TrustMini(b.score)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Row {
                            Text(b.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                            Spacer(Modifier.width(6.dp))
                            Text(b.range, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(b.note, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Section(L10n.tr("How the score is built", "Điểm được tính thế nào"),
                L10n.tr("Starts at 60 and adds four windowed components — verification, real deals, reviews from different buyers, fast replies — each capped so no single tactic can be farmed.",
                    "Bắt đầu ở 60 và cộng bốn thành phần theo cửa sổ thời gian — xác minh, giao dịch thực, đánh giá từ nhiều người mua, phản hồi nhanh — mỗi phần có giới hạn."))
            Section(L10n.tr("What costs you trust", "Điều gì làm mất tin cậy"),
                L10n.tr("Only admin-confirmed reports lower a score, weighted by severity. A tier drops only when reports come from ≥2 different people and exceed 2% of deals, or a scam is confirmed.",
                    "Chỉ báo cáo được xác nhận mới giảm điểm, theo mức độ. Hạng chỉ giảm khi báo cáo từ ≥2 người và vượt 2% giao dịch, hoặc lừa đảo được xác nhận."))
            Section(L10n.tr("Fair by design", "Công bằng theo thiết kế"),
                L10n.tr("One hostile buyer can't sink a seller. Nothing heals by waiting — scores rise only through verification, real deals, reviews and fast replies. Higher trust ranks higher in search.",
                    "Một người mua thù địch không thể hạ gục người bán. Không gì tự lành — điểm chỉ tăng qua xác minh, giao dịch, đánh giá và phản hồi nhanh. Tin cậy cao xếp hạng cao hơn."))
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Section(title: String, body: String) {
    Text(title, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.padding(top = 12.dp))
    Spacer(Modifier.height(4.dp))
    Text(body, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
