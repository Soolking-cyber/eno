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
                Map(position: $camera) {
                    ForEach(listings) { l in
                        Annotation("", coordinate: Geo.coordinates(l)) {
                            pricePin(l)
                        }
                    }
                }
                .ignoresSafeArea()
                .onTapGesture { withAnimation(.spring(duration: 0.2)) { selected = nil } }

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
        return Text(compact(l.price))
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(sel ? .white : Tokens.brand)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(sel ? Tokens.brand : Color.white, in: Capsule())
            .overlay(Capsule().strokeBorder(Tokens.brand, lineWidth: 1.5))
            .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
            .scaleEffect(sel ? 1.15 : 1)
            .onTapGesture { withAnimation(.spring(duration: 0.25)) { selected = l } }
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

    // Compact price for map pins (VN scale: k / tr / tỷ).
    private func compact(_ price: Int) -> String {
        if price >= 1_000_000_000 { return String(format: "%.1ftỷ", Double(price) / 1_000_000_000) }
        if price >= 1_000_000 { return "\(price / 1_000_000)tr" }
        if price >= 1_000 { return "\(price / 1_000)k" }
        return "\(price)"
    }
}
