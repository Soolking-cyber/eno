import SwiftUI

// Native mirror of the web <ListingCard> + card-badges.tsx, matched to their
// exact rules: top-left chip priority urgent → -N% drop → New(48h); bottom-left
// video/saved chips (saved shown only at ≥3); goodPrice yields to a live drop;
// price row = VND + "≈ $" approximation; meta = location · brand · model with
// the business glyph and the trust mini-shield.
struct ListingCardView: View {
    let listing: ListingCard
    var fx: Fx = .shared
    @State private var favs = FavoritesStore.shared

    // Landmine (web parity): displayed saves = server base + session delta,
    // floored — never derived from the favorited flag.
    private var savedTotal: Int { max(0, listing.savedCount + favs.delta(listing.id)) }

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
                metaRow
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

    // ── image + overlay chips ──
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
        .overlay(alignment: .topLeading) { topBadge.padding(8) }
        .overlay(alignment: .topTrailing) { heart.padding(8) }
        .overlay(alignment: .bottomLeading) { bottomChips.padding(8) }
    }

    private var heart: some View {
        Button {
            favs.toggle(listing.id)
        } label: {
            Image(systemName: favs.isFavorite(listing.id) ? "heart.fill" : "heart")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(favs.isFavorite(listing.id) ? Tokens.brand : .white)
                .frame(width: 30, height: 30)
                .background(.black.opacity(favs.isFavorite(listing.id) ? 0.0 : 0.25), in: Circle())
                .background(favs.isFavorite(listing.id) ? AnyShapeStyle(.white) : AnyShapeStyle(.clear), in: Circle())
                .shadow(color: .black.opacity(0.15), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var topBadge: some View {
        if listing.urgent {
            chip(icon: "bolt.fill", text: L10n.tr("Urgent", "Bán gấp"), bg: Tokens.fg, fg: Tokens.card)
        } else if let pct = listing.dropPercent {
            chip(icon: nil, text: "-\(pct)%", bg: Tokens.danger, fg: .white)
        } else if listing.isNew {
            chip(icon: nil, text: L10n.tr("New", "Mới"), bg: Tokens.fg.opacity(0.85), fg: Tokens.card)
        }
    }

    @ViewBuilder
    private var bottomChips: some View {
        HStack(spacing: 4) {
            if listing.video != nil {
                Image(systemName: "play.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(5)
                    .background(.black.opacity(0.55), in: Capsule())
            }
            if savedTotal >= 3 {
                HStack(spacing: 3) {
                    Image(systemName: "heart.fill").font(.system(size: 9))
                    Text("\(savedTotal)").font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(.black.opacity(0.55), in: Capsule())
            }
        }
    }

    private func chip(icon: String?, text: String, bg: Color, fg: Color) -> some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text).font(.system(size: 10, weight: .bold))
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(bg, in: Capsule())
    }

    // ── price ──
    private var priceRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(Format.vnd(listing.price))
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Tokens.brand)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let prev = listing.prevPrice, prev > listing.price {
                Text(Format.vnd(prev))
                    .font(.system(size: 11, weight: .medium))
                    .strikethrough()
                    .foregroundStyle(Tokens.sub)
                    .lineLimit(1)
            } else if let approx = fx.approxUSD(listing.price) {
                Text(approx)
                    .font(.system(size: 12))
                    .foregroundStyle(Tokens.sub)
                    .lineLimit(1)
            }
            if listing.goodPrice && listing.dropPercent == nil {
                Text(L10n.tr("Good price", "Giá tốt"))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.green)
            }
        }
    }

    // ── meta: location · brand · model + business glyph + trust shield ──
    private var metaRow: some View {
        HStack(spacing: 4) {
            Text(listing.brandModelLine)
                .font(.system(size: 11))
                .foregroundStyle(Tokens.sub)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 2)
            if listing.seller.isBusiness {
                Image(systemName: "building.2")
                    .font(.system(size: 10))
                    .foregroundStyle(Tokens.sub)
            }
            TrustMini(score: listing.seller.trustScore)
        }
    }
}

// The card's trust shield chip (trust-score.tsx variant='mini'): shield glyph +
// rounded score, colored by band — exceptional ≥110 gold, trusted ≥85 blue,
// standard ≥60 quiet slate, below = red. Always rendered, no threshold.
struct TrustMini: View {
    let score: Int

    private var band: Color {
        if score >= 110 { return Color(red: 0.72, green: 0.53, blue: 0.04) }
        if score >= 85 { return Tokens.brand }
        if score >= 60 { return Tokens.sub }
        return Tokens.danger
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "shield.fill").font(.system(size: 9))
            Text("\(score)").font(.system(size: 10, weight: .bold))
        }
        .foregroundStyle(band)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(band.opacity(0.12), in: Capsule())
    }
}
