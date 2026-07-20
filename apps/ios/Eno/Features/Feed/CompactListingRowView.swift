import SwiftUI

// The explorer's "compact" (list) row — web listings-explorer.tsx compact mode,
// mobile variant: thumbnail + title + price/urgent/drop/trust, with the heart as a
// SIBLING button so its tap saves without triggering the row's navigation (web
// stopPropagation). The thumb+text is the nav target → the PDP (where chat lives).
struct CompactListingRowView: View {
    let listing: ListingCard
    @State private var favs = FavoritesStore.shared

    var body: some View {
        HStack(spacing: 8) {
            NavigationLink(value: listing) {
                HStack(spacing: 12) {
                    AsyncImage(url: listing.images.first.flatMap { ImageURL.optimized($0, width: 128) }) { phase in
                        if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
                    }
                    .frame(width: 64, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(listing.displayTitle)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Tokens.fg)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        HStack(spacing: 8) {
                            Text(Format.vnd(listing.price))
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(Tokens.brand)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            if listing.urgent {
                                Image(systemName: "bolt.fill").font(.system(size: 12)).foregroundStyle(Tokens.fg)
                            } else if let pct = listing.dropPercent {
                                Text("-\(pct)%")
                                    .font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                                    .padding(.horizontal, 5).padding(.vertical, 1)
                                    .background(Tokens.danger, in: Capsule())
                            }
                            Spacer(minLength: 4)
                            TrustMini(score: listing.seller.trustScore)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            Button { favs.toggle(listing.id) } label: {
                Image(systemName: favs.isFavorite(listing.id) ? "heart.fill" : "heart")
                    .font(.system(size: 17))
                    .foregroundStyle(favs.isFavorite(listing.id) ? Tokens.brand : Tokens.sub)
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 6)
    }
}

struct CompactSkeletonRow: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 8).fill(Tokens.tint).frame(width: 64, height: 56)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4).fill(Tokens.tint).frame(width: 160, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(Tokens.tint).frame(width: 90, height: 12)
            }
            Spacer()
        }
        .padding(.vertical, 6)
    }
}
