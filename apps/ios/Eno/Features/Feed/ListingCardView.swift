import SwiftUI
import EnoUI

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
        // Web parity (listing-card.tsx): the card OUTER is borderless + bg-less —
        // only the IMAGE is rounded. Text runs nearly full-width under the image
        // (px-0.5 pt-2.5), no 10px inset, no card panel.
        VStack(alignment: .leading, spacing: 0) {
            photo
            VStack(alignment: .leading, spacing: 2) {
                priceRow
                LocalizedText(source: listing.title, preferred: L10n.isVi ? listing.titleVi : nil)
                    .enoText(.callout)
                    .multilineTextAlignment(.leading)
                    // reservesSpace keeps a 1-line and a 2-line title the SAME height
                    // (symmetric grid) while still GROWING with Dynamic Type — the fixed
                    // 36pt frame this replaces clipped the second line at accessibility sizes.
                    .lineLimit(2, reservesSpace: true)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                metaRow
            }
            .padding(.horizontal, 2)
            .padding(.top, 10)
        }
        // Cards live in a fixed 2-col grid, so cap text growth (audit #12) — the PDP
        // (a scroll view) scales unclamped for full accessibility.
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    // ── image + overlay chips ──
    private var photo: some View {
        // Canonical fixed-aspect image: a Color sets the exact 10:11 box, the image
        // fills it via an overlay + scaledToFill, and clipShape trims the overflow.
        // Replaces a GeometryReader, which sizes reliably for the placeholder but
        // can let a LOADED image drive the height (uneven cards) on device.
        Tokens.tint
            .aspectRatio(10 / 11, contentMode: .fit)
            .overlay {
                AsyncImage(url: listing.images.first.flatMap { ImageURL.optimized($0) }) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Tokens.tint
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: EnoRadius.control))   // image is its own rounded-xl (web)
            .overlay(alignment: .topLeading) { topBadge.padding(8) }
            // padding 2 (not 8): EnoIconButton carries its own 44pt target, so the glyph
            // lands in the same visual spot the old 34pt frame + 8pt inset did.
            .overlay(alignment: .topTrailing) { heart.padding(2) }
            .overlay(alignment: .bottomLeading) { bottomChips.padding(8) }
    }

    // Web parity: a bare 22px heart (NO circular background), white with a legibility
    // shadow at rest, brand-filled when saved. EnoIconButton also lifts the tap target
    // from 34pt (below the 44pt minimum) to a compliant 44.
    private var heart: some View {
        let saved = favs.isFavorite(listing.id)
        return EnoIconButton(
            saved ? "heart.fill" : "heart",
            size: 22,
            color: saved ? EnoColor.brand : .white,
            variant: .onImage,
            label: saved ? L10n.tr("Saved", "Đã lưu") : L10n.tr("Save", "Lưu")
        ) {
            favs.toggle(listing.id)
        }
    }

    // Cover badges — priority urgent → -N% drop → New(48h). EnoOverlayChip (not EnoBadge):
    // these sit ON the photo, so they need opaque/scrim fills to stay legible.
    @ViewBuilder
    private var topBadge: some View {
        if listing.urgent {
            EnoOverlayChip(L10n.tr("Urgent", "Bán gấp"), icon: "bolt.fill", kind: .ink)
        } else if let pct = listing.dropPercent {
            EnoOverlayChip("-\(pct)%", kind: .danger)
        } else if listing.isNew {
            EnoOverlayChip(L10n.tr("New", "Mới"), kind: .inkMuted)
        }
    }

    @ViewBuilder
    private var bottomChips: some View {
        HStack(spacing: 4) {
            if listing.video != nil {
                EnoOverlayChip(icon: "play.fill", kind: .scrim)
            }
            if savedTotal >= 3 {
                EnoOverlayChip("\(savedTotal)", icon: "heart.fill", kind: .scrim)
            }
        }
    }

    // ── price ──
    private var priceRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(Format.compactVnd(listing.price))
                .enoText(.headline, color: EnoColor.brand)
                .fontWeight(.bold)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            // The struck "was" (live only inside the 3-day drop window) and the ≈USD
            // are INDEPENDENT — a discounted card still shows its USD value (they used
            // to be either/or, so any drop hid the USD). After the drop window the
            // server drops prevPrice and it reads as a normal price + USD.
            if let prev = listing.prevPrice, prev > listing.price {
                Text(Format.compactVnd(prev))
                    .enoText(.caption, color: EnoColor.ink4)
                    .strikethrough()
                    .monospacedDigit()
                    .lineLimit(1)
            }
            if AppSettings.shared.showUSD, let approx = fx.approxUSD(listing.price) {
                Text(approx)
                    .enoText(.caption, color: EnoColor.sub)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            if listing.goodPrice == true && listing.dropPercent == nil {
                EnoBadge(L10n.tr("Good price", "Giá tốt"), kind: .success)
            }
        }
    }

    // ── meta: location · brand · model + business glyph + trust shield ──
    private var metaRow: some View {
        HStack(spacing: 6) {
            Text(listing.brandModelLine)
                .enoText(.caption, color: EnoColor.sub)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 2)
            if listing.seller.isBusiness {
                Image(systemName: "building.2")
                    .enoText(.caption, color: EnoColor.sub)
            }
            TrustMini(score: listing.seller.trustScore)
        }
    }
}

// The card's trust shield chip (trust-score.tsx variant='mini'): shield glyph +
// Trust ladder chip (web trust-score.tsx). Thresholds match src/lib/trust-score.ts
// (60/85/110/160). The EARNED tiers (Trusted/Exceptional/Elite) carry the vivid
// glossy gradient FILL from globals.css .trust-fill-*; Building/Restricted stay a
// quiet currentColor tint. onTap (optional) opens the /trust explainer — PDP/chat
// pass it; cards leave it nil so the card itself owns the tap.
struct TrustMini: View {
    let score: Int
    var onTap: (() -> Void)? = nil

    private enum Tier { case elite, exceptional, trusted, standard, restricted }
    private var tier: Tier {
        if score >= 160 { return .elite }
        if score >= 110 { return .exceptional }
        if score >= 85 { return .trusted }
        if score >= 60 { return .standard }
        return .restricted
    }

    private func hex(_ v: UInt32) -> Color {
        Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
    private var fill: [Color]? {
        switch tier {
        case .elite: return [hex(0x7C3AED), hex(0x6D28D9), hex(0x5B21B6)]
        case .exceptional: return [hex(0xFDE047), hex(0xFACC15), hex(0xF59E0B)]
        case .trusted: return [hex(0x3B82F6), hex(0x2563EB), hex(0x1D4ED8)]
        default: return nil
        }
    }
    private var quiet: Color { tier == .restricted ? Tokens.danger : Tokens.sub }
    private var onFill: Color { tier == .exceptional ? hex(0x713F12) : .white }
    private var bgStyle: AnyShapeStyle {
        if let fill { return AnyShapeStyle(LinearGradient(colors: fill, startPoint: .topLeading, endPoint: .bottomTrailing)) }
        return AnyShapeStyle(quiet.opacity(0.12))
    }

    var body: some View {
        let chip = HStack(spacing: 4) {
            Image(systemName: "shield").font(EnoTextRole.micro.font)   // web: OUTLINE shield, not filled
            Text("\(score)").font(EnoTextRole.micro.font).monospacedDigit()
        }
        .lineLimit(1)
        .fixedSize()            // the score must never wrap to "10⏎0" at large Dynamic Type
        .foregroundStyle(fill != nil ? onFill : quiet)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(bgStyle, in: Capsule())

        if let onTap {
            Button(action: onTap) { chip }.buttonStyle(.plain)
        } else {
            chip
        }
    }
}
