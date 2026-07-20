import SwiftUI

// Central deep-link router (audit #3). Feeds both Universal Links (applinks:eno.vn,
// once the entitlement + AASA env are live) and the enonative:// custom scheme, plus
// notification taps (PushManager). Routes to the SAME native destinations the tabs
// already push. Parsing is a pure static func so it's unit-testable without a running
// app; the @Observable state drives RootView's TabView selection + the Explore stack.
@MainActor
@Observable
final class DeepLinkRouter {
    static let shared = DeepLinkRouter()

    // 0=Explore 1=Saved 2=Post 3=Messages 4=Account (RootView tab order).
    var selectedTab = 0
    var explorePath = NavigationPath()
    var pendingConversation: String?

    enum Route: Hashable {
        case listing(String)
        case category(String)
        case brand(String)
        case conversation(String)
    }

    // Pure: maps a URL (https://eno.vn/... OR enonative://...) to a Route, or nil.
    // Mirrors the AASA components (/listings/*, /c/*, /brands/*); /auth/* is NOT a
    // deep link (OAuth must finish in the browser) and returns nil. nonisolated so
    // it's unit-testable without the main actor.
    nonisolated static func route(for url: URL) -> Route? {
        // Custom scheme (enonative://listing/<id>) → host is the first segment.
        // Universal Link (https://eno.vn/listings/<id>) → use the path.
        let segments: [String]
        if url.scheme == "https" || url.scheme == "http" {
            segments = url.pathComponents.filter { $0 != "/" }
        } else {
            segments = ([url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" })
        }
        guard let head = segments.first?.lowercased(), segments.count >= 2 else { return nil }
        let arg = segments[1]
        switch head {
        case "listings", "listing": return .listing(arg)
        case "c", "category": return .category(arg)
        case "brands", "brand": return .brand(arg)
        case "messages", "conversation": return .conversation(arg)
        default: return nil
        }
    }

    func handle(_ url: URL) {
        guard let route = Self.route(for: url) else { return }
        apply(route)
    }

    func openConversation(_ id: String) { apply(.conversation(id)) }

    private func apply(_ route: Route) {
        switch route {
        case .listing, .category, .brand:
            selectedTab = 0
            explorePath.append(route)
        case .conversation(let id):
            selectedTab = 3
            pendingConversation = id
        }
    }
}
