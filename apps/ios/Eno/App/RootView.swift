import SwiftUI

// The five tabs mirror the web bottom nav exactly (mobile-nav.tsx):
// Explore · Saved · Post · Messages · Account. Screens go native one by one;
// a tab that isn't native yet embeds the real web page (WebTabView), so the
// whole product is usable from day one and nothing diverges from the web app.
struct RootView: View {
    var body: some View {
        TabView {
            FeedView()
                .tabItem { Label(L10n.tr("Explore", "Khám phá"), systemImage: "safari") }
            WebTabView(path: "/saved", title: L10n.tr("Saved", "Đã lưu"))
                .tabItem { Label(L10n.tr("Saved", "Đã lưu"), systemImage: "heart") }
            WebTabView(path: "/post", title: L10n.tr("Post", "Đăng tin"))
                .tabItem { Label(L10n.tr("Post", "Đăng tin"), systemImage: "plus.square.fill") }
            WebTabView(path: "/messages", title: L10n.tr("Messages", "Tin nhắn"))
                .tabItem { Label(L10n.tr("Messages", "Tin nhắn"), systemImage: "message") }
            AccountView()
                .tabItem { Label(L10n.tr("Account", "Tài khoản"), systemImage: "person.crop.circle") }
        }
    }
}
