import SwiftUI
import Observation

// A category landing: subcategory facet chips (live counts from the feed
// response) + sort tabs + price filter over the same paged grid — mirroring
// the web's category facet bar.
struct CategoryFeedView: View {
    let category: AppCategory
    @State private var model = FeedModel()
    @State private var showFilter = false
    @State private var subs: [CategoriesResponse.Sub] = []
    @State private var viewMode: ViewMode = .grid
    // Video (#130) is a full-screen takeover, not an inline results arm: tapping the
    // ▷ toggle opens VideoFeedView as a cover and reverts the toggle to the last mode.
    @State private var showVideoCover = false
    @State private var lastMode: ViewMode = .grid
    @State private var webRoute: WebRoute?
    private struct WebRoute: Identifiable { let id = UUID(); let path: String }

    var body: some View {
        ScrollView {
            if !subs.isEmpty { subBar }
            HStack(spacing: 8) {
                SortBar(model: model)
                FilterChip(active: model.hasPriceFilter) { showFilter = true }
                    .padding(.trailing, 12)
            }
            .padding(.top, 8)
            // Count + view toggles (web explorer count row).
            HStack {
                Text(countLabel).font(.system(size: 12)).foregroundStyle(Tokens.sub)
                Spacer()
                ViewToggles(mode: $viewMode)
            }
            .padding(.horizontal, 12)
            .padding(.top, 2)
            resultsView
            if !model.isRefreshing && model.items.isEmpty {
                Text(L10n.tr("Nothing here yet", "Chưa có tin nào"))
                    .font(.system(size: 15))
                    .foregroundStyle(Tokens.sub)
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
            else { lastMode = new }
        }
        .fullScreenCover(isPresented: $showVideoCover) {
            VideoFeedView(filters: model.filterItems, onClose: { showVideoCover = false })
        }
        .task {
            if model.category != category.slug { model.category = category.slug }
            subs = await Taxonomy.shared.subs(for: category.slug)
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
        VStack(spacing: 12) {
            Image(systemName: m.icon).font(.system(size: 40)).foregroundStyle(Tokens.sub)
            Text(L10n.tr(m.label.0, m.label.1)).font(.system(size: 16, weight: .semibold)).foregroundStyle(Tokens.fg)
            Text(L10n.tr("Native view coming soon.", "Bản trong ứng dụng sắp có."))
                .font(.system(size: 13)).foregroundStyle(Tokens.sub)
            Button {
                webRoute = WebRoute(path: "/?view=\(m.rawValue)&category=\(category.slug)")
            } label: {
                Text(L10n.tr("Open on web", "Mở trên web"))
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 20).padding(.vertical, 10)
                    .background(Tokens.brand, in: Capsule())
            }
        }
        .frame(maxWidth: .infinity).padding(.top, 60)
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
        let active = model.subcategory == slug
        return Button {
            model.subcategory = slug
        } label: {
            HStack(spacing: 4) {
                Text(label).font(.system(size: 13, weight: .semibold))
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(active ? Color.white.opacity(0.8) : Tokens.sub)
                }
            }
            .foregroundStyle(active ? Color.white : Tokens.fg)
            .padding(.horizontal, 13)
            .frame(height: 32)
            .background(active ? Tokens.brand : Tokens.tint, in: Capsule())
        }
        .buttonStyle(.plain)
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
