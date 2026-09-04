import SwiftUI
import EnoUI

// Native search v2, mirroring the web's search surfaces: empty focus shows
// recent searches (device-local) + trending terms; typing ≥2 chars streams the
// typeahead (/api/search/suggest — listing, category and brand matches, same
// ranking as the feed); submit runs the full ranked results with sort tabs and
// the price filter. Suggestion taps deep-open the PDP via an ids fetch.
struct SearchView: View {
    @State private var query = ""
    @State private var submitted = false
    /// ⛔ THE TERM WE JUST SET OURSELVES. Assigning `query` inside submit() fires `.onChange(of: query)`,
    /// which calls onType(), which sets `submitted = false` — so every recent / trending / popular /
    /// brand chip tap ran a search and then instantly bounced back to the typeahead. One-tap search was
    /// the entire point of that empty state, and none of it worked. This lets onType() tell a keystroke
    /// from our own assignment.
    @State private var programmaticQuery: String?
    @State private var results = FeedModel()
    @State private var suggest: SuggestResponse?
    @State private var trending: [String] = []
    @State private var recents = RecentStore.searches()
    @State private var openedCard: ListingCard?
    @State private var showFilter = false
    @State private var suggestTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            if submitted {
                resultsView
            } else if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                suggestView
            } else {
                emptyState
            }
        }
        .background(Tokens.canvas)
        .navigationTitle(L10n.tr("Search", "Tìm kiếm"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: L10n.tr("Find products…", "Tìm sản phẩm…"))
        .onSubmit(of: .search) { submit(query) }
        .onChange(of: query) { onType() }
        .navigationDestination(item: $openedCard) { card in
            ListingDetailView(card: card)
        }
        .navigationDestination(for: AppCategory.self) { cat in
            CategoryFeedView(category: cat)
        }
        .sheet(isPresented: $showFilter) { PriceFilterSheet(model: results) }
        .task {
            if trending.isEmpty, let t: TrendingResponse = try? await APIClient.shared.get("api/search/trending") {
                trending = t.trending
            }
        }
    }

    // ── flows ──
    private func onType() {
        // Our own assignment, not the user typing — leave `submitted` alone.
        if let p = programmaticQuery, p == query { programmaticQuery = nil; return }
        submitted = false
        suggestTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { suggest = nil; return }
        suggestTask = Task {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            if let s: SuggestResponse = try? await APIClient.shared.get("api/search/suggest", query: [URLQueryItem(name: "q", value: q)]) {
                guard !Task.isCancelled, s.q == query.trimmingCharacters(in: .whitespaces) else { return }
                suggest = s
            }
        }
    }

    private func submit(_ term: String) {
        let q = term.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return }
        // ⛔ ONLY FLAG A CHANGE THAT WILL ACTUALLY HAPPEN. `onChange` is what consumes this flag, and
        // assigning `query` a value it already holds fires nothing — so the flag survived, and the
        // NEXT time the seller typed their way back to that exact term it was mistaken for a
        // programmatic assignment: no suggestions, and the view stuck showing results.
        if query != q {
            programmaticQuery = q
            query = q
        }
        RecentStore.recordSearch(q)
        recents = RecentStore.searches()
        submitted = true
        results.query = q
    }

    private func openListing(_ id: String) {
        Task {
            if let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [URLQueryItem(name: "ids", value: id)]),
               let card = page.listings.first {
                openedCard = card
            }
        }
    }

    // Uppercase, letter-spaced, muted eyebrow with a small leading icon (web section header).
    private func eyebrow(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).enoIcon(.xs, color: EnoColor.sub)
            Text(text).enoText(.micro, color: EnoColor.sub).textCase(.uppercase).tracking(0.6)
        }
    }

    // Search suggestion / recent-term pill — now the canonical EnoChip (the old hand-rolled
    // radius-12 pill converged onto the chip tier).
    private func softChip(_ label: String, action: @escaping () -> Void) -> some View {
        EnoChip(label, action: action)
    }

    // ── empty focus: recent + trending + popular (web search dropdown) ──
    @ViewBuilder
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !recents.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        eyebrow("clock", L10n.tr("Recent", "Tìm gần đây"))
                        Spacer()
                        EnoButton(L10n.tr("Clear", "Xóa"), variant: .text, size: .compact, fullWidth: false) {
                            RecentStore.clearSearches()
                            recents = []
                        }
                    }
                    FlowLayout(spacing: 6) { ForEach(recents, id: \.self) { t in softChip(t) { submit(t) } } }
                }
            }
            if !trending.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    eyebrow("chart.line.uptrend.xyaxis", L10n.tr("Trending", "Xu hướng tìm kiếm"))
                    FlowLayout(spacing: 6) { ForEach(trending, id: \.self) { t in softChip(t) { submit(t) } } }
                }
            }
            // Popular categories — shown when there are no recents (web fallback).
            if recents.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    eyebrow("chart.line.uptrend.xyaxis", L10n.tr("Popular", "Phổ biến"))
                    FlowLayout(spacing: 6) {
                        ForEach(Array(Categories.all.prefix(8))) { cat in
                            // NavigationLink owns the tap, so it wraps the chip VISUAL —
                            // nesting EnoChip's own Button here would break tap + VoiceOver.
                            NavigationLink(value: cat) { EnoChipLabel(cat.name) }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    // ── typeahead: query → brands → categories → listings (web search-suggest order) ──
    @ViewBuilder
    private var suggestView: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let s = suggest {
                // 1. free-text query row — ALWAYS first (Enter runs it).
                Button { submit(query) } label: {
                    row(icon: "magnifyingglass", title: L10n.tr("Search for “\(query)”", "Tìm “\(query)”"))
                }
                .buttonStyle(.plain)

                let brands = s.brands ?? []
                let cats = Array(s.categories.prefix(2))

                // 2. Brands
                if !brands.isEmpty {
                    eyebrow("tag", L10n.tr("Brands", "Thương hiệu")).padding(.horizontal, 16).padding(.top, 10)
                    FlowLayout(spacing: 6) { ForEach(brands) { b in softChip(b.name) { submit(b.name) } } }
                        .padding(.horizontal, 16).padding(.top, 6)
                }
                // 3. Categories
                if !cats.isEmpty {
                    eyebrow("square.grid.2x2", L10n.tr("Categories", "Danh mục")).padding(.horizontal, 16).padding(.top, 10)
                    FlowLayout(spacing: 6) {
                        ForEach(cats) { cat in
                            if let appCat = Categories.bySlug(cat.slug) {
                                NavigationLink(value: appCat) {
                                    EnoChipLabel(L10n.isVi ? cat.nameVi : cat.name)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 6)
                }
                // 4. Listings
                if !s.listings.isEmpty {
                    eyebrow("bag", L10n.tr("Listings", "Tin đăng")).padding(.horizontal, 16).padding(.top, 10)
                    ForEach(s.listings) { l in
                        Button { openListing(l.id) } label: { suggestListingRow(l) }
                            .buttonStyle(.plain)
                    }
                }
                // No matches
                if brands.isEmpty && cats.isEmpty && s.listings.isEmpty {
                    Text(L10n.tr("No matches yet", "Chưa có kết quả"))
                        .enoText(.caption, color: EnoColor.sub)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 32)
            }
        }
        .padding(.vertical, 4)
    }

    // The free-text query row (icon + title).
    private func row(icon: String, title: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .enoIcon(.sm, color: EnoColor.sub)
                .frame(width: 40, height: 40)
                .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.chip))
            Text(title).enoText(.label).lineLimit(1)
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 8).contentShape(Rectangle())
    }

    // A listing suggestion row: thumbnail + title, then price (accent) · location (muted).
    private func suggestListingRow(_ l: SuggestResponse.SuggestListing) -> some View {
        HStack(spacing: 12) {
            EnoRemoteImage(url: l.image.flatMap { ImageURL.optimized($0, width: 96) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { EnoColor.tint }
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
            VStack(alignment: .leading, spacing: 2) {
                Text(l.displayTitle).enoText(.callout).lineLimit(1)
                // Concatenated Text: keep the per-run colors, so set only the font role.
                (Text(Format.vnd(l.price)).foregroundStyle(EnoColor.brand).fontWeight(.semibold)
                    + Text(" · \(l.location)").foregroundStyle(EnoColor.sub))
                    .font(EnoTextRole.caption.font).lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 8).contentShape(Rectangle())
    }

    // ── submitted results ──
    private var resultsView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                SortBar(model: results)
                FilterChip(active: results.hasPriceFilter) { showFilter = true }
                    .padding(.trailing, 12)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(results.items) { item in
                    NavigationLink(value: item) {
                        ListingCardView(listing: item)
                    }
                    .buttonStyle(.plain)
                    .task { await results.loadMoreIfNeeded(current: item) }
                }
                if results.items.isEmpty && results.isRefreshing {
                    ForEach(0..<4, id: \.self) { _ in SkeletonCard() }
                }
            }
            .padding(.horizontal, 12)
            if !results.isRefreshing && results.items.isEmpty {
                Text(L10n.tr("No results for \"\(query)\"", "Không tìm thấy \"\(query)\""))
                    .enoText(.label, color: EnoColor.sub)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
            }
        }
        .padding(.top, 8)
    }
}

// Simple wrapping layout for term chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
        return CGSize(width: width, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            sub.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
    }
}
