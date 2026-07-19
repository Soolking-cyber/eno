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
            items = page
            offset = page.count
            exhausted = page.count < pageSize
            failed = false
            if category == nil, let data = try? JSONEncoder().encode(page) {
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
            items.append(contentsOf: page.filter { !known.contains($0.id) })
            offset += page.count
            exhausted = page.count < pageSize
        }
    }

    private func fetchPage(offset: Int) async throws -> [ListingCard] {
        var q = [
            URLQueryItem(name: "limit", value: String(pageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let category { q.append(URLQueryItem(name: "category", value: category)) }
        let page: FeedPage = try await APIClient.shared.get("api/listings", query: q)
        return page.listings
    }
}
