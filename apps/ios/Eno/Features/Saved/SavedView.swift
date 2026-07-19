import SwiftUI

// The Saved tab, native: hydrates the device-local favorite ids through the
// /api/listings?ids= fast path (order-preserving; only live listings return —
// missing ids self-heal out of the store, mirroring favorites-context.tsx).
// No auth involved: favorites are device-local for guests AND members.
struct SavedView: View {
    @State private var favs = FavoritesStore.shared
    @State private var listings: [ListingCard] = []
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if favs.ids.isEmpty {
                    empty
                } else {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        ForEach(listings) { item in
                            NavigationLink(value: item) {
                                ListingCardView(listing: item)
                            }
                            .buttonStyle(.plain)
                        }
                        if !loaded {
                            ForEach(0..<min(max(favs.count, 2), 6), id: \.self) { _ in SkeletonCard() }
                        }
                    }
                    .padding(12)
                }
            }
            .background(Tokens.canvas)
            .navigationTitle(L10n.tr("Saved", "Đã lưu"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ListingCard.self) { card in
                ListingDetailView(card: card)
            }
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: favs.ids) { Task { await load() } }
        }
    }

    private func load() async {
        let requested = favs.ids
        guard !requested.isEmpty else { listings = []; loaded = true; return }
        guard let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [
            URLQueryItem(name: "ids", value: requested.joined(separator: ",")),
        ]) else { return }
        listings = page.listings
        loaded = true
        favs.prune(requested: requested, returned: Set(page.listings.map(\.id)))
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Image(systemName: "heart")
                .font(.system(size: 40))
                .foregroundStyle(Tokens.sub)
            Text(L10n.tr("Nothing saved yet", "Chưa lưu tin nào"))
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Tokens.fg)
            Text(L10n.tr("Tap the heart on any listing to keep it here.", "Nhấn trái tim trên tin đăng để lưu lại đây."))
                .font(.system(size: 14))
                .foregroundStyle(Tokens.sub)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 100)
    }
}
