import EnoUI
import SwiftUI

// Native seller storefront (#9) — replaces the WebSheet(/sellers/[id]) redirect.
// Header (avatar, name, business, trust, rating, member-since, bucketed
// responsiveness, bio, location) + top reviews + the seller's active listings.
// Data: GET /api/sellers/[id].
struct SellerStorefrontView: View {
    let sellerId: String

    @State private var data: Storefront?
    @State private var loading = true

    struct Storefront: Codable {
        let seller: Seller
        let listings: [ListingCard]
        let reviews: Reviews
        struct Seller: Codable {
            let id: String
            let name: String
            let avatarUrl: String?
            let avatarColor: String?
            let bio: String?
            let location: String?
            let isBusiness: Bool
            let handle: String?
            let trustScore: Int
            let trustTier: String
            let rating: Double
            let reviewCount: Int
            let memberSinceYear: Int
            let responseLabel: Label?
            struct Label: Codable { let en: String; let vi: String }
        }
        struct Reviews: Codable {
            let reviews: [Review]
            let total: Int
            let avg: Double
            struct Review: Codable, Identifiable {
                let author: String; let rating: Int; let text: String; let verified: Bool; let createdAt: String
                var id: String { author + createdAt }
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let d = data {
                    VStack(alignment: .leading, spacing: 16) {
                        header(d.seller)
                        if !d.reviews.reviews.isEmpty { reviewsBlock(d.reviews) }
                        if !d.listings.isEmpty { listingsGrid(d.listings) }
                    }
                    .padding(16)
                } else if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    // TODO(EnoUI): EnoEmptyState — symbol + title + guidance + one recovery action.
                    Text(L10n.tr("This storefront isn't available.", "Gian hàng này không có sẵn."))
                        .enoText(.subheadline, color: EnoColor.sub).padding(40)
                }
            }
            .background(EnoColor.canvas)
            .navigationTitle(data?.seller.name ?? L10n.tr("Storefront", "Gian hàng"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ListingCard.self) { ListingDetailView(card: $0) }
            .refreshable { await load() }
        }
        .task { await load() }
    }

    private func header(_ s: Storefront.Seller) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                // TODO(EnoUI): EnoAvatar — image → initials fallback at the canon 24/32/40/56 sizes.
                EnoRemoteImage(url: s.avatarUrl.flatMap { ImageURL.optimized($0, width: 160) }) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                    else {
                        Text(String(s.name.prefix(1)).uppercased())
                            .enoText(.title, color: EnoColor.onBrand)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color(hexString: s.avatarColor) ?? EnoColor.brand)
                    }
                }
                .frame(width: 64, height: 64).clipShape(Circle())
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(s.name).font(EnoTextRole.headline.font.weight(.bold)).foregroundStyle(EnoColor.fg)
                        if s.isBusiness { EnoIcon("business", .xs, color: EnoColor.sub) }
                    }
                    HStack(spacing: 8) {
                        TrustMini(score: s.trustScore)
                        if s.reviewCount > 0 {
                            HStack(spacing: 3) {
                                EnoIcon("rating", .xs, color: .yellow)
                                Text("\(s.rating, specifier: "%.1f") (\(s.reviewCount))").enoText(.caption, color: EnoColor.sub)
                            }
                        }
                    }
                }
                Spacer()
            }
            HStack(spacing: 10) {
                Text(L10n.tr("Since \(String(s.memberSinceYear))", "Từ \(String(s.memberSinceYear))"))
                    .enoText(.caption, color: EnoColor.sub)
                if let r = s.responseLabel {
                    Text("· \(L10n.isVi ? r.vi : r.en)").enoText(.caption, color: EnoColor.sub)
                }
                if let loc = s.location, !loc.isEmpty {
                    Text("· \(loc)").enoText(.caption, color: EnoColor.sub)
                }
            }
            if let bio = s.bio, !bio.isEmpty {
                Text(bio).enoText(.subheadline, color: EnoColor.fg).lineSpacing(2)
            }
        }
    }

    private func reviewsBlock(_ r: Storefront.Reviews) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider().overlay(EnoColor.ring)
            Text(L10n.tr("Reviews", "Đánh giá")).font(EnoTextRole.callout.font.weight(.bold)).foregroundStyle(EnoColor.fg)
            ForEach(r.reviews.prefix(3)) { rv in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        ForEach(0..<5) { i in
                            Image(systemName: i < rv.rating ? "star.fill" : "star")
                                .enoIcon(.xs, color: i < rv.rating ? .yellow : EnoColor.ring)
                        }
                        Text(rv.author).font(EnoTextRole.caption.font.weight(.semibold)).foregroundStyle(EnoColor.fg)
                        if rv.verified {
                            Text(L10n.tr("Verified", "Đã xác minh")).enoText(.micro, color: EnoColor.brand)
                        }
                    }
                    if !rv.text.isEmpty { Text(rv.text).enoText(.caption, color: EnoColor.sub) }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func listingsGrid(_ items: [ListingCard]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider().overlay(EnoColor.ring)
            Text(L10n.tr("Listings", "Tin đăng")).font(EnoTextRole.callout.font.weight(.bold)).foregroundStyle(EnoColor.fg)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(items) { card in
                    NavigationLink(value: card) { ListingCardView(listing: card) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private func load() async {
        defer { loading = false }
        data = try? await APIClient.shared.get("api/sellers/\(sellerId)")
    }
}
