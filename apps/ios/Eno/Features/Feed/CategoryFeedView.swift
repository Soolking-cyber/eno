import SwiftUI
import EnoUI
import Observation

// A category landing: subcategory facet chips (live counts from the feed
// response) + sort tabs + price filter over the same paged grid — mirroring
// the web's category facet bar.
struct CategoryFeedView: View {
    let category: AppCategory
    @State private var model = FeedModel()
    @State private var showFilter = false
    @State private var subs: [CategoriesResponse.Sub] = []
    @State private var facets: [CategoriesResponse.Facet] = []
    @State private var viewMode: ViewMode = .grid
    // Video (#130) is a full-screen takeover, not an inline results arm: tapping the
    // ▷ toggle opens VideoFeedView as a cover and reverts the toggle to the last mode.
    @State private var showVideoCover = false
    @State private var showMapCover = false
    @State private var lastMode: ViewMode = .grid
    @State private var webRoute: WebRoute?
    private struct WebRoute: Identifiable { let id = UUID(); let path: String }

    var body: some View {
        ScrollView {
            // The full cascade (category rail → subcategory 3-row grid → brand rail
            // → model 3-row grid), the same one the home uses — mirrors the web
            // explorer. Replaces the plain subcategory chip bar so the category page
            // is a real drill-down (owner: "3x3 grid for subcats and model").
            QuickFindBar(feed: model)
            HStack(spacing: 8) {
                SortBar(model: model)
                FilterChip(active: model.hasPriceFilter) { showFilter = true }
                    .padding(.trailing, 12)
            }
            .padding(.top, 8)
            // Count + view toggles (web explorer count row).
            HStack {
                Text(countLabel).enoText(.caption, color: EnoColor.sub)
                Spacer()
                ViewToggles(mode: $viewMode)
            }
            .padding(.horizontal, 12)
            .padding(.top, 2)
            appliedChipsBar
            resultsView
            if !model.isRefreshing && model.items.isEmpty {
                Text(L10n.tr("Nothing here yet", "Chưa có tin nào"))
                    .enoText(.label, color: EnoColor.sub)
                    .padding(.top, 40)
            }
        }
        .background(Tokens.canvas)
        .navigationTitle(category.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.reload() }
        .sheet(isPresented: $showFilter) { PriceFilterSheet(model: model) }
        .sheet(item: $webRoute) { r in WebSheet(path: r.path) }
        // ▷ Video → present the TikTok takeover; revert the toggle so closing it lands
        // back on the previous view mode (web prevViewRef).
        .onChange(of: viewMode) { _, new in
            if new == .video { showVideoCover = true; viewMode = lastMode }
            else if new == .map { showMapCover = true; viewMode = lastMode }
            else { lastMode = new }
        }
        .fullScreenCover(isPresented: $showVideoCover) {
            VideoFeedView(filters: model.filterItems, onClose: { showVideoCover = false })
        }
        .fullScreenCover(isPresented: $showMapCover) {
            ExplorerMapView(listings: model.items, onClose: { showMapCover = false })
        }
        .task {
            if model.category != category.slug { model.category = category.slug }
            let cat = await Taxonomy.shared.category(for: category.slug)
            subs = cat?.subcategories ?? []
            facets = cat?.facets ?? []
        }
    }

    private var countLabel: String {
        let n = model.totalCount ?? model.items.count
        return L10n.tr("\(n) listings", "\(n) tin đăng")
    }

    // Results per view mode. compact + grid are native; map (#129) + video (#130)
    // are placeholders the owning sessions replace with native inline views.
    @ViewBuilder
    private var resultsView: some View {
        switch viewMode {
        case .grid:
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(model.items) { item in
                    NavigationLink(value: item) { ListingCardView(listing: item) }
                        .buttonStyle(.plain)
                        .task { await model.loadMoreIfNeeded(current: item) }
                }
                if model.items.isEmpty && model.isRefreshing {
                    ForEach(0..<6, id: \.self) { _ in SkeletonCard() }
                }
            }
            .padding(12)
        case .compact:
            LazyVStack(spacing: 0) {
                ForEach(model.items) { item in
                    CompactListingRowView(listing: item)
                        .task { await model.loadMoreIfNeeded(current: item) }
                    Divider().opacity(0.5)
                }
                if model.items.isEmpty && model.isRefreshing {
                    ForEach(0..<8, id: \.self) { _ in CompactSkeletonRow() }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)
        case .map, .video:
            modePlaceholder(viewMode)
        }
    }

    private func modePlaceholder(_ m: ViewMode) -> some View {
        VStack(spacing: EnoSpacing.s3) {
            Image(systemName: m.icon).enoIcon(.xl, color: EnoColor.sub)
            Text(L10n.tr(m.label.0, m.label.1)).enoText(.headline)
            Text(L10n.tr("Native view coming soon.", "Bản trong ứng dụng sắp có."))
                .enoText(.caption, color: EnoColor.sub)
            EnoButton(L10n.tr("Open on web", "Mở trên web"), size: .compact, fullWidth: false) {
                webRoute = WebRoute(path: "/?view=\(m.rawValue)&category=\(category.slug)")
            }
        }
        .frame(maxWidth: .infinity).padding(.top, 60)
    }

    // Applied-filter chips (web explorer active-filter row): each removes its own
    // filter live; "Clear all" resets them. Surfaces the price / condition / facet
    // filters set in the sheet, which are otherwise invisible once it closes.
    @ViewBuilder
    private var appliedChipsBar: some View {
        let chips = activeFilterChips
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips) { chip in
                        EnoChip(chip.label, trailingIcon: "xmark", action: chip.clear)
                            .accessibilityLabel(L10n.tr("Remove filter", "Bỏ bộ lọc") + ": \(chip.label)")
                    }
                    if chips.count > 1 {
                        EnoButton(L10n.tr("Clear all", "Xóa tất cả"), variant: .text, size: .compact, fullWidth: false) {
                            model.priceMin = nil; model.priceMax = nil
                            model.condition = nil; model.customFilters = [:]
                        }
                    }
                }
                .padding(.horizontal, 12)
            }
            .padding(.top, 8)
        }
    }

    private struct FilterChipModel: Identifiable {
        let id: String
        let label: String
        let clear: () -> Void
    }

    private var activeFilterChips: [FilterChipModel] {
        var chips: [FilterChipModel] = []
        if model.priceMin != nil || model.priceMax != nil {
            let label: String
            if let lo = model.priceMin, let hi = model.priceMax { label = "\(Format.vnd(lo)) – \(Format.vnd(hi))" }
            else if let lo = model.priceMin { label = "≥ \(Format.vnd(lo))" }
            else if let hi = model.priceMax { label = "≤ \(Format.vnd(hi))" }
            else { label = "" }
            chips.append(FilterChipModel(id: "price", label: label) { model.priceMin = nil; model.priceMax = nil })
        }
        if let c = model.condition {
            chips.append(FilterChipModel(id: "condition", label: c == "new" ? L10n.tr("New", "Mới") : L10n.tr("Used", "Đã dùng")) { model.condition = nil })
        }
        for (k, v) in model.customFilters.sorted(by: { $0.key < $1.key }) {
            chips.append(FilterChipModel(id: k, label: facetChipLabel(key: k, value: v)) { model.customFilters[k] = nil })
        }
        return chips
    }

    // Human label for an attr_/range_ customFilter, resolved via the loaded facets.
    private func facetChipLabel(key: String, value: String) -> String {
        if key.hasPrefix("attr_") {
            let fk = String(key.dropFirst(5))
            if let f = facets.first(where: { $0.key == fk }) {
                let opt = f.options.first(where: { $0.value == value })?.displayName ?? value
                return "\(f.displayLabel): \(opt)"
            }
            return value
        }
        if key.hasPrefix("range_") {
            let col = String(key.dropFirst(6))
            let f = facets.first(where: { $0.range?.column == col })
            let parts = value.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            let lo = parts.first ?? "", hi = parts.count > 1 ? parts[1] : ""
            let unit = f?.range?.unit.map { " \($0)" } ?? ""
            let range = lo.isEmpty ? "≤ \(hi)\(unit)" : hi.isEmpty ? "≥ \(lo)\(unit)" : "\(lo)–\(hi)\(unit)"
            return f.map { "\($0.displayLabel): \(range)" } ?? range
        }
        return value
    }

    // "All · Motorbike (12) · Bicycle (4) · …" — counts from subcategoryCounts.
    private var subBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                subChip(label: L10n.tr("All", "Tất cả"), slug: nil, count: nil)
                ForEach(subs) { sub in
                    subChip(label: sub.displayName, slug: sub.slug, count: model.subcategoryCounts[sub.slug])
                }
            }
            .padding(.horizontal, 12)
        }
        .padding(.top, 10)
    }

    private func subChip(label: String, slug: String?, count: Int?) -> some View {
        EnoChip(label, selected: model.subcategory == slug, count: count) {
            model.subcategory = slug
        }
    }
}

// One cached taxonomy fetch per app run (/api/categories, CDN-held server-side).
@MainActor
final class Taxonomy {
    static let shared = Taxonomy()
    private var cats: [CategoriesResponse.Cat]?

    func subs(for slug: String) async -> [CategoriesResponse.Sub] {
        await category(for: slug)?.subcategories ?? []
    }

    /// Full category meta (subcategories + post-wizard types/brandable/facets).
    func category(for slug: String) async -> CategoriesResponse.Cat? {
        if cats == nil {
            cats = (try? await APIClient.shared.get("api/categories") as CategoriesResponse)?.categories
        }
        return cats?.first { $0.slug == slug }
    }
}
