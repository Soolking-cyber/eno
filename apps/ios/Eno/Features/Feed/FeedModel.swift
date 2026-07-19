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
        // Instant paint from the disk cache, then revalidate.
        if let data = try? Data(contentsOf: Self.cacheURL),
           let cached = try? JSONDecoder().decode([ListingCard].self, from: data), !cached.isEmpty {
            items = cached
            offset = cached.count
        }
        await reload()
    }

    func reload() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let page = try await fetchPage(offset: 0)
            items = page.listings
            offset = page.listings.count
            exhausted = page.listings.count < pageSize
            failed = false
            // Fresh bases arrived — session save-deltas would now double-count.
            FavoritesStore.shared.resetDeltas()
            if let counts = page.subcategoryCounts { subcategoryCounts = counts }
            if category == nil, query == nil, sort == "newest", !hasPriceFilter, subcategory == nil,
               let data = try? JSONEncoder().encode(page.listings) {
                try? data.write(to: Self.cacheURL)
            }
        } catch {
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
