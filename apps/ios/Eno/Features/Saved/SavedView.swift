import SwiftUI
import EnoUI

// The Saved tab, native: hydrates the device-local favorite ids through the
// /api/listings?ids= fast path (order-preserving; only live listings return —
// missing ids self-heal out of the store, mirroring favorites-context.tsx).
// No auth involved: favorites are device-local for guests AND members.
struct SavedView: View {
    @State private var favs = FavoritesStore.shared
    @State private var listings: [ListingCard] = []
    @State private var loaded = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if favs.ids.isEmpty {
                    empty
                } else if failed && listings.isEmpty {
                    errorState
                } else {
                    if loaded {
                        Text(savedCountLabel)
                            .enoText(.caption, color: EnoColor.sub)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.top, 8)
                    }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        ForEach(listings) { item in
                            NavigationLink(value: item) {
                                ListingCardView(listing: item)
                            }
                            .buttonStyle(.plain)
                        }
                        if !loaded {
                            ForEach(0..<min(max(favs.count, 2), 24), id: \.self) { _ in SkeletonCard() }
                        }
                    }
                    .padding(12)
                }
            }
            .background(EnoColor.canvas)
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
        guard !requested.isEmpty else { listings = []; loaded = true; failed = false; return }
        failed = false
        guard let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [
            URLQueryItem(name: "ids", value: requested.joined(separator: ",")),
        ]) else { loaded = true; failed = true; return }
        listings = page.listings
        loaded = true
        failed = false
        favs.prune(requested: requested, returned: Set(page.listings.map(\.id)))
    }

    // NOTE: these two are the EnoEmptyState / EnoPageState shape — swap them onto that
    // primitive when Kyle's lane ships it; the tokens below are already canon.
    private var empty: some View {
        VStack(spacing: EnoSpacing.s3) {
            Image(systemName: "heart")
                .enoIcon(.xl, color: EnoColor.sub)
            Text(L10n.tr("Nothing saved yet", "Chưa lưu tin nào"))
                .enoText(.headline)
            Text(L10n.tr("Tap the heart on any listing to keep it here.", "Nhấn trái tim trên tin đăng để lưu lại đây."))
                .enoText(.callout, color: EnoColor.sub)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 100)
    }

    private var errorState: some View {
        VStack(spacing: EnoSpacing.s3) {
            Image(systemName: "wifi.slash")
                .enoIcon(.xl, color: EnoColor.sub)
            Text(L10n.tr("Couldn't load listings.", "Không tải được tin đăng."))
                .enoText(.label)
            EnoButton(L10n.tr("Try again", "Thử lại"), size: .compact, fullWidth: false) {
                Task { await load() }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 100)
    }

    private var savedCountLabel: String {
        let n = listings.count
        return L10n.tr("\(n) saved \(n == 1 ? "listing" : "listings")", "\(n) tin đã lưu")
    }
}
