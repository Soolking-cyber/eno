import SwiftUI
import EnoUI

// Native "How trust works" screen (#20) — replaces the WebSheet(/trust) redirect.
// Mirrors src/app/trust/page.tsx: one Trust Score per account, the five colored
// tiers, how it's built, what costs trust, and the fairness rules. Band thresholds
// track src/lib/trust-score.ts (60/85/110/160).
struct TrustExplainerView: View {
    private struct Band { let score: Int; let name: String; let range: String; let note: String }

    private var bands: [Band] {
        [
            Band(score: 175, name: L10n.tr("Elite", "Hàng đầu"), range: L10n.tr("160 and up", "160 trở lên"),
                 note: L10n.tr("The top tier — a long, high-volume, spotless track record. The most trusted businesses on \(Edition.siteName).",
                               "Hạng cao nhất — lịch sử giao dịch lâu dài, khối lượng lớn, không tì vết.")),
            Band(score: 130, name: L10n.tr("Exceptional", "Xuất sắc"), range: "110–159",
                 note: L10n.tr("≥10 completed deals in the last year, reviews from 5 different buyers, a fast-reply record, and 6 clean months.",
                               "≥10 giao dịch trong năm qua, đánh giá từ 5 người mua khác nhau, phản hồi nhanh và 6 tháng sạch.")),
            Band(score: 95, name: L10n.tr("Trusted", "Đáng tin cậy"), range: "85–109",
                 note: L10n.tr("A verified account with ≥3 completed deals and either 60 days on eno or reviews from 3 buyers — plus a clean last 90 days.",
                               "Tài khoản đã xác minh, ≥3 giao dịch và 60 ngày trên eno hoặc đánh giá từ 3 người mua — 90 ngày qua sạch.")),
            Band(score: 70, name: L10n.tr("Building", "Đang tích lũy"), range: "60–84",
                 note: L10n.tr("Where every account starts. Not a penalty — just an unproven track record.",
                               "Nơi mọi tài khoản bắt đầu. Không phải hình phạt — chỉ là chưa có lịch sử.")),
            Band(score: 45, name: L10n.tr("Caution", "Cần thận trọng"), range: L10n.tr("below 60", "dưới 60"),
                 note: L10n.tr("A serious or repeated confirmed problem. New listings may be held for review.",
                               "Vấn đề nghiêm trọng hoặc lặp lại đã xác nhận. Tin mới có thể bị giữ để xét duyệt.")),
        ]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(L10n.tr("Every account has one Trust Score — a single number, shown in color — instead of stars and badges. It's recomputed every day from what an account actually does on \(Edition.siteName), and recent behavior counts more than the past.",
                             "Mỗi tài khoản có một Điểm tin cậy — một con số duy nhất, hiển thị bằng màu — thay cho sao và huy hiệu. Điểm được tính lại mỗi ngày dựa trên hành vi thực tế, và hành vi gần đây có trọng số cao hơn."))
                    .enoText(.subheadline, color: EnoColor.sub)

                section(L10n.tr("What the colors mean", "Ý nghĩa các màu"))
                Text(L10n.tr("Every account starts at 60 — a neutral 'Building' state, not a warning. The upper tiers are earned with real volume.",
                             "Mỗi tài khoản bắt đầu ở 60 — trạng thái 'Đang tích lũy', không phải cảnh báo. Các hạng trên phải kiếm được bằng khối lượng thực."))
                    .enoText(.caption, color: EnoColor.sub)
                ForEach(bands.indices, id: \.self) { i in
                    let b = bands[i]
                    HStack(alignment: .top, spacing: EnoSpacing.s3) {
                        TrustMini(score: b.score)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(b.name).font(EnoTextRole.subheadline.font.weight(.bold)).foregroundStyle(EnoColor.fg)
                                Text(b.range).enoText(.caption, color: EnoColor.sub)
                            }
                            Text(b.note).enoText(.caption, color: EnoColor.sub)
                        }
                    }
                    .padding(EnoSpacing.s3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.control))
                }

                section(L10n.tr("How the score is built", "Điểm được tính thế nào"))
                Text(L10n.tr("The score starts at 60 and adds four components — verification, real completed deals, reviews from different buyers, and fast replies — each with a hard ceiling so no single tactic can be farmed. Everything except verification is windowed: only recent behavior moves it.",
                             "Điểm bắt đầu ở 60 và cộng bốn thành phần — xác minh, giao dịch hoàn tất thực, đánh giá từ nhiều người mua, và phản hồi nhanh — mỗi phần có giới hạn cứng. Trừ xác minh, mọi thứ đều theo cửa sổ thời gian: chỉ hành vi gần đây mới thay đổi điểm."))
                    .enoText(.caption, color: EnoColor.sub)

                section(L10n.tr("What costs you trust", "Điều gì làm mất tin cậy"))
                Text(L10n.tr("Only admin-confirmed reports move a score down, weighted by severity — a confirmed scam costs the most. Reports only pull a tier down when they come from at least two different people and exceed 2% of the seller's deals, or when a scam is confirmed.",
                             "Chỉ báo cáo được quản trị viên xác nhận mới làm giảm điểm, theo mức độ nghiêm trọng — lừa đảo đã xác nhận mất nhiều nhất. Báo cáo chỉ hạ hạng khi đến từ ít nhất hai người khác nhau và vượt 2% số giao dịch, hoặc khi lừa đảo được xác nhận."))
                    .enoText(.caption, color: EnoColor.sub)

                section(L10n.tr("Fair by design", "Công bằng theo thiết kế"))
                Text(L10n.tr("One hostile buyer can never sink a seller alone. Nothing heals by waiting — scores rise only through verification, real deals, real reviews, and fast replies. Daily gains are capped, so trust is built the slow, honest way. Higher trust ranks higher in search and the feed.",
                             "Một người mua thù địch không thể một mình hạ gục người bán. Không gì tự lành theo thời gian — điểm chỉ tăng qua xác minh, giao dịch thực, đánh giá thực và phản hồi nhanh. Mức tăng mỗi ngày bị giới hạn. Tin cậy cao xếp hạng cao hơn trong tìm kiếm và bảng tin."))
                    .enoText(.caption, color: EnoColor.sub)
            }
            .padding(EnoSpacing.screenGutter)
        }
        .background(EnoColor.canvas)
        .navigationTitle(L10n.tr("How trust works", "Cách tin cậy hoạt động"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func section(_ title: String) -> some View {
        Text(title).font(EnoTextRole.headline.font.weight(.bold)).foregroundStyle(EnoColor.fg).padding(.top, EnoSpacing.s1)
    }
}
