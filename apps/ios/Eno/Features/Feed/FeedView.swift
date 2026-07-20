import SwiftUI

// The home surface, mirroring the web landing order (listings-explorer
// isLandingMode): search hero → two-row icon category grid → For-you rail →
// Outstanding-businesses rail → per-category rails → latest-listings grid.
// Native extras the web can't give: system pull-to-refresh + edge-swipe back.
struct FeedView: View {
    @State private var feed = FeedModel()
    @State private var home = HomeModel()
    @State private var aiSheet = false
    @State private var notif = NotifModel.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    header
                    categoryGrid
                    if !home.recentlyViewed.isEmpty {
                        railSection(title: L10n.tr("Recently viewed", "Đã xem gần đây"), items: home.recentlyViewed)
                    }
                    if !home.forYou.isEmpty {
                        railSection(title: L10n.tr("For you", "Dành cho bạn"), items: home.forYou)
                    }
                    if !home.businesses.isEmpty {
                        railSection(title: L10n.tr("Outstanding businesses", "Doanh nghiệp nổi bật"), items: home.businesses)
                    }
                    ForEach(home.rails, id: \.slug) { rail in
                        if let cat = Categories.bySlug(rail.slug), !rail.listings.isEmpty {
                            railSection(title: cat.name, items: rail.listings, seeAll: cat)
                        }
                    }
                    latestHeading
                    grid
                }
            }
            .background(Tokens.canvas)
            .refreshable {
                async let f: Void = feed.reload()
                async let h: Void = home.refresh()
                _ = await (f, h)
            }
            .sheet(isPresented: $aiSheet) {
                WebSheet(path: "/messages/ai")
            }
            .navigationDestination(for: ListingCard.self) { card in
                ListingDetailView(card: card)
            }
            .navigationDestination(for: AppCategory.self) { cat in
                CategoryFeedView(category: cat)
            }
            .toolbar(.hidden, for: .navigationBar)
            .task {
                async let f: Void = feed.start()
                async let h: Void = home.start()
                _ = await (f, h)
                await home.loadRecentlyViewed()
            }
        }
    }

    // ── hero: wordmark + search pill ──
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
            // The web header's ✨ AI-shopping entry (AISearchButton → /messages/ai).
            Button {
                aiSheet = true
            } label: {
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Tokens.brand)
                    .frame(width: 40, height: 40)
                    .background(Tokens.brandTint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
            .buttonStyle(.plain)
            // Notification bell (web header parity) — red dot while unread.
            NavigationLink {
                NotificationsView()
            } label: {
                Image(systemName: "bell")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Tokens.fg)
                    .frame(width: 40, height: 40)
                    .background(Tokens.tint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
                    .overlay(alignment: .topTrailing) {
                        if notif.unread > 0 {
                            Circle().fill(Tokens.danger).frame(width: 9, height: 9).offset(x: -6, y: 6)
                        }
                    }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    // ── two-row horizontally scrolling icon grid (the FINN-style web grid) ──
    private var categoryGrid: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHGrid(rows: [GridItem(.fixed(84), spacing: 4), GridItem(.fixed(84), spacing: 4)], spacing: 4) {
                ForEach(Categories.all) { cat in
                    NavigationLink(value: cat) {
                        // Web parity (FINN-style grid, listings-explorer.tsx): a
                        // monochrome icon + bold label, NO colored tile — every
                        // category uses the one brand identity, not per-category
                        // colors (CATEGORY_COLOR_CLASSES collapses all to brand).
                        VStack(spacing: 6) {
                            Image(systemName: cat.symbol)
                                .font(.system(size: 26, weight: .regular))
                                .foregroundStyle(Tokens.fg)
                                .frame(width: 44, height: 44)
                            Text(cat.name)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Tokens.fg)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                        .frame(width: 92)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
        }
        .frame(height: 176)
        .padding(.bottom, 8)
    }

    // ── horizontal card rail with "See all" ──
    private func railSection(title: String, items: [ListingCard], seeAll: AppCategory? = nil) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Tokens.fg)
                Spacer()
                if let seeAll {
                    NavigationLink(value: seeAll) {
                        HStack(spacing: 2) {
                            Text(L10n.tr("See all", "Xem tất cả")).font(.system(size: 13, weight: .semibold))
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                        }
                        .foregroundStyle(Tokens.brand)
                    }
                }
            }
            .padding(.horizontal, 12)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items) { item in
                        NavigationLink(value: item) {
                            ListingCardView(listing: item)
                                .frame(width: 168)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .padding(.top, 16)
    }

    private var latestHeading: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L10n.tr("Latest listings", "Tin mới nhất"))
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Tokens.fg)
                .padding(.horizontal, 12)
            SortBar(model: feed)
        }
        .padding(.top, 20)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var grid: some View {
        if feed.failed {
            offline
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(feed.items) { item in
                    NavigationLink(value: item) {
                        ListingCardView(listing: item)
                    }
                    .buttonStyle(.plain)
                    .task { await feed.loadMoreIfNeeded(current: item) }
                }
                if feed.items.isEmpty {
                    ForEach(0..<6, id: \.self) { _ in SkeletonCard() }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 16)
        }
    }

    private var offline: some View {
        VStack(spacing: 14) {
            Text(L10n.tr("No internet connection", "Không có kết nối mạng"))
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Tokens.fg)
            Text(L10n.tr("Check your connection and try again.", "Kiểm tra kết nối của bạn rồi thử lại."))
                .font(.system(size: 15))
                .foregroundStyle(Tokens.sub)
            Button(L10n.tr("Try again", "Thử lại")) {
                Task { await feed.reload() }
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 30)
            .frame(height: 48)
            .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
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
