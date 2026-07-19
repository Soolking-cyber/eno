import SwiftUI

// Native search: q → /api/listings (accent-folded searchText + pg_trgm on the
// server, identical results to the web). Debounce keeps typing cheap.
struct SearchView: View {
    @State private var query = ""
    @State private var results: [ListingCard] = []
    @State private var searching = false
    @State private var task: Task<Void, Never>?

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(results) { item in
                    NavigationLink(value: item) {
                        ListingCardView(listing: item)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
            if searching { ProgressView().padding(.top, 24) }
            if !searching && results.isEmpty && query.count >= 2 {
                Text(L10n.tr("No results for \"\(query)\"", "Không tìm thấy \"\(query)\""))
                    .font(.system(size: 15))
                    .foregroundStyle(Tokens.sub)
                    .padding(.top, 32)
            }
        }
        .background(Tokens.canvas)
        .navigationTitle(L10n.tr("Search", "Tìm kiếm"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: L10n.tr("Find products…", "Tìm sản phẩm…"))
        .onChange(of: query) {
            task?.cancel()
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; return }
            task = Task {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                searching = true
                defer { searching = false }
                if let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [
                    URLQueryItem(name: "q", value: q),
                    URLQueryItem(name: "limit", value: "24"),
                ]) {
                    guard !Task.isCancelled else { return }
                    results = page.listings
                }
            }
        }
    }
}
