import SwiftUI

@main
struct EnoApp: App {
    // Installs the APNs/notification delegate (audit #4). Registration itself is
    // gated by PushManager.enabled until the entitlement + APNS_* env ship.
    @UIApplicationDelegateAdaptor(PushManager.self) private var pushDelegate
    @Environment(\.scenePhase) private var scenePhase
    /// The brand moment on a cold launch — see LaunchCoverView. Once; never again on foreground.
    @State private var launching = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                root
                if launching {
                    LaunchCoverView { launching = false }
                        .zIndex(1)
                }
            }
        }
    }

    /// The app proper. It renders UNDER the launch cover from the first frame, so by the time the
    /// cover zooms away the home screen is already there — that is what makes the hand-over seamless.
    private var root: some View {
            RootView()
                .tint(Tokens.brand)
                .task {
                    APIClient.shared.ensureFreshToken = { await AuthModel.shared.refreshIfNeeded() }
                    await AuthModel.shared.restore()
                }
                // Universal Links (audit #3): a tapped https://eno.vn/... link arrives
                // as a browsing user-activity; the enonative:// custom scheme + a
                // notification tap come through onOpenURL. Both feed the router.
                .onOpenURL { DeepLinkRouter.shared.handle($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { DeepLinkRouter.shared.handle(url) }
                }
                .onChange(of: scenePhase) {
                    if scenePhase == .active {
                        Task {
                            await AuthModel.shared.refreshIfNeeded()
                            await UnreadModel.shared.refresh()
                            await NotifModel.shared.refreshBadge()
                            await PushManager.shared.registerIfSignedIn()
                        }
                    }
                }
    }
}
