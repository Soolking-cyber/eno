import Foundation
import Observation

// Rails for the landing surface, mirroring the web home's below-hero sections:
// For-you/recommendations (self-hides when the server returns [] — the guest
// thin-catalog guard), Outstanding businesses, per-category rails. Each loads
// independently and best-effort; a failed rail simply doesn't render.
@MainActor
@Observable
final class HomeModel {
    var forYou: [ListingCard] = []
    var businesses: [ListingCard] = []
    var rails: [CategoryRails.Rail] = []
    var recentlyViewed: [ListingCard] = []

    private var loaded = false

    func start() async {
        guard !loaded else { return }
        loaded = true
        await Fx.shared.ensureLoaded()
        async let a: Void = loadForYou()
        async let b: Void = loadBusinesses()
        async let c: Void = loadRails()
        async let d: Void = loadRecentlyViewed()
        _ = await (a, b, c, d)
    }

    // Refreshed on every home appearance — viewing a listing changes it.
    func loadRecentlyViewed() async {
        let ids = RecentStore.viewedIds()
        guard !ids.isEmpty else { recentlyViewed = []; return }
        guard let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [
            URLQueryItem(name: "ids", value: ids.joined(separator: ",")),
        ]) else { return }
        // The API returns feed order; restore most-recently-viewed-first.
        let byId = Dictionary(uniqueKeysWithValues: page.listings.map { ($0.id, $0) })
        recentlyViewed = ids.compactMap { byId[$0] }
    }

    private func loadForYou() async {
        if let page: FeedPage = try? await APIClient.shared.get("api/recommendations") {
            forYou = page.listings
        }
    }

    private func loadBusinesses() async {
        if let page: FeedPage = try? await APIClient.shared.get("api/businesses/top") {
            businesses = page.listings
        }
    }

    private func loadRails() async {
        if let r: CategoryRails = try? await APIClient.shared.get("api/category-rails") {
            rails = r.rails
        }
    }
}
