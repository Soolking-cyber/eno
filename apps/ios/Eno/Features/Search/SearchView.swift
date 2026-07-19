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

    // ── empty focus: recents + trending ──
    @ViewBuilder
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !recents.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(L10n.tr("Recent searches", "Tìm kiếm gần đây"))
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Tokens.fg)
                        Spacer()
                        Button(L10n.tr("Clear", "Xóa")) {
                            RecentStore.clearSearches()
                            recents = []
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Tokens.sub)
                    }
                    flow(recents, icon: "clock") { submit($0) }
                }
            }
            if !trending.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.tr("Trending", "Xu hướng tìm kiếm"))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Tokens.fg)
                    flow(trending, icon: "flame") { submit($0) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    private func flow(_ terms: [String], icon: String, action: @escaping (String) -> Void) -> some View {
        FlowLayout(spacing: 8) {
            ForEach(terms, id: \.self) { term in
                Button {
                    action(term)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: icon).font(.system(size: 11))
                        Text(term).font(.system(size: 13, weight: .medium))
                    }
                    .foregroundStyle(Tokens.fg)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Tokens.tint, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // ── typeahead ──
    @ViewBuilder
    private var suggestView: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let s = suggest {
                ForEach(s.categories) { cat in
                    if let appCat = Categories.bySlug(cat.slug) {
                        NavigationLink(value: appCat) {
                            row(icon: appCat.symbol, tint: appCat.color,
                                title: L10n.tr("in \(cat.name)", "trong \(cat.nameVi)"), subtitle: nil, thumb: nil)
                        }
                        .buttonStyle(.plain)
                    }
                }
                ForEach(s.listings) { l in
                    Button {
                        openListing(l.id)
                    } label: {
                        row(icon: nil, tint: Tokens.brand, title: l.displayTitle,
                            subtitle: "\(Format.vnd(l.price)) · \(l.location)", thumb: l.image)
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    submit(query)
                } label: {
                    row(icon: "magnifyingglass", tint: Tokens.sub,
                        title: L10n.tr("Search \"\(query)\"", "Tìm \"\(query)\""), subtitle: nil, thumb: nil)
                }
                .buttonStyle(.plain)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 32)
            }
        }
        .padding(.vertical, 4)
    }

    private func row(icon: String?, tint: Color, title: String, subtitle: String?, thumb: String?) -> some View {
        HStack(spacing: 12) {
            if let thumb, let url = ImageURL.optimized(thumb, width: 96) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
                }
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                Image(systemName: icon ?? "magnifyingglass")
                    .font(.system(size: 15))
                    .foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Tokens.fg)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Tokens.sub)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
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
