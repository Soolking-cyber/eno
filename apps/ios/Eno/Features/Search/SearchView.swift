import SwiftUI

// Native search v2, mirroring the web's search surfaces: empty focus shows
// recent searches (device-local) + trending terms; typing ≥2 chars streams the
// typeahead (/api/search/suggest — listing, category and brand matches, same
// ranking as the feed); submit runs the full ranked results with sort tabs and
// the price filter. Suggestion taps deep-open the PDP via an ids fetch.
struct SearchView: View {
    @State private var query = ""
    @State private var submitted = false
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
        query = q
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
            Image(systemName: icon).font(.system(size: 11, weight: .bold))
            Text(text).font(.system(size: 11, weight: .bold)).textCase(.uppercase).tracking(0.6)
        }
        .foregroundStyle(Tokens.sub)
    }

    // Soft rounded-xl chip — NO per-chip icon (web variant="soft"). Web chip text is
    // text-body (#525252), not near-black.
    private func softChip(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Tokens.sub)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
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
                        Button(L10n.tr("Clear", "Xóa")) {
                            RecentStore.clearSearches()
                            recents = []
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Tokens.sub)
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
                            NavigationLink(value: cat) {
                                Text(cat.name)
                                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.sub)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
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
                                    Text(L10n.isVi ? cat.nameVi : cat.name)
                                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.fg)
                                        .padding(.horizontal, 14).padding(.vertical, 8)
                                        .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 12))
                                }
                                .buttonStyle(.plain)
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
                        .font(.system(size: 12)).foregroundStyle(Tokens.sub)
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
                .font(.system(size: 15))
                .foregroundStyle(Tokens.sub)
                .frame(width: 40, height: 40)
                .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 8))
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.fg).lineLimit(1)
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 8).contentShape(Rectangle())
    }

    // A listing suggestion row: thumbnail + title, then price (accent) · location (muted).
    private func suggestListingRow(_ l: SuggestResponse.SuggestListing) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: l.image.flatMap { ImageURL.optimized($0, width: 96) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(l.displayTitle).font(.system(size: 14, weight: .medium)).foregroundStyle(Tokens.fg).lineLimit(1)
                (Text(Format.vnd(l.price)).foregroundStyle(Tokens.brand).fontWeight(.semibold)
                    + Text(" · \(l.location)").foregroundStyle(Tokens.sub))
                    .font(.system(size: 12)).lineLimit(1)
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
                    .font(.system(size: 15))
                    .foregroundStyle(Tokens.sub)
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
