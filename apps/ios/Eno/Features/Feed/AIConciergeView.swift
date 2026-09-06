import SwiftUI
import EnoUI

// Native AI shopping concierge (replaces the WebSheet /messages/ai, which 401'd
// once the web session cookies expired — the native app refreshes only its Bearer).
// A chat that POSTs /api/ai/concierge with the Bearer token; the assistant's reply
// renders as a bubble and any matched listings as native cards → PDP. Web parity:
// src/app/messages/ai + /api/ai/concierge ({ reply, listings, source }).

@MainActor @Observable
final class AIConciergeModel {
    struct Turn: Identifiable {
        let id = UUID()
        let role: String            // "user" | "assistant"
        var content: String
        var listings: [ListingCard] = []
    }
    struct Response: Codable { let reply: String?; let listings: [ListingCard]? }

    var turns: [Turn] = []
    var sending = false

    func send(_ text: String) async {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !sending else { return }
        turns.append(Turn(role: "user", content: q))
        sending = true
        defer { sending = false }
        // Send the running transcript (server keeps the last 12) so follow-ups like
        // "cheaper" / "the red one" have context.
        let history = turns.map { ["role": $0.role, "content": $0.content] }
        do {
            let r: Response = try await APIClient.shared.post(
                "api/ai/concierge",
                body: ["messages": history, "lang": L10n.isVi ? "vi" : "en"]
            )
            let reply = (r.reply?.isEmpty == false) ? r.reply! : L10n.tr("Here's what I found.", "Đây là kết quả mình tìm được.")
            turns.append(Turn(role: "assistant", content: reply, listings: r.listings ?? []))
        } catch {
            turns.append(Turn(role: "assistant",
                              content: L10n.tr("Sorry — I couldn't reach the assistant. Please try again.",
                                               "Xin lỗi — không kết nối được trợ lý. Thử lại nhé.")))
        }
    }
}

struct AIConciergeView: View {
    @State private var model = AIConciergeModel()
    @State private var input = ""
    @State private var signInSheet = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    private let examples: [(String, String)] = [
        ("iPhone under 10tr", "iPhone dưới 10 triệu"),
        ("Honda motorbike", "Xe máy Honda"),
        ("2BR apartment for rent", "Căn hộ 2 phòng ngủ cho thuê"),
    ]

    var body: some View {
        NavigationStack {
            Group {
                if AuthModel.shared.isSignedIn { chat } else { guestGate }
            }
            .background(EnoColor.canvas)
            .navigationTitle(L10n.tr("AI Shopping", "Mua sắm AI"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L10n.tr("Done", "Xong")) { dismiss() } } }
            .navigationDestination(for: ListingCard.self) { ListingDetailView(card: $0) }
            .sheet(isPresented: $signInSheet) { WebSheet(path: "/signin") }
        }
    }

    private var chat: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if model.turns.isEmpty { intro }
                        ForEach(model.turns) { turn in turnView(turn) }
                        if model.sending { typingBubble }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(EnoSpacing.s4)
                }
                .onChange(of: model.turns.count) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                .onChange(of: model.sending) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            composer
        }
    }

    // ── intro / examples ──
    private var intro: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s3) {
            HStack(spacing: EnoSpacing.s2) {
                EnoIcon("ai", .lg, color: EnoColor.brand)
                Text(L10n.tr("Tell me what you're looking for", "Bạn đang tìm gì?"))
                    .enoText(.headline)
            }
            Text(L10n.tr("I'll search the marketplace and show you matches.",
                         "Mình sẽ tìm trong chợ và hiện các kết quả phù hợp."))
                .enoText(.callout, color: EnoColor.sub)
            FlowLayout(spacing: EnoSpacing.s2) {
                ForEach(examples, id: \.0) { ex in
                    let label = L10n.tr(ex.0, ex.1)
                    EnoChip(label) { Task { await model.send(label) } }
                }
            }
        }
        .padding(.bottom, EnoSpacing.s2)
    }

    // ── one turn ──
    @ViewBuilder private func turnView(_ turn: AIConciergeModel.Turn) -> some View {
        if turn.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(turn.content).enoText(.subheadline, color: EnoColor.onBrand)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(EnoColor.brand, in: RoundedRectangle(cornerRadius: EnoRadius.card))
            }
        } else {
            VStack(alignment: .leading, spacing: EnoSpacing.s2) {
                HStack {
                    Text(turn.content).enoText(.subheadline)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
                    Spacer(minLength: 40)
                }
                if !turn.listings.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(turn.listings) { card in
                                NavigationLink(value: card) { ListingCardView(listing: card).frame(width: 168) }
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private var typingBubble: some View {
        HStack {
            HStack(spacing: EnoSpacing.s1) {
                ForEach(0..<3, id: \.self) { _ in Circle().fill(EnoColor.sub).frame(width: 7, height: 7) }
            }
            .padding(.horizontal, 14).padding(.vertical, EnoSpacing.s3)
            .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
            Spacer()
        }
    }

    // ── composer ──
    private var composer: some View {
        HStack(spacing: EnoSpacing.s2) {
            // TODO(EnoUI): EnoField — awaiting the field primitive (label + focus ring).
            TextField(L10n.tr("Ask for anything…", "Hỏi bất cứ điều gì…"), text: $input, axis: .vertical)
                .lineLimit(1...4)
                .focused($focused)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
                .submitLabel(.send)
                .onSubmit(sendCurrent)
            EnoIconButton(
                "arrow.up.circle.fill", size: 32,
                color: canSend ? EnoColor.brand : EnoColor.sub,
                label: L10n.tr("Send", "Gửi"),
                action: sendCurrent
            )
            .disabled(!canSend)
        }
        .padding(.horizontal, EnoSpacing.s3).padding(.vertical, EnoSpacing.s2)
        .background(.bar)
    }

    private var canSend: Bool { !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.sending }

    private func sendCurrent() {
        let text = input
        input = ""
        Task { await model.send(text) }
    }

    // TODO(EnoUI): EnoEmptyState — symbol + title + guidance + one recovery action;
    // swap the whole block onto that primitive when it ships. Tokens below are canon.
    private var guestGate: some View {
        VStack(spacing: EnoSpacing.s3) {
            EnoIcon("ai", .xl, color: EnoColor.brand)
            Text(L10n.tr("Sign in to use AI shopping", "Đăng nhập để dùng Mua sắm AI"))
                .enoText(.headline)
            Text(L10n.tr("The assistant searches the marketplace for you.",
                         "Trợ lý sẽ tìm trong chợ giúp bạn."))
                .enoText(.callout, color: EnoColor.sub).multilineTextAlignment(.center)
            EnoButton(L10n.tr("Sign in", "Đăng nhập"), fullWidth: false) { signInSheet = true }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(40)
    }
}
