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

    func refresh() async {
        loaded = false
        await start()
    }

    func start() async {
        guard !loaded else { return }
        loaded = true
        // FX only feeds the decorative "≈ $" price — take it OFF the critical
        // path (fire-and-forget) so the rails don't block on its round-trip
        // (audit #8). The ≈$ fills in whenever the rate resolves.
        Task { await Fx.shared.ensureLoaded() }
        async let a: Void = loadForYou()
        async let b: Void = loadBusinesses()
        async let c: Void = loadRails()
        _ = await (a, b, c)
        // recentlyViewed is (re)loaded by FeedView.task on every appearance — it
        // changes when you view a listing — so it is NOT fetched here, to avoid a
        // duplicate fetch on first paint (audit #8).
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
