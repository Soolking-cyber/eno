import SwiftUI

// The home browse surface, mirroring the web homepage's mobile layout: wordmark +
// search field, category chip rail, 2-column card grid. Native niceties the web
// can't give: system pull-to-refresh, edge-swipe back from the PDP, buttery
// LazyVGrid scrolling.
struct FeedView: View {
    @State private var model = FeedModel()

    // Top-level browse chips (canonical slugs; "rentals" is its own category).
    private static let chips: [(slug: String?, en: String, vi: String)] = [
        (nil, "All", "Tất cả"),
        ("electronics", "Electronics", "Điện tử"),
        ("vehicles", "Vehicles", "Xe cộ"),
        ("property", "Property", "Bất động sản"),
        ("rentals", "Rentals", "Cho thuê"),
        ("jobs", "Jobs", "Việc làm"),
        ("services", "Services", "Dịch vụ"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: []) {
                    header
                    chipRail
                    grid
                }
            }
            .background(Tokens.canvas)
            .refreshable { await model.reload() }
            .navigationDestination(for: ListingCard.self) { card in
                ListingDetailView(card: card)
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await model.start() }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("eno")
                .font(.system(size: 26, weight: .heavy))
                .kerning(-1)
                .foregroundStyle(Tokens.brand)
            NavigationLink {
                SearchView()
            } label: {
                HStack {
                    Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold))
                    Text(L10n.tr("Find products…", "Tìm sản phẩm…")).font(.system(size: 15))
                    Spacer()
                }
                .foregroundStyle(Tokens.sub)
                .padding(.horizontal, 14)
                .frame(height: 40)
                .background(Tokens.tint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    private var chipRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.chips, id: \.en) { chip in
                    let active = model.category == chip.slug
                    Button {
                        model.category = chip.slug
                    } label: {
                        Text(L10n.tr(chip.en, chip.vi))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(active ? Color.white : Tokens.fg)
                            .padding(.horizontal, 14)
                            .frame(height: 32)
                            .background(active ? Tokens.brand : Tokens.tint, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private var grid: some View {
        if model.failed {
            offline
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(model.items) { item in
                    NavigationLink(value: item) {
                        ListingCardView(listing: item)
                    }
                    .buttonStyle(.plain)
                    .task { await model.loadMoreIfNeeded(current: item) }
                }
                if model.items.isEmpty {
                    ForEach(0..<6, id: \.self) { _ in SkeletonCard() }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 16)
        }
    }

    private var offline: some View {
        VStack(spacing: 14) {
            Text("e")
                .font(.system(size: 28, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Tokens.brand, in: RoundedRectangle(cornerRadius: 14))
            Text(L10n.tr("No internet connection", "Không có kết nối mạng"))
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Tokens.fg)
            Button(L10n.tr("Try again", "Thử lại")) {
                Task { await model.reload() }
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 30)
            .frame(height: 48)
            .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
        }
        .padding(.top, 80)
    }
}

// Loading placeholder with the card's exact geometry (skeleton-parity rule:
// a skeleton that is shorter than the real card causes layout shift on fill).
struct SkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Tokens.tint.aspectRatio(10 / 11, contentMode: .fit)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 6).fill(Tokens.tint).frame(width: 90, height: 16)
                RoundedRectangle(cornerRadius: 6).fill(Tokens.tint).frame(height: 12)
                RoundedRectangle(cornerRadius: 6).fill(Tokens.tint).frame(width: 60, height: 12)
            }
            .padding(10)
        }
        .background(Tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: Tokens.radiusCard).strokeBorder(Tokens.ring, lineWidth: 1))
    }
}
