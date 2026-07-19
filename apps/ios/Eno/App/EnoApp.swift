import SwiftUI

@main
struct EnoApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Tokens.brand)
                .task { await AuthModel.shared.restore() }
                .onChange(of: scenePhase) {
                    if scenePhase == .active {
                        Task {
                            await AuthModel.shared.refreshIfNeeded()
                            await UnreadModel.shared.refresh()
                        }
                    }
                }
        }
    }
}
