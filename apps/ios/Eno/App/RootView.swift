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
    // Once-a-day availability review popup (owner: sellers confirm / tick off what's
    // still available each day). auth drives a re-check when a sign-in completes.
    @State private var auth = AuthModel.shared
    @State private var availability = AvailabilityReviewModel()
    // Rebuilds the chrome when a machine-translation UI-dictionary prefetch lands
    // (uiGen), so fixed strings swap from English into the selected language.
    @ObservedObject private var mt = Translator.shared

    /// ⚠️ A PLAIN `Image`, DELIBERATELY NOT `EnoIcon`. UIKit's tab bar sizes and tints the icon it
    /// is given; an EnoIcon would impose its own frame and foreground colour and fight the bar's
    /// selected/unselected tinting. Template rendering is all that is needed here — the bar does
    /// the rest, and the glyph is the same asset the rest of the app draws.
    private func tabIcon(_ name: String, selected: Bool) -> some View {
        // ⛔ THE WEB'S NAV ART, NOT A LINE GLYPH. `mobile-nav.tsx` draws `/icons/nav/<key>.webp` —
        // rendered 3D pieces — and the first pass of this migration put flat Solar outlines here
        // instead, which is a different product on the most-seen surface in the app. The art is
        // full colour, so it renders `.original`; `lit` on the web is a brightness/scale treatment
        // for the active tab, and UIKit's tab bar already distinguishes selection, so the same
        // asset serves both states.
        // ⚠️ `grayscale` IS THE SELECTION SIGNAL, COPIED FROM THE WEB. `nav-art.tsx` renders every
        // tab's art in grayscale and lets only the ACTIVE one keep its colour (`!lit &&
        // 'grayscale'`) — Post being the exception that is always lit. Without this the bar was
        // five full-colour pieces and nothing said where you were; `.renderingMode(.original)`
        // also means UIKit's own tint cannot do that job for us.
        // ⚠️ SIZED EXPLICITLY. The source art is 184px declared at @3x, so its intrinsic size is
        // ~61pt — more than twice a tab bar's glyph. Without a frame UIKit gets artwork it has to
        // squeeze, and the labels shift to make room (gate).
        // ⚠️ NO `.frame()` HERE, AND THAT IS NOT AN OVERSIGHT. `.tabItem` hands the image to UIKit,
        // which uses its INTRINSIC size — a SwiftUI frame inside a tab item is ignored, which is
        // why the first attempt drew 61pt glyphs over their own labels. The size is set where UIKit
        // can see it: the asset is emitted at 28pt across @1x/@2x/@3x by gen-ios-icons.mjs.
        Image("nav-\(name)")
            .renderingMode(.original)
            .grayscale(selected ? 0 : 1)
    }

    var body: some View {
        TabView(selection: $router.selectedTab) {
            FeedView()
                // ⛔ THE WEB'S OWN GLYPHS, NOT SF SYMBOLS. The bottom bar is the most-seen surface in
                // the app and it was the most obviously foreign: SF `safari`, `heart`, `plus.circle`
                // against the site's Solar v2 set (owner: *"look at web mobile version"*). `Label`
                // takes an `Image`, so each tab names the same glyph the web's mobile nav does, and
                // the SELECTED weight (Solar Bold) is the `-fill` asset — the same rest/selected
                // pair the web toggles.
                .tabItem { Label { Text(L10n.tr("Explore", "Khám phá")) } icon: { tabIcon("explore", selected: router.selectedTab == 0) } }
                .tag(0)
            SavedView()
                // Web mobile-nav fills the heart when there ARE favorites (not just on
                // selection), signalling saved content at a glance.
                // Web mobile-nav fills the heart when there ARE favorites, not only on selection —
                // so the fill condition is the favourite count, exactly as before.
                .tabItem { Label { Text(L10n.tr("Saved", "Đã lưu")) } icon: { tabIcon("saved", selected: favs.count > 0) } }
                // Web mobile-nav: a counter badge on Saved when favorites > 0.
                .badge(favs.count > 0 ? Text("\(favs.count)") : nil)
                .tag(1)
            PostView()
                .tabItem { Label { Text(L10n.tr("Post", "Đăng tin")) } icon: { tabIcon("post", selected: true) } }
                .tag(2)
            MessagesView()
                // Web uses lucide MessageSquare (a squarer bubble than SF "message");
                // and fills it when there's unread activity, like the web nav.
                .tabItem { Label { Text(L10n.tr("Messages", "Tin nhắn")) } icon: { tabIcon("messages", selected: unread.unread > 0) } }
                // Web parity: the nav badge caps at 9+.
                .badge(unread.unread > 0 ? Text(unread.unread > 9 ? "9+" : "\(unread.unread)") : nil)
                .tag(3)
            AccountView()
                .tabItem { Label { Text(L10n.tr("Account", "Tài khoản")) } icon: { tabIcon("account", selected: router.selectedTab == 4) } }
                .tag(4)
        }
        // Language is read app-wide via L10n's lock-guarded flag (not @Observable),
        // so a switch won't invalidate already-built tabs on its own. Re-key the tab
        // CONTENT here to rebuild every screen in the new language at once. Keep this
        // INNERMOST (right on the TabView) so the modifiers below sit OUTSIDE the
        // reset boundary — otherwise a language switch would restart .task and a
        // theme change would tear the tree down instead of recoloring smoothly.
        // uiGen folds in so the chrome also rebuilds once the MT prefetch fills.
        .id("\(AppSettings.shared.language.rawValue)-\(mt.uiGen)")
        // OUTSIDE the .id reset boundary on purpose: these run once, not on every
        // language switch. Refresh unread + decide whether to surface the daily
        // availability review.
        .task {
            await unread.refresh()
            await availability.maybePresent()
        }
        // A sign-in that lands after launch (guest → account) re-checks the review.
        .onChange(of: auth.isSignedIn) { if auth.isSignedIn { Task { await availability.maybePresent() } } }
        .sheet(isPresented: $availability.present) {
            AvailabilityReviewView(model: availability)
        }
        // Every button in the app draws its OWN look (brand fills, tint chips, plain
        // text). Force .plain app-wide so no iOS version wraps them in system chrome —
        // notably iOS 26's Liquid-Glass capsule, which put an ugly pill behind every
        // rectangular CTA. Descendant styles (sheets, pushes) inherit this default.
        .buttonStyle(.plain)
        // Theme override: System (nil) follows the OS; Light/Dark force it. The
        // Tokens.adaptive dynamic UIColors re-resolve against this automatically.
        .preferredColorScheme(AppSettings.shared.colorScheme)
        // Locale for system-formatted dates/pickers.
        .environment(\.locale, Locale(identifier: AppSettings.shared.isVi ? "vi" : "en"))
    }
}
