import Foundation
import Observation

// Browse feed state: offset-paged /api/listings, native SWR — the last page of
// results persists to disk so a cold launch paints instantly (the same
// stale-while-revalidate contract the web app and the old shell used).
@MainActor
@Observable
final class FeedModel {
    var items: [ListingCard] = []
    // Total matching the active filter (from the API) for the "Found N listings"
    // count row above the explorer results (#128).
    var totalCount: Int?
    var isLoading = false
    var isRefreshing = false
    var failed = false
    /// ⛔ HAS A LOAD FINISHED AT ALL? Without this the grid could not tell "still fetching" from
    /// "fetched, and there is genuinely nothing" — so an empty feed shimmered six skeletons FOREVER
    /// and read as a hung app. That is not a hypothetical: the edition hide-list makes an empty
    /// marketplace the CORRECT result on eno.forum, so the most legitimate state looked the most broken.
    var loaded = false
    var category: String? {
        didSet { if oldValue != category { scheduleReload() } }
    }
    // Feed sort, mirroring buildFeedOrderBy's public values: newest (default =
    // the Recommended blend), recent, price-low, price-high, popular.
    var sort: String = "newest" {
        didSet { if oldValue != sort { scheduleReload() } }
    }
    // Full-text query (accent-folded searchText + pg_trgm server-side).
    var query: String? {
        didSet { if oldValue != query { scheduleReload() } }
    }
    // Subcategory facet (slug; nil = all). Counts arrive with category pages.
    var subcategory: String? {
        didSet { if oldValue != subcategory { scheduleReload() } }
    }
    private(set) var subcategoryCounts: [String: Int] = [:]
    // Brand + model facets (the quick-find rail): brandSlug + model params.
    var brand: String? {
        didSet { if oldValue != brand { scheduleReload() } }
    }
    var model: String? {
        didSet { if oldValue != model { scheduleReload() } }
    }
    // Price range filter (VND), mirroring the web's priceMin/priceMax params.
    var priceMin: Int? {
        didSet { if oldValue != priceMin { scheduleReload() } }
    }
    var priceMax: Int? {
        didSet { if oldValue != priceMax { scheduleReload() } }
    }
    // Condition filter ("new" | "used"), mirroring the web's ?condition param.
    /// The web's two remaining home facets, which the app had no field for at all. `listingType`
    /// is the API's `type` (sell / rent / wanted); `province` matches the listing's city, which is
    /// the only area level the current listings carry (see feed-query.ts).
    var listingType: String? {
        didSet { if listingType != oldValue { scheduleReload() } }
    }
    var province: String? {
        didSet { if province != oldValue { scheduleReload() } }
    }
    var condition: String? {
        didSet { if oldValue != condition { scheduleReload() } }
    }
    // Verified-only (web default = true → the server's implicit verified-only feed).
    // OFF sends verified=all to reveal unverified/held listings (web setVerifiedOnly).
    var verifiedOnly = true {
        didSet { if oldValue != verifiedOnly { scheduleReload() } }
    }
    // Per-category facet filters, already keyed as the server expects:
    // attr_{facetKey}=value for chip/select facets, range_{column}="min-max" for
    // range facets. The filter sheet builds these from the taxonomy facet defs.
    var customFilters: [String: String] = [:] {
        didSet { if oldValue != customFilters { scheduleReload() } }
    }
    var hasPriceFilter: Bool { priceMin != nil || priceMax != nil || condition != nil || !customFilters.isEmpty || !verifiedOnly }

    private var offset = 0
    private var exhausted = false
    private let pageSize = 24

    // Sendable + immutable, so it can be read from a detached task without a
    // MainActor hop (Swift-6 concurrency, audit #13a).
    nonisolated static let cacheURL = URL.cachesDirectory.appending(path: "feed-v1.json")

    // Filter/sort changes fire overlapping reloads; retain + cancel the previous
    // one so untracked tasks don't pile up (audit #7). The reloadGen token below
    // is what actually enforces latest-wins on the results.
    private var reloadTask: Task<Void, Never>?
    private func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task { await reload() }
    }

    func start() async {
        guard items.isEmpty else { return }
        // Instant paint from the disk cache, then revalidate. Decode off the
        // MainActor (review #11 addendum) — the cache can be hundreds of KB.
        let cached = await Task.detached(priority: .userInitiated) { () -> [ListingCard]? in
            guard let data = try? Data(contentsOf: Self.cacheURL) else { return nil }
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
            loaded = true
            totalCount = page.total
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
            loaded = true
        }
    }

    /// Adopt a saved filter set. ⚠️ ASSIGNED THROUGH THE `didSet` PROPERTIES ON PURPOSE — each one
    /// schedules a reload, and the debounce in `scheduleReload` collapses the burst into one fetch.
    /// Bypassing them with a private backing store would leave the model showing the old results.
    func apply(_ p: SavedSearchParams) {
        category = p.category
        subcategory = p.subcategory
        brand = p.brand
        model = p.model
        query = p.q
        condition = p.condition
        priceMin = p.priceMin
        priceMax = p.priceMax
    }

    /// The current filter set, in the shape the saved-search route normalises.
    /// ⚠️ SORT IS DELIBERATELY ABSENT. `normalizeParams` does not keep it, so a saved search is a set
    /// of FILTERS, not an ordering — including it here would suggest the app saved something the
    /// server discards.
    var savedSearchParams: SavedSearchParams {
        SavedSearchParams(
            category: category,
            subcategory: subcategory,
            brand: brand,
            model: model,
            q: query,
            condition: condition,
            priceMin: priceMin,
            priceMax: priceMax,
        )
    }

    func loadMoreIfNeeded(current item: ListingCard) async {
        guard !isLoading, !exhausted,
              let idx = items.firstIndex(of: item), idx >= items.count - 6 else { return }
        isLoading = true
        defer { isLoading = false }
        // Pin the generation the page is fetched under (audit #7): if a filter
        // change committed a new list while this page was in flight, discard it —
        // otherwise stale-filter listings append and `offset` corrupts.
        let gen = reloadGen
        if let page = try? await fetchPage(offset: offset) {
            guard gen == reloadGen else { return }
            // De-dupe on id: the feed can shift under us between pages (bumps, new posts).
            let known = Set(items.map(\.id))
            items.append(contentsOf: page.listings.filter { !known.contains($0.id) })
            offset += page.listings.count
            exhausted = page.listings.count < pageSize
        }
    }

    // Every active filter/sort param EXCEPT limit/offset — reused by fetchPage and
    // (Step 2) the price-histogram probe + (Step 3 #129) the map fetch.
    var filterItems: [URLQueryItem] {
        var q: [URLQueryItem] = []
        if let category { q.append(URLQueryItem(name: "category", value: category)) }
        if let subcategory { q.append(URLQueryItem(name: "subcategory", value: subcategory)) }
        if let brand { q.append(URLQueryItem(name: "brand", value: brand)) }
        if let model { q.append(URLQueryItem(name: "model", value: model)) }
        if let query { q.append(URLQueryItem(name: "q", value: query)) }
        if sort != "newest" { q.append(URLQueryItem(name: "sort", value: sort)) }
        if let priceMin { q.append(URLQueryItem(name: "priceMin", value: String(priceMin))) }
        if let priceMax { q.append(URLQueryItem(name: "priceMax", value: String(priceMax))) }
        if let condition { q.append(URLQueryItem(name: "condition", value: condition)) }
        if let listingType, listingType != "all" { q.append(URLQueryItem(name: "type", value: listingType)) }
        if let province { q.append(URLQueryItem(name: "province", value: province)) }
        if !verifiedOnly { q.append(URLQueryItem(name: "verified", value: "all")) }
        for (k, v) in customFilters.sorted(by: { $0.key < $1.key }) {
            q.append(URLQueryItem(name: k, value: v))
        }
        return q
    }

    private func fetchPage(offset: Int) async throws -> FeedPage {
        var q = [
            URLQueryItem(name: "limit", value: String(pageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        q.append(contentsOf: filterItems)
        return try await APIClient.shared.get("api/listings", query: q)
    }
}
