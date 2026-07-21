import SwiftUI
import Observation
import EnoUI

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
        VStack(spacing: EnoSpacing.s4) {
            Image(systemName: "message")
                .enoIcon(.xl, color: EnoColor.brand)
            Text(L10n.tr("Sign in to see your messages.", "Đăng nhập để xem tin nhắn của bạn."))
                .enoText(.subheadline, color: EnoColor.sub)
                .multilineTextAlignment(.center)
                .padding(.horizontal, EnoSpacing.s8)
            EnoButton(L10n.tr("Sign in", "Đăng nhập"), size: .large, fullWidth: false) { signInSheet = true }
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
            // TODO(EnoUI): stays a raw Button on purpose. EnoListRow is title+subtitle only,
            // and this row is the deliberate TWIN of the conversation rows below (44pt disc,
            // 14-bold name, 12 sub line). Putting only this one on EnoListRow would split the
            // screen's row language (16-regular title, 56pt height, its own 16pt inset on top
            // of the List's). Needs an EnoConversationRow pattern — see primitiveGaps.
            Button {
                aiSheet = true
            } label: {
                HStack(spacing: EnoSpacing.s3) {
                    Image(systemName: "sparkles")
                        .enoIcon(.md, color: EnoColor.onBrand)
                        .frame(width: 44, height: 44)
                        .background(EnoColor.brand, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("eno AI").enoText(.callout, color: EnoColor.fg, weight: .bold)
                        Text(L10n.tr("Ask anything — find products by chat", "Hỏi bất cứ điều gì — tìm đồ bằng chat"))
                            .enoText(.caption, color: EnoColor.sub)
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
                    .enoText(.callout, color: EnoColor.sub)
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
            .enoText(.headline, color: EnoColor.onBrand, weight: .bold)
            .frame(width: 44, height: 44)
            .background(Color(hexString: c.counterpart.avatarColor) ?? EnoColor.brand, in: Circle())
    }

    private func row(_ c: InboxConvo) -> some View {
        HStack(spacing: EnoSpacing.s3) {
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
                        .enoText(.callout, color: EnoColor.fg, weight: .bold)
                        .lineLimit(1)
                    if c.unread > 0 {
                        Text("\(c.unread)")
                            .enoText(.micro, color: EnoColor.onBrand, weight: .bold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(EnoColor.brand, in: Capsule())
                    }
                }
                Text(c.listingTitle)
                    .enoText(.caption, color: EnoColor.sub)
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
            case "accepted": Text(L10n.tr("✅ Offer accepted", "✅ Đã chấp nhận đề nghị")).enoText(.caption, color: EnoColor.sub)
            case "declined": Text(L10n.tr("❌ Offer declined", "❌ Đã từ chối đề nghị")).enoText(.caption, color: EnoColor.sub)
            case "countered": Text(L10n.tr("↩️ Counter-offer", "↩️ Đã trả giá khác")).enoText(.caption, color: EnoColor.sub)
            default:
                if o.mine {
                    Text(L10n.tr("You offered \(amt)", "Bạn đề nghị \(amt)")).enoText(.caption, color: EnoColor.sub)
                } else {
                    Text(L10n.tr("💰 New offer: \(amt)", "💰 Đề nghị mới: \(amt)")).enoText(.caption, color: EnoColor.brand, weight: .bold)
                }
            }
        } else {
            Text(c.lastMessageText ?? L10n.tr("New conversation", "Cuộc trò chuyện mới"))
                .enoText(.caption,
                         color: c.unread > 0 ? EnoColor.fg : EnoColor.sub,
                         weight: c.unread > 0 ? .semibold : .regular)
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
