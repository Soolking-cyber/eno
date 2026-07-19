import SwiftUI

// Native mirror of the web <ListingCard>: 10/11 photo, brand price, 2-line
// title, sub location, urgent / price-drop accents. Same tokens, same layout.
struct ListingCardView: View {
    let listing: ListingCard

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            photo
            VStack(alignment: .leading, spacing: 4) {
                priceRow
                Text(listing.displayTitle)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Tokens.fg)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(minHeight: 36, alignment: .topLeading)
                if !listing.displayLocation.isEmpty {
                    Text(listing.displayLocation)
                        .font(.system(size: 11))
                        .foregroundStyle(Tokens.sub)
                        .lineLimit(1)
                }
            }
            .padding(10)
        }
        .background(Tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.radiusCard))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.radiusCard)
                .strokeBorder(Tokens.ring, lineWidth: 1)
        )
    }

    private var photo: some View {
        GeometryReader { geo in
            AsyncImage(url: listing.images.first.flatMap { ImageURL.optimized($0) }) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Tokens.tint
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .aspectRatio(10 / 11, contentMode: .fit)
        .overlay(alignment: .topLeading) {
            if listing.urgent {
                Text(L10n.tr("Urgent", "Bán gấp"))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Tokens.danger, in: Capsule())
                    .padding(8)
            }
        }
    }

    private var priceRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(Format.vnd(listing.price))
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Tokens.brand)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            if let prev = listing.prevPrice, prev > listing.price {
                Text(Format.vnd(prev))
                    .font(.system(size: 11, weight: .medium))
                    .strikethrough()
                    .foregroundStyle(Tokens.sub)
                    .lineLimit(1)
            }
        }
    }
}
