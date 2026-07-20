import SwiftUI
import Observation

// The Messages tab (#118): native inbox mirroring conversation-list.tsx —
// eno AI pinned row, counterpart avatar + name, listing title, offer-aware
// preview line, unread rail + count, swipe-to-delete. Guest → sign-in hero
// (the enoAuth bridge flips it live after web OTP).
struct MessagesView: View {
    @State private var auth = AuthModel.shared

    var body: some View {
        NavigationStack {
            Group {
                if auth.isSignedIn {
                    InboxView()
                } else {
                    guestHero
                }
            }
            .background(Tokens.canvas)
            .navigationTitle(L10n.tr("Messages", "Tin nhắn"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @State private var signInSheet = false
    private var guestHero: some View {
        VStack(spacing: 16) {
            Image(systemName: "message")
                .font(.system(size: 40))
                .foregroundStyle(Tokens.brand)
            Text(L10n.tr("Sign in to see your messages.", "Đăng nhập để xem tin nhắn của bạn."))
                .font(.system(size: 15))
                .foregroundStyle(Tokens.sub)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button(L10n.tr("Sign in", "Đăng nhập")) { signInSheet = true }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 32)
                .frame(height: 48)
                .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $signInSheet) { WebSheet(path: "/signin") }
        .onChange(of: auth.isSignedIn) { if auth.isSignedIn { signInSheet = false } }
    }
}

@MainActor
@Observable
final class InboxModel {
    var convos: [InboxConvo] = []
    var loaded = false

    func load() async {
        if let r: InboxResponse = try? await APIClient.shared.get("api/conversations") {
            convos = r.conversations
            loaded = true
        }
    }

    func delete(_ convo: InboxConvo) async {
        convos.removeAll { $0.id == convo.id }
        _ = try? await APIClient.shared.send("DELETE", "api/conversations/\(convo.id)")
    }
}

struct InboxView: View {
    @State private var model = InboxModel()
    @State private var aiSheet = false

    var body: some View {
        List {
            // eno AI — synthetic pinned row (web parity: not a DB conversation).
            Button {
                aiSheet = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 17))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Tokens.brand, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("eno AI").font(.system(size: 14, weight: .bold)).foregroundStyle(Tokens.fg)
                        Text(L10n.tr("Ask anything — find products by chat", "Hỏi bất cứ điều gì — tìm đồ bằng chat"))
                            .font(.system(size: 12))
                            .foregroundStyle(Tokens.sub)
                            .lineLimit(1)
                    }
                }
            }
            .listRowBackground(Tokens.card)

            ForEach(model.convos) { convo in
                NavigationLink(value: convo.id) {
                    row(convo)
                }
                .listRowBackground(convo.unread > 0 ? Tokens.brandTint : Tokens.card)
                .swipeActions {
                    Button(role: .destructive) {
                        Task { await model.delete(convo) }
                    } label: {
                        Label(L10n.tr("Delete", "Xóa"), systemImage: "trash")
                    }
                }
            }

            if model.loaded && model.convos.isEmpty {
                Text(L10n.tr("No messages yet. Tap \"Message\" on a listing to start a chat.",
                             "Chưa có tin nhắn. Nhấn \"Nhắn tin\" trên một tin đăng để bắt đầu."))
                    .font(.system(size: 14))
                    .foregroundStyle(Tokens.sub)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
        .navigationDestination(for: String.self) { convoId in
            ThreadView(convoId: convoId)
                .onDisappear { Task { await model.load(); await UnreadModel.shared.refresh() } }
        }
        .sheet(isPresented: $aiSheet) { WebSheet(path: "/messages/ai") }
        .task { await model.load() }
    }

    private func convoInitial(_ c: InboxConvo) -> some View {
        Text(String(c.counterpart.name.prefix(1)).uppercased())
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(Color(hexString: c.counterpart.avatarColor) ?? Tokens.brand, in: Circle())
    }

    private func row(_ c: InboxConvo) -> some View {
        HStack(spacing: 12) {
            if let urlStr = c.counterpart.avatarUrl, let url = ImageURL.optimized(urlStr, width: 88) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                    else { convoInitial(c) }
                }
                .frame(width: 44, height: 44)
                .clipShape(Circle())
            } else {
                convoInitial(c)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(c.counterpart.name)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Tokens.fg)
                        .lineLimit(1)
                    if c.unread > 0 {
                        Text("\(c.unread)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Tokens.brand, in: Capsule())
                    }
                }
                Text(c.listingTitle)
                    .font(.system(size: 12))
                    .foregroundStyle(Tokens.sub)
                    .lineLimit(1)
                preview(c)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    // Offer-aware preview (conversation-list.tsx rules).
    @ViewBuilder
    private func preview(_ c: InboxConvo) -> some View {
        if let o = c.lastOffer {
            let amt = o.amount.map { Format.vnd($0) } ?? ""
            switch o.status {
            case "accepted": Text(L10n.tr("✅ Offer accepted", "✅ Đã chấp nhận đề nghị")).font(.system(size: 13)).foregroundStyle(Tokens.sub)
            case "declined": Text(L10n.tr("❌ Offer declined", "❌ Đã từ chối đề nghị")).font(.system(size: 13)).foregroundStyle(Tokens.sub)
            case "countered": Text(L10n.tr("↩️ Counter-offer", "↩️ Đã trả giá khác")).font(.system(size: 13)).foregroundStyle(Tokens.sub)
            default:
                if o.mine {
                    Text(L10n.tr("You offered \(amt)", "Bạn đề nghị \(amt)")).font(.system(size: 13)).foregroundStyle(Tokens.sub)
                } else {
                    Text(L10n.tr("💰 New offer: \(amt)", "💰 Đề nghị mới: \(amt)")).font(.system(size: 13, weight: .bold)).foregroundStyle(Tokens.brand)
                }
            }
        } else {
            Text(c.lastMessageText ?? L10n.tr("New conversation", "Cuộc trò chuyện mới"))
                .font(.system(size: 13, weight: c.unread > 0 ? .semibold : .regular))
                .foregroundStyle(c.unread > 0 ? Tokens.fg : Tokens.sub)
        }
    }
}

// The tab badge: GET /api/conversations/unread (signed-out → 0), refreshed on
// foreground, sign-in, and returning from a thread. Mirrors the web's 9+ cap.
@MainActor
@Observable
final class UnreadModel {
    static let shared = UnreadModel()
    private(set) var unread = 0

    func refresh() async {
        guard AuthModel.shared.isSignedIn else { unread = 0; return }
        if let r: UnreadResponse = try? await APIClient.shared.get("api/conversations/unread") {
            unread = r.unread
        }
    }
}
