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
    // Theme / language preferences, applied app-wide below.
    @State private var settings = AppSettings.shared

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
        // Every button in the app draws its OWN look (brand fills, tint chips, plain
        // text). Force .plain app-wide so no iOS version wraps them in system chrome —
        // notably iOS 26's Liquid-Glass capsule, which put an ugly pill behind every
        // rectangular CTA. Descendant styles (sheets, pushes) inherit this default.
        .buttonStyle(.plain)
        // Theme override: System (nil) follows the OS; Light/Dark force it. The
        // Tokens.adaptive dynamic UIColors re-resolve against this automatically.
        .preferredColorScheme(settings.colorScheme)
        // Locale for system-formatted dates/pickers.
        .environment(\.locale, Locale(identifier: settings.isVi ? "vi" : "en"))
        // Language is read app-wide via L10n's mirror (not @Observable), so a switch
        // won't invalidate already-built tabs on its own. Re-key the whole tree on
        // language change to rebuild every screen in the new language at once.
        .id(settings.language)
    }
}
