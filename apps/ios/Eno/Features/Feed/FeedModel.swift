import Foundation
import Observation

// Browse feed state: offset-paged /api/listings, native SWR — the last page of
// results persists to disk so a cold launch paints instantly (the same
// stale-while-revalidate contract the web app and the old shell used).
@MainActor
@Observable
final class FeedModel {
    var items: [ListingCard] = []
    var isLoading = false
    var isRefreshing = false
    var failed = false
    var category: String? {
        didSet { if oldValue != category { Task { await reload() } } }
    }
    // Feed sort, mirroring buildFeedOrderBy's public values: newest (default =
    // the Recommended blend), recent, price-low, price-high, popular.
    var sort: String = "newest" {
        didSet { if oldValue != sort { Task { await reload() } } }
    }
    // Full-text query (accent-folded searchText + pg_trgm server-side).
    var query: String? {
        didSet { if oldValue != query { Task { await reload() } } }
    }
    // Subcategory facet (slug; nil = all). Counts arrive with category pages.
    var subcategory: String? {
        didSet { if oldValue != subcategory { Task { await reload() } } }
    }
    private(set) var subcategoryCounts: [String: Int] = [:]
    // Price range filter (VND), mirroring the web's priceMin/priceMax params.
    var priceMin: Int? {
        didSet { if oldValue != priceMin { Task { await reload() } } }
    }
    var priceMax: Int? {
        didSet { if oldValue != priceMax { Task { await reload() } } }
    }
    var hasPriceFilter: Bool { priceMin != nil || priceMax != nil }

    private var offset = 0
    private var exhausted = false
    private let pageSize = 24

    private static let cacheURL = URL.cachesDirectory.appending(path: "feed-v1.json")

    func start() async {
        guard items.isEmpty else { return }
        // Instant paint from the disk cache, then revalidate. Decode off the
        // MainActor (review #11 addendum) — the cache can be hundreds of KB.
        let cacheURL = Self.cacheURL
        let cached = await Task.detached(priority: .userInitiated) { () -> [ListingCard]? in
            guard let data = try? Data(contentsOf: cacheURL) else { return nil }
            return try? JSONDecoder().decode([ListingCard].self, from: data)
        }.value
        if let cached, !cached.isEmpty, items.isEmpty {
            items = cached
            offset = cached.count
        }
        await reload()
    }

    // Latest-wins (review #10): rapid filter/sort changes fire overlapping
    // reloads; only the newest may commit.
    private var reloadGen = 0

    func reload() async {
        isRefreshing = true
        defer { isRefreshing = false }
        reloadGen += 1
        let gen = reloadGen
        do {
            let page = try await fetchPage(offset: 0)
            guard gen == reloadGen else { return }
            items = page.listings
            offset = page.listings.count
            exhausted = page.listings.count < pageSize
            failed = false
            // Fresh bases arrived for THESE listings — their session save-deltas
            // would now double-count. Scoped (review #11): deltas shown on other
            // surfaces (PDP, Saved) survive.
            FavoritesStore.shared.clearDeltas(for: page.listings.map(\.id))
            if let counts = page.subcategoryCounts { subcategoryCounts = counts }
            if category == nil, query == nil, sort == "newest", !hasPriceFilter, subcategory == nil {
                let snapshot = page.listings
                Task.detached(priority: .utility) {
                    if let data = try? JSONEncoder().encode(snapshot) {
                        try? data.write(to: Self.cacheURL)
                    }
                }
            }
        } catch {
            guard gen == reloadGen else { return }
            failed = items.isEmpty
        }
    }

    func loadMoreIfNeeded(current item: ListingCard) async {
        guard !isLoading, !exhausted,
              let idx = items.firstIndex(of: item), idx >= items.count - 6 else { return }
        isLoading = true
        defer { isLoading = false }
        if let page = try? await fetchPage(offset: offset) {
            // De-dupe on id: the feed can shift under us between pages (bumps, new posts).
            let known = Set(items.map(\.id))
            items.append(contentsOf: page.listings.filter { !known.contains($0.id) })
            offset += page.listings.count
            exhausted = page.listings.count < pageSize
        }
    }

    private func fetchPage(offset: Int) async throws -> FeedPage {
        var q = [
            URLQueryItem(name: "limit", value: String(pageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let category { q.append(URLQueryItem(name: "category", value: category)) }
        if let subcategory { q.append(URLQueryItem(name: "subcategory", value: subcategory)) }
        if let query { q.append(URLQueryItem(name: "q", value: query)) }
        if sort != "newest" { q.append(URLQueryItem(name: "sort", value: sort)) }
        if let priceMin { q.append(URLQueryItem(name: "priceMin", value: String(priceMin))) }
        if let priceMax { q.append(URLQueryItem(name: "priceMax", value: String(priceMax))) }
        return try await APIClient.shared.get("api/listings", query: q)
    }
}
