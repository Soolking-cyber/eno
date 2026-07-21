import SwiftUI
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

                // Close + count chrome.
                HStack {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Tokens.fg)
                            .frame(width: 38, height: 38).background(.regularMaterial, in: Circle())
                    }
                    Spacer()
                    Text(L10n.tr("\(listings.count) on map", "\(listings.count) trên bản đồ"))
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Tokens.fg)
                        .padding(.horizontal, 12).frame(height: 34).background(.regularMaterial, in: Capsule())
                }
                .padding(.horizontal, 14).padding(.top, 8)

                if let s = selected {
                    VStack {
                        Spacer()
                        popup(s).padding(.horizontal, 12).padding(.bottom, 16)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .navigationDestination(for: ListingCard.self) { ListingDetailView(card: $0) }
        }
    }

    private func pricePin(_ l: ListingCard) -> some View {
        let sel = selected?.id == l.id
        return Text(Format.compactVnd(l.price))
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(sel ? .white : Tokens.brand)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(sel ? Tokens.brand : Color.white, in: Capsule())
            .overlay(Capsule().strokeBorder(Tokens.brand, lineWidth: 1.5))
            .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
            .scaleEffect(sel ? 1.15 : 1)
            .animation(.spring(duration: 0.25), value: sel)
    }

    private func popup(_ l: ListingCard) -> some View {
        NavigationLink(value: l) {
            HStack(spacing: 12) {
                AsyncImage(url: l.images.first.flatMap { ImageURL.optimized($0, width: 140) }) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
                }
                .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.displayTitle).font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.fg).lineLimit(1)
                    Text(Format.vnd(l.price)).font(.system(size: 16, weight: .bold)).foregroundStyle(Tokens.brand)
                    Text(l.displayLocation).font(.system(size: 12)).foregroundStyle(Tokens.sub).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Tokens.sub)
            }
            .padding(10)
            .background(Tokens.card, in: RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
        }
        .buttonStyle(.plain)
    }

}
