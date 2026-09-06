import SwiftUI
import EnoUI
import MapKit

// Native MAP view mode (#129) — a full-screen takeover (like the video feed),
// mirroring the web map: a price-label pin at each listing's coordinates, a bottom
// popup card on tap → the PDP. Coordinates prefer the stored lat/lng, else a
// district centroid + id-hash jitter (Geo.coordinates, ported from geo.ts).
struct ExplorerMapView: View {
    let listings: [ListingCard]
    var onClose: () -> Void
    @State private var selected: ListingCard?
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                // MapKit's native selection binding — a custom .onTapGesture on the
                // Map swallows pin taps (review). Tapping a pin sets `selected` via
                // its .tag; tapping empty map clears it automatically. Cap pins so a
                // huge feed doesn't render hundreds of live SwiftUI annotations.
                Map(position: $camera, selection: $selected) {
                    ForEach(listings.prefix(200)) { l in
                        Annotation("", coordinate: Geo.coordinates(l)) {
                            pricePin(l)
                        }
                        .tag(l)
                    }
                }
                .ignoresSafeArea()

                // Close + count chrome. Both keep their `.regularMaterial` fill: this is
                // FLOATING CHROME over map tiles, the one place the canon allows glass
                // (§1) — an opaque EnoColor/EnoBadge fill would read as content here.
                HStack {
                    // EnoIconButton lifts the tap target 38 → 44pt, so the gutter drops
                    // 14 → 12 to keep the glyph in the same visual spot.
                    EnoIconButton(
                        "xmark",
                        size: 15,
                        color: EnoColor.fg,
                        label: L10n.tr("Close", "Đóng"),
                        action: onClose
                    )
                    .background(.regularMaterial, in: Circle())
                    Spacer()
                    Text(L10n.tr("\(listings.count) on map", "\(listings.count) trên bản đồ"))
                        .enoText(.caption, color: EnoColor.fg)
                        .fontWeight(.semibold)
                        .padding(.horizontal, EnoSpacing.s3).frame(height: 34).background(.regularMaterial, in: Capsule())
                }
                .padding(.horizontal, EnoSpacing.s3).padding(.top, EnoSpacing.s2)

                if let s = selected {
                    VStack {
                        Spacer()
                        popup(s).padding(.horizontal, EnoSpacing.s3).padding(.bottom, EnoSpacing.s4)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .navigationDestination(for: ListingCard.self) { ListingDetailView(card: $0) }
        }
    }

    private func pricePin(_ l: ListingCard) -> some View {
        let sel = selected?.id == l.id
        // The unselected pin fill stays literal white on purpose: it is a paper pin over
        // map tiles in BOTH themes (EnoColor.card would go near-black and disappear into
        // dark tiles). Everything else — ink, ring, shadow, spring — is on token.
        return Text(Format.compactVnd(l.price))
            .enoText(.caption, color: sel ? EnoColor.onBrand : EnoColor.brand)
            .fontWeight(.bold)
            .monospacedDigit()
            .padding(.horizontal, EnoSpacing.s2).padding(.vertical, EnoSpacing.s1)
            .background(sel ? EnoColor.brand : Color.white, in: Capsule())
            .overlay(Capsule().strokeBorder(EnoColor.brand, lineWidth: 1.5))
            .enoElevation(.raised)
            .scaleEffect(sel ? 1.15 : 1)
            .animation(EnoMotion.springSnappy, value: sel)
    }

    private func popup(_ l: ListingCard) -> some View {
        NavigationLink(value: l) {
            // TODO(EnoUI): EnoListRow — leading thumb + title/subtitle + trailing chevron is
            // exactly its contract; adopt it for the row content once the primitive lands.
            // The surface itself is already EnoCard(.floating) — the canon's named use case
            // for this elevation is the map card.
            EnoCard(padding: EnoSpacing.s3, elevation: .floating) {
                HStack(spacing: EnoSpacing.s3) {
                    EnoRemoteImage(url: l.images.first.flatMap { ImageURL.optimized($0, width: 140) }) { phase in
                        if case .success(let img) = phase { img.resizable().scaledToFill() } else { EnoColor.tint }
                    }
                    .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(l.displayTitle).enoText(.callout).fontWeight(.semibold).lineLimit(1)
                        Text(Format.vnd(l.price)).enoText(.headline, color: EnoColor.brand).fontWeight(.bold).monospacedDigit()
                        Text(l.displayLocation).enoText(.caption, color: EnoColor.sub).lineLimit(1)
                    }
                    Spacer()
                    EnoIcon("forward", .sm, color: EnoColor.sub)
                }
            }
        }
        .buttonStyle(.plain)
    }

}
