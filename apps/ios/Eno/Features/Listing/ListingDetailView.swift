import SwiftUI

// Native PDP v1, mirroring the web page's price-first hierarchy: gallery pager →
// price block → title/meta → description → seller card. Renders instantly from
// the card payload it was tapped with, then hydrates the full detail from
// GET /api/listings/[id]. Chat/offers stay on the web surface for now (auth
// lane pending) — the CTA opens the real listing page in an in-app web sheet.
struct ListingDetailView: View {
    let card: ListingCard
    @State private var detail: ListingDetail?
    @State private var showWeb = false

    private var images: [String] { detail?.images ?? card.images }
    private var title: String { detail?.displayTitle ?? card.displayTitle }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                gallery
                VStack(alignment: .leading, spacing: 12) {
                    priceBlock
                    Text(title)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Tokens.fg)
                    metaRow
                    if let d = detail {
                        Divider().overlay(Tokens.ring)
                        Text(d.description)
                            .font(.system(size: 15))
                            .foregroundStyle(Tokens.fg)
                            .lineSpacing(3)
                        Divider().overlay(Tokens.ring)
                        sellerCard(d.seller)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                    }
                }
                .padding(16)
            }
        }
        .background(Tokens.canvas)
        .safeAreaInset(edge: .bottom) { ctaBar }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if detail == nil {
                detail = (try? await APIClient.shared.get("api/listings/\(card.id)") as ListingDetailEnvelope)?.listing
            }
        }
        .sheet(isPresented: $showWeb) {
            WebSheet(path: "/listings/\(card.id)")
        }
    }

    private var gallery: some View {
        TabView {
            ForEach(images, id: \.self) { raw in
                AsyncImage(url: ImageURL.optimized(raw, width: 1080)) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: Tokens.tint
                    }
                }
            }
        }
        .tabViewStyle(.page)
        .aspectRatio(1, contentMode: .fit)
        .clipped()
        .background(Tokens.tint)
    }

    private var priceBlock: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(Format.vnd(detail?.price ?? card.price))
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Tokens.brand)
            if let prev = detail?.prevPrice ?? card.prevPrice, prev > (detail?.price ?? card.price) {
                Text(Format.vnd(prev))
                    .font(.system(size: 14, weight: .medium))
                    .strikethrough()
                    .foregroundStyle(Tokens.sub)
            }
            if (detail?.urgent ?? card.urgent) {
                Text(L10n.tr("Urgent", "Bán gấp"))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(Tokens.danger, in: Capsule())
            }
        }
    }

    private var metaRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "mappin.and.ellipse").font(.system(size: 12))
            Text(detail?.displayLocation ?? card.displayLocation).font(.system(size: 13))
            Text("·").font(.system(size: 13))
            Text(Format.ago(detail?.postedAt ?? card.postedAt)).font(.system(size: 13))
        }
        .foregroundStyle(Tokens.sub)
    }

    private func sellerCard(_ seller: ListingDetail.DetailSeller) -> some View {
        HStack(spacing: 12) {
            Text(String(seller.name.prefix(1)).uppercased())
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Color(hexString: seller.avatarColor) ?? Tokens.brand, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(seller.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Tokens.fg)
                HStack(spacing: 4) {
                    if seller.isBusiness {
                        Text(L10n.tr("Business", "Doanh nghiệp"))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Tokens.brand)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Tokens.brandTint, in: Capsule())
                    }
                    if let year = Format.date(seller.memberSince).map({ Calendar.current.component(.year, from: $0) }) {
                        Text(L10n.tr("Member since \(String(year))", "Thành viên từ \(String(year))"))
                            .font(.system(size: 12))
                            .foregroundStyle(Tokens.sub)
                    }
                }
            }
            Spacer()
        }
    }

    private var ctaBar: some View {
        Button {
            showWeb = true
        } label: {
            Text(L10n.tr("Contact seller", "Liên hệ người bán"))
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .background(.bar)
    }
}

extension Color {
    // Seller avatarColor arrives as a CSS hex string ("#0A66C2").
    init?(hexString: String?) {
        guard var s = hexString?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
        s.removeFirst()
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}
