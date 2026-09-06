import SwiftUI
import EnoUI

// Shared report sheet (#32, web report-button.tsx parity): a reason radio +
// optional free-text detail → POST /api/report. Targets a listing and/or a
// seller and/or a conversation (the server derives severity + anti-abuse
// weighting from the reporter's own standing — the client only submits).
// Auth-gated by the Bearer token; a 401 surfaces a sign-in hint inline.
struct ReportSheet: View {
    var listingId: String? = nil
    var sellerId: String? = nil
    var conversationId: String? = nil
    var onDone: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var reason = ""
    @State private var detail = ""
    @State private var submitting = false
    @State private var errorText: String?

    // Every reason mirrors REASONS in report-button.tsx (same values + copy).
    // A chat report is about the person/exchange, not a listing — only these apply.
    private var reasons: [(String, String, String)] {
        let all: [(String, String, String)] = [
            ("scam", "Scam", "Lừa đảo"),
            ("counterfeit", "Counterfeit / fake goods", "Hàng giả / nhái"),
            ("sold", "Already sold / unavailable", "Đã bán / hết hàng"),
            ("wrong-info", "Wrong info (price, photos…)", "Thông tin sai (giá, ảnh…)"),
            ("duplicate", "Duplicate listing", "Tin trùng lặp"),
            ("offensive", "Offensive / harassment", "Nội dung phản cảm / quấy rối"),
            ("other", "Other", "Khác"),
        ]
        if conversationId != nil {
            return all.filter { ["scam", "offensive", "other"].contains($0.0) }
        }
        return all
    }

    private var header: String {
        if conversationId != nil { return L10n.tr("Report this conversation", "Báo cáo cuộc trò chuyện") }
        if sellerId != nil && listingId == nil { return L10n.tr("Report this seller", "Báo cáo người bán") }
        return L10n.tr("Report this listing", "Báo cáo tin đăng")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header) {
                    ForEach(reasons, id: \.0) { r in
                        Button { reason = r.0 } label: {
                            HStack {
                                Text(L10n.tr(r.1, r.2)).foregroundStyle(Tokens.fg)
                                Spacer()
                                if reason == r.0 {
                                    EnoIcon("success").foregroundStyle(Tokens.brand)
                                }
                            }
                        }
                    }
                }
                Section(L10n.tr("Details (optional)", "Chi tiết (không bắt buộc)")) {
                    TextField(L10n.tr("Add anything that helps…", "Thêm thông tin nếu cần…"),
                              text: $detail, axis: .vertical)
                        .lineLimit(2...5)
                }
                if let errorText {
                    Text(errorText).font(.system(size: 13)).foregroundStyle(Tokens.danger)
                }
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        Text(submitting ? L10n.tr("Sending…", "Đang gửi…")
                                        : L10n.tr("Submit report", "Gửi báo cáo"))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(reason.isEmpty ? Tokens.sub : Tokens.brand)
                    }
                    .disabled(reason.isEmpty || submitting)
                }
            }
            .navigationTitle(L10n.tr("Report", "Báo cáo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L10n.tr("Cancel", "Hủy")) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() async {
        // Synchronous re-entrancy guard: SwiftUI updates `.disabled` only on the
        // next render, so a double-tap can spawn two POSTs before then.
        guard !submitting else { return }
        submitting = true; errorText = nil
        var body: [String: Any] = ["reason": reason]
        if let listingId { body["listingId"] = listingId }
        if let sellerId { body["sellerId"] = sellerId }
        if let conversationId { body["conversationId"] = conversationId }
        let trimmed = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { body["detail"] = trimmed }
        let code = (try? await APIClient.shared.send("POST", "api/report", body: body)) ?? -1
        switch code {
        case 200..<300:
            onDone(); dismiss()
        case 401:
            errorText = L10n.tr("Please sign in to report.", "Vui lòng đăng nhập để báo cáo.")
        case 429:
            errorText = L10n.tr("You've reported a lot recently — try later.", "Bạn đã báo cáo nhiều gần đây — thử lại sau.")
        default:
            errorText = L10n.tr("Could not send — try again.", "Không gửi được — thử lại.")
        }
        submitting = false
    }
}
