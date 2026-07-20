import SwiftUI

// The home surface, mirroring the web landing order (listings-explorer
// isLandingMode): search hero → two-row icon category grid → For-you rail →
// Outstanding-businesses rail → per-category rails → latest-listings grid.
// Native extras the web can't give: system pull-to-refresh + edge-swipe back.
struct FeedView: View {
    @State private var feed = FeedModel()
    @State private var home = HomeModel()
    @State private var aiSheet = false
    @State private var mapSheet = false
    @State private var notif = NotifModel.shared
    @State private var router = DeepLinkRouter.shared

    // Landing = no facet/search active → show the discovery rails; else the
    // quick-find selection filters the grid in place.
    private var isLanding: Bool {
        feed.category == nil && feed.brand == nil && (feed.query ?? "").isEmpty
    }

    var body: some View {
        // Bound to the router so deep links / notification taps push onto this stack
        // (audit #3); manual card taps append to the same path.
        NavigationStack(path: $router.explorePath) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    header
                    // Web-parity landing (src/app/(home)): the home has NO persistent
                    // category tabs — it shows the search hero + "Popular" chips + the
                    // discovery rails. The QuickFind facet cascade appears only once
                    // you're inside a category (like the web's FacetBar).
                    if isLanding {
                        categoryGrid
                        if !home.recentlyViewed.isEmpty {
                            railSection(icon: "clock.arrow.circlepath", title: L10n.tr("Recently viewed", "Đã xem gần đây"), items: home.recentlyViewed)
                        }
                        if !home.forYou.isEmpty {
                            // Web for-you-rail default (guest / no personalization): "Trending now".
                            railSection(icon: "chart.line.uptrend.xyaxis", title: L10n.tr("Trending now", "Đang thịnh hành"), items: home.forYou)
                        }
                        if !home.businesses.isEmpty {
                            railSection(icon: "rosette", title: L10n.tr("Outstanding businesses", "Doanh nghiệp nổi bật"), items: home.businesses)
                        }
                        ForEach(home.rails, id: \.slug) { rail in
                            if let cat = Categories.bySlug(rail.slug), !rail.listings.isEmpty {
                                railSection(icon: cat.symbol, title: cat.name, items: rail.listings, seeAll: cat)
                            }
                        }
                    } else {
                        QuickFindBar(feed: feed)
                            .padding(.top, 4)
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
            .sheet(isPresented: $mapSheet) {
                WebSheet(path: "/?view=map")
            }
            .navigationDestination(for: ListingCard.self) { card in
                ListingDetailView(card: card)
            }
            .navigationDestination(for: AppCategory.self) { cat in
                CategoryFeedView(category: cat)
            }
            // Deep-link routes (audit #3): listing → native loader; category/brand →
            // the real web page embedded in native chrome (no native brand screen yet).
            .navigationDestination(for: DeepLinkRouter.Route.self) { route in
                switch route {
                case .listing(let id): ListingLoaderView(id: id)
                case .category(let slug): WebTabView(path: "/c/\(slug)", title: L10n.tr("Category", "Danh mục"))
                case .brand(let slug): WebTabView(path: "/brands/\(slug)", title: L10n.tr("Brand", "Thương hiệu"))
                case .conversation: EmptyView()   // routed at the tab level
                }
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

    // Web parity (listings-explorer hero): a top row (wordmark + bell) over a wide,
    // prominent search bar that holds the search field, the ✨ AI entry, a divider,
    // and the map button — all inside one rounded-2xl tint bar.
    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                Text("eno")
                    .font(.system(size: 26, weight: .heavy))
                    .kerning(-1)
                    .foregroundStyle(Tokens.brand)
                Spacer()
                NavigationLink {
                    NotificationsView()
                } label: {
                    Image(systemName: "bell")
                        .font(.system(size: 17, weight: .semibold))
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
                .accessibilityLabel(L10n.tr("Notifications", "Thông báo"))
                .accessibilityValue(notif.unread > 0 ? L10n.tr("\(notif.unread) unread", "\(notif.unread) chưa đọc") : "")
            }
            // The wide hero search bar.
            HStack(spacing: 10) {
                NavigationLink {
                    SearchView()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").font(.system(size: 19, weight: .semibold)).foregroundStyle(Tokens.ink4)
                        Text(L10n.tr("Search motorbikes, apartments, moving sales...", "Tìm xe máy, căn hộ, đồ thanh lý..."))
                            .font(.system(size: 16, weight: .medium)).foregroundStyle(Tokens.ink4).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // ✨ AI-shopping entry (web AISearchButton → /messages/ai), inside the bar.
                Button { aiSheet = true } label: {
                    Image(systemName: "sparkles").font(.system(size: 19, weight: .semibold)).foregroundStyle(Tokens.brand)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("AI shopping", "Mua sắm AI"))
                Rectangle().fill(Tokens.ring).frame(width: 1, height: 24)
                // Map view (web opens the map surface).
                Button { mapSheet = true } label: {
                    Image(systemName: "map").font(.system(size: 19, weight: .semibold)).foregroundStyle(Tokens.ink4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("Map", "Bản đồ"))
            }
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(.horizontal, 12)
        .padding(.top, 14)
        .padding(.bottom, 6)
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
                                .font(.system(size: 28, weight: .regular))
                                .foregroundStyle(Tokens.sub)   // muted at rest (web text-body), like the FINN grid
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

    // A rail card equals exactly one feed-grid column (12pt gutters + 8pt gap), so
    // rails line up pixel-perfect with the 2-col grid below — web shelf.tsx parity.
    private var railCardWidth: CGFloat {
        (UIScreen.main.bounds.width - 24 - 8) / 2
    }

    // ── horizontal card rail: leading icon + title + "See all" (web Shelf) ──
    private func railSection(icon: String? = nil, title: String, items: [ListingCard], seeAll: AppCategory? = nil) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.brand)
                }
                Text(title)
                    .font(.system(size: 16, weight: .bold))   // web Shelf header = text-base
                    .foregroundStyle(Tokens.fg)
                Spacer()
                if let seeAll {
                    NavigationLink(value: seeAll) {
                        HStack(spacing: 2) {
                            Text(L10n.tr("See all", "Xem tất cả")).font(.system(size: 14, weight: .semibold))
                            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold))
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
                                .frame(width: railCardWidth)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .padding(.top, 28)
    }

    // Web parity: the landing feed grid follows the rails with NO visible heading
    // (the web's 'Latest listings' h2 is sr-only). The sort bar is kept as a small
    // native affordance since the grid IS the ranked feed here.
    private var latestHeading: some View {
        SortBar(model: feed)
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
