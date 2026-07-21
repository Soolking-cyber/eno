import SwiftUI

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
            .background(Tokens.canvas)
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
                    .padding(16)
                }
                .onChange(of: model.turns.count) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                .onChange(of: model.sending) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            composer
        }
    }

    // ── intro / examples ──
    private var intro: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles").font(.system(size: 22)).foregroundStyle(Tokens.brand)
                Text(L10n.tr("Tell me what you're looking for", "Bạn đang tìm gì?"))
                    .font(.system(size: 18, weight: .bold)).foregroundStyle(Tokens.fg)
            }
            Text(L10n.tr("I'll search the marketplace and show you matches.",
                         "Mình sẽ tìm trong chợ và hiện các kết quả phù hợp."))
                .font(.system(size: 14)).foregroundStyle(Tokens.sub)
            FlowLayout(spacing: 8) {
                ForEach(examples, id: \.0) { ex in
                    let label = L10n.tr(ex.0, ex.1)
                    Button { Task { await model.send(label) } } label: {
                        Text(label).font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.sub)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(Tokens.tint, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.bottom, 8)
    }

    // ── one turn ──
    @ViewBuilder private func turnView(_ turn: AIConciergeModel.Turn) -> some View {
        if turn.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(turn.content).font(.system(size: 15)).foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Tokens.brand, in: RoundedRectangle(cornerRadius: 18))
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(turn.content).font(.system(size: 15)).foregroundStyle(Tokens.fg)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 18))
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
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in Circle().fill(Tokens.sub).frame(width: 7, height: 7) }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 18))
            Spacer()
        }
    }

    // ── composer ──
    private var composer: some View {
        HStack(spacing: 8) {
            TextField(L10n.tr("Ask for anything…", "Hỏi bất cứ điều gì…"), text: $input, axis: .vertical)
                .lineLimit(1...4)
                .focused($focused)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 20))
                .submitLabel(.send)
                .onSubmit(sendCurrent)
            Button(action: sendCurrent) {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
                    .foregroundStyle(canSend ? Tokens.brand : Tokens.sub)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.bar)
    }

    private var canSend: Bool { !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.sending }

    private func sendCurrent() {
        let text = input
        input = ""
        Task { await model.send(text) }
    }

    private var guestGate: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles").font(.system(size: 40)).foregroundStyle(Tokens.brand)
            Text(L10n.tr("Sign in to use AI shopping", "Đăng nhập để dùng Mua sắm AI"))
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(Tokens.fg)
            Text(L10n.tr("The assistant searches the marketplace for you.",
                         "Trợ lý sẽ tìm trong chợ giúp bạn."))
                .font(.system(size: 14)).foregroundStyle(Tokens.sub).multilineTextAlignment(.center)
            Button { signInSheet = true } label: {
                Text(L10n.tr("Sign in", "Đăng nhập")).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 24).padding(.vertical, 12)
                    .background(Tokens.brand, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(40)
    }
}
