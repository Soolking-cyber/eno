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

    var body: some View {
        ScrollView {
            if !subs.isEmpty { subBar }
            HStack(spacing: 8) {
                SortBar(model: model)
                FilterChip(active: model.hasPriceFilter) { showFilter = true }
                    .padding(.trailing, 12)
            }
            .padding(.top, 8)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(model.items) { item in
                    NavigationLink(value: item) {
                        ListingCardView(listing: item)
                    }
                    .buttonStyle(.plain)
                    .task { await model.loadMoreIfNeeded(current: item) }
                }
                if model.items.isEmpty && model.isRefreshing {
                    ForEach(0..<6, id: \.self) { _ in SkeletonCard() }
                }
            }
            .padding(12)
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
        .task {
            if model.category != category.slug { model.category = category.slug }
            subs = await Taxonomy.shared.subs(for: category.slug)
        }
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
