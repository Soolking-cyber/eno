import SwiftUI

// A category landing: the same paged grid, filtered server-side — pushed from
// the icon-grid tiles and each rail's "See all".
struct CategoryFeedView: View {
    let category: AppCategory
    @State private var model = FeedModel()
    @State private var showFilter = false

    var body: some View {
        ScrollView {
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
        }
    }
}
