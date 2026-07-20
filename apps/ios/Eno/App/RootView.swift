import SwiftUI

// The five tabs mirror the web bottom nav exactly (mobile-nav.tsx):
// Explore · Saved · Post · Messages · Account. Screens go native one by one;
// a tab that isn't native yet embeds the real web page (WebTabView), so the
// whole product is usable from day one and nothing diverges from the web app.
struct RootView: View {
    @State private var unread = UnreadModel.shared
    // Bound to the router so deep links / notification taps can switch tabs (#3).
    @State private var router = DeepLinkRouter.shared
    @State private var favs = FavoritesStore.shared

    var body: some View {
        TabView(selection: $router.selectedTab) {
            FeedView()
                .tabItem { Label(L10n.tr("Explore", "Khám phá"), systemImage: "safari") }
                .tag(0)
            SavedView()
                // Web mobile-nav fills the heart when there ARE favorites (not just on
                // selection), signalling saved content at a glance.
                .tabItem { Label(L10n.tr("Saved", "Đã lưu"), systemImage: favs.count > 0 ? "heart.fill" : "heart") }
                // Web mobile-nav: a counter badge on Saved when favorites > 0.
                .badge(favs.count > 0 ? Text("\(favs.count)") : nil)
                .tag(1)
            PostView()
                .tabItem { Label(L10n.tr("Post", "Đăng tin"), systemImage: "plus.circle.fill") }
                .tag(2)
            MessagesView()
                // Web uses lucide MessageSquare (a squarer bubble than SF "message");
                // and fills it when there's unread activity, like the web nav.
                .tabItem { Label(L10n.tr("Messages", "Tin nhắn"), systemImage: unread.unread > 0 ? "bubble.left.fill" : "bubble.left") }
                // Web parity: the nav badge caps at 9+.
                .badge(unread.unread > 0 ? Text(unread.unread > 9 ? "9+" : "\(unread.unread)") : nil)
                .tag(3)
            AccountView()
                .tabItem { Label(L10n.tr("Account", "Tài khoản"), systemImage: "person") }
                .tag(4)
        }
        .task { await unread.refresh() }
    }
}
