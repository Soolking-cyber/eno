import Foundation
import Observation
import UIKit

// Native mirror of favorites-context.tsx. Favorites are DEVICE-LOCAL by design
// (web keeps them in localStorage 'eno:favorites'; there is NO per-user server
// state) — the only server interaction is the anonymous aggregate counter:
// POST /api/listings/[id]/save {saved:bool}, fire-and-forget, rate-limited and
// clamped server-side. Display rule (landmine from the web): a card's saved
// count = server base + session-local signed DELTA (floored at 0), NEVER
// "+1 because favorited" — and the delta resets whenever a fresh base loads,
// or your own save double-counts.
@MainActor
@Observable
final class FavoritesStore {
    static let shared = FavoritesStore()

    private static let key = "eno-favorites"

    private(set) var ids: [String]
    private var deltas: [String: Int] = [:]

    private init() {
        ids = UserDefaults.standard.stringArray(forKey: Self.key) ?? []
    }

    func isFavorite(_ id: String) -> Bool { ids.contains(id) }
    var count: Int { ids.count }

    func delta(_ id: String) -> Int { deltas[id] ?? 0 }

    /// Fresh server bases arrived for THESE listings — their persisted counts
    /// already include prior saves; keeping their deltas would double-count.
    /// Scoped on purpose (review #11): deltas for listings still displayed with
    /// an older base elsewhere must survive.
    func clearDeltas(for ids: [String]) {
        for id in ids { deltas.removeValue(forKey: id) }
    }

    func toggle(_ id: String) {
        let added: Bool
        if let idx = ids.firstIndex(of: id) {
            ids.remove(at: idx)
            added = false
        } else {
            ids.insert(id, at: 0)
            added = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        UserDefaults.standard.set(ids, forKey: Self.key)
        deltas[id] = (deltas[id] ?? 0) + (added ? 1 : -1)
        Task {
            _ = try? await APIClient.shared.send("POST", "api/listings/\(id)/save", body: ["saved": added])
        }
    }

    /// Self-heal: ids the server no longer returns (sold/hidden/deleted).
    func prune(requested: [String], returned: Set<String>) {
        let gone = Set(requested).subtracting(returned)
        guard !gone.isEmpty else { return }
        ids.removeAll { gone.contains($0) }
        UserDefaults.standard.set(ids, forKey: Self.key)
    }
}
