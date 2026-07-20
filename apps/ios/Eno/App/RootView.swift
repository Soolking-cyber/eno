import SwiftUI

// The five tabs mirror the web bottom nav exactly (mobile-nav.tsx):
// Explore · Saved · Post · Messages · Account. Screens go native one by one;
// a tab that isn't native yet embeds the real web page (WebTabView), so the
// whole product is usable from day one and nothing diverges from the web app.
struct RootView: View {
    @State private var unread = UnreadModel.shared
    // Bound to the router so deep links / notification taps can switch tabs (#3).
    @State private var router = DeepLinkRouter.shared

    var body: some View {
        TabView(selection: $router.selectedTab) {
            FeedView()
                .tabItem { Label(L10n.tr("Explore", "Khám phá"), systemImage: "safari") }
                .tag(0)
            SavedView()
                .tabItem { Label(L10n.tr("Saved", "Đã lưu"), systemImage: "heart") }
                .tag(1)
            PostView()
                .tabItem { Label(L10n.tr("Post", "Đăng tin"), systemImage: "plus.square.fill") }
                .tag(2)
            MessagesView()
                .tabItem { Label(L10n.tr("Messages", "Tin nhắn"), systemImage: "message") }
                // Web parity: the nav badge caps at 9+.
                .badge(unread.unread > 0 ? Text(unread.unread > 9 ? "9+" : "\(unread.unread)") : nil)
                .tag(3)
            AccountView()
                .tabItem { Label(L10n.tr("Account", "Tài khoản"), systemImage: "person.crop.circle") }
                .tag(4)
        }
        .task { await unread.refresh() }
    }
}
