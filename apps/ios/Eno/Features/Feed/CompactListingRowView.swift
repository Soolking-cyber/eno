import SwiftUI
import EnoUI

// The explorer's "compact" (list) row — web listings-explorer.tsx compact mode,
// mobile variant: thumbnail + title + price/urgent/drop/trust, with the heart as a
// SIBLING button so its tap saves without triggering the row's navigation (web
// stopPropagation). The thumb+text is the nav target → the PDP (where chat lives).
struct CompactListingRowView: View {
    let listing: ListingCard
    @State private var favs = FavoritesStore.shared

    var body: some View {
        HStack(spacing: EnoSpacing.s2) {
            NavigationLink(value: listing) {
                HStack(spacing: EnoSpacing.s3) {
                    AsyncImage(url: listing.images.first.flatMap { ImageURL.optimized($0, width: 128) }) { phase in
                        if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
                    }
                    .frame(width: 64, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(listing.displayTitle)
                            .enoText(.callout)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        HStack(spacing: EnoSpacing.s2) {
                            Text(Format.vnd(listing.price))
                                .enoText(.headline, color: EnoColor.brand)
                                .fontWeight(.bold)
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            if listing.urgent {
                                Image(systemName: "bolt.fill").enoText(.caption)
                            } else if let pct = listing.dropPercent {
                                // On a surface (not over a photo) → EnoBadge, not EnoOverlayChip.
                                EnoBadge("-\(pct)%", kind: .danger)
                            }
                            Spacer(minLength: 4)
                            TrustMini(score: listing.seller.trustScore)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            EnoIconButton(
                favs.isFavorite(listing.id) ? "heart.fill" : "heart",
                size: 17,
                color: favs.isFavorite(listing.id) ? EnoColor.brand : EnoColor.sub,
                label: favs.isFavorite(listing.id) ? L10n.tr("Saved", "Đã lưu") : L10n.tr("Save", "Lưu")
            ) {
                favs.toggle(listing.id)
            }
        }
        .padding(.vertical, EnoSpacing.s1 + 2)
    }
}

struct CompactSkeletonRow: View {
    var body: some View {
        HStack(spacing: EnoSpacing.s3) {
            RoundedRectangle(cornerRadius: EnoRadius.chip).fill(Tokens.tint).frame(width: 64, height: 56)
            VStack(alignment: .leading, spacing: EnoSpacing.s1 + 2) {
                RoundedRectangle(cornerRadius: EnoRadius.chip).fill(Tokens.tint).frame(width: 160, height: 12)
                RoundedRectangle(cornerRadius: EnoRadius.chip).fill(Tokens.tint).frame(width: 90, height: 12)
            }
            Spacer()
        }
        .padding(.vertical, EnoSpacing.s1 + 2)
    }
}
