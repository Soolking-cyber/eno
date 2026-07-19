import SwiftUI
import Observation

// Native notifications (#120) over the web's endpoints: GET /api/notifications
// (30 newest + unread count), POST /api/notifications/read (all read on open —
// the bell clears when you look, like the web), swipe-delete one, Clear all.
// Rows deep-link: conversation → native thread, listing → native PDP, url →
// web sheet.

struct NotificationItem: Codable, Identifiable {
    let id: String
    let type: String?
    let title: String
    let body: String?
    let actorName: String?
    let conversationId: String?
    let listingId: String?
    let url: String?
    let read: Bool
    let createdAt: String
}

struct NotificationsResponse: Codable {
    let notifications: [NotificationItem]
    let unread: Int
}

@MainActor
@Observable
final class NotifModel {
    static let shared = NotifModel()
    var items: [NotificationItem] = []
    private(set) var unread = 0
    var loaded = false

    func refreshBadge() async {
        guard AuthModel.shared.isSignedIn else { unread = 0; return }
        if let r: NotificationsResponse = try? await APIClient.shared.get("api/notifications") {
            items = r.notifications
            unread = r.unread
            loaded = true
        }
    }

    func openedList() async {
        await refreshBadge()
        guard unread > 0 else { return }
        _ = try? await APIClient.shared.send("POST", "api/notifications/read")
        unread = 0
    }

    func delete(_ item: NotificationItem) async {
        items.removeAll { $0.id == item.id }
        _ = try? await APIClient.shared.send("DELETE", "api/notifications/\(item.id)")
    }

    func clearAll() async {
        items = []
        unread = 0
        _ = try? await APIClient.shared.send("DELETE", "api/notifications")
    }
}

struct NotificationsView: View {
    @State private var model = NotifModel.shared
    @State private var threadRoute: ThreadRoute?
    @State private var listingCard: ListingCard?
    @State private var webPath: WebRoute?

    struct ThreadRoute: Identifiable, Hashable {
        let id: String
    }
    struct WebRoute: Identifiable {
        let id: String
    }

    var body: some View {
        List {
            ForEach(model.items) { n in
                Button {
                    open(n)
                } label: {
                    row(n)
                }
                .listRowBackground(n.read ? Tokens.card : Tokens.brandTint)
                .swipeActions {
                    Button(role: .destructive) {
                        Task { await model.delete(n) }
                    } label: {
                        Label(L10n.tr("Delete", "Xóa"), systemImage: "trash")
                    }
                }
            }
            if model.loaded && model.items.isEmpty {
                Text(L10n.tr("No notifications yet.", "Chưa có thông báo nào."))
                    .font(.system(size: 14))
                    .foregroundStyle(Tokens.sub)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Tokens.canvas)
        .navigationTitle(L10n.tr("Notifications", "Thông báo"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !model.items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr("Clear", "Xóa hết")) {
                        Task { await model.clearAll() }
                    }
                    .font(.system(size: 14))
                }
            }
        }
        .refreshable { await model.refreshBadge() }
        .task { await model.openedList() }
        .navigationDestination(item: $threadRoute) { r in
            ThreadView(convoId: r.id)
        }
        .navigationDestination(item: $listingCard) { card in
            ListingDetailView(card: card)
        }
        .sheet(item: $webPath) { w in
            WebSheet(path: w.id)
        }
    }

    private func open(_ n: NotificationItem) {
        if let convoId = n.conversationId {
            threadRoute = ThreadRoute(id: convoId)
        } else if let listingId = n.listingId {
            Task {
                if let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [URLQueryItem(name: "ids", value: listingId)]),
                   let card = page.listings.first {
                    listingCard = card
                } else if let url = n.url {
                    webPath = WebRoute(id: url)
                }
            }
        } else if let url = n.url {
            webPath = WebRoute(id: url)
        }
    }

    private func row(_ n: NotificationItem) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(n.title)
                    .font(.system(size: 14, weight: n.read ? .medium : .bold))
                    .foregroundStyle(Tokens.fg)
                    .lineLimit(2)
                Spacer()
                if let d = Format.date(n.createdAt) {
                    Text(Format.ago(d.ISO8601Format()))
                        .font(.system(size: 11))
                        .foregroundStyle(Tokens.sub)
                }
            }
            if let body = n.body, !body.isEmpty {
                Text(body)
                    .font(.system(size: 13))
                    .foregroundStyle(Tokens.sub)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }
}
