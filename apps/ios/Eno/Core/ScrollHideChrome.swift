import SwiftUI

// Drop-in scroll-hide chrome — an EXACT port of the web `useHideOnScroll` hook
// (src/hooks/use-hide-on-scroll.ts): the top header/search and the bottom nav
// both bind to one shared `hidden` signal so they retract together on scroll-down
// and slide back on scroll-up / near the top (owner behavior, 2026-07-16).
//
// HOW TO WIRE (Feed/RootView owner):
//   1. On the scrolling container:  .tracksChromeHide()
//   2. Top header/search overlay:   .offset(y: chrome.hidden ? -headerHeight : 0)
//                                    .animation(.easeOut(duration: 0.2), value: chrome.hidden)
//   3. Bottom nav: SwiftUI's system TabView bar can't be offset — to get the web's
//      hide-on-scroll bottom nav the app needs a CUSTOM bottom bar (an HStack pinned
//      with .safeAreaInset(edge: .bottom)) whose .offset(y: chrome.hidden ? barH : 0)
//      slides it off-screen. Bind that bar to `ChromeState.shared.hidden`.
@MainActor
@Observable
final class ChromeState {
    static let shared = ChromeState()

    var hidden = false
    private var lastY: CGFloat = 0

    // Web parity: threshold 6px (min delta to flip), revealOffset 80px (always
    // shown above this). Clamp negatives (iOS rubber-band overscroll).
    private let threshold: CGFloat = 6
    private let revealOffset: CGFloat = 80

    func onScroll(_ rawY: CGFloat) {
        let y = max(0, rawY)
        if y < revealOffset {
            if hidden { hidden = false }
            lastY = y
            return
        }
        let delta = y - lastY
        if abs(delta) > threshold {
            let next = delta > 0 // scrolling down → hide; up → reveal
            if next != hidden { hidden = next }
            lastY = y
        }
    }

    // Reset when a tab re-appears / a screen is pushed, so chrome starts visible.
    func reset() {
        hidden = false
        lastY = 0
    }
}

extension View {
    /// Attach to a ScrollView/List to drive `ChromeState.shared` from its vertical
    /// content offset. iOS 18+ uses the precise scroll-geometry signal; on 17 it's
    /// a no-op (chrome stays visible — acceptable degrade).
    // @MainActor so the default `.shared` (a main-actor-isolated static) is
    // referenced from a main-actor context — otherwise a Swift 6 hard error.
    @ViewBuilder @MainActor
    func tracksChromeHide(_ chrome: ChromeState = .shared) -> some View {
        if #available(iOS 18.0, *) {
            self.onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y } action: { _, y in
                chrome.onScroll(y)
            }
        } else {
            self
        }
    }
}
