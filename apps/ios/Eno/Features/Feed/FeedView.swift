import SwiftUI
import EnoUI

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
            .background(EnoColor.canvas)
            .refreshable {
                async let f: Void = feed.reload()
                async let h: Void = home.refresh()
                _ = await (f, h)
            }
            .sheet(isPresented: $aiSheet) {
                AIConciergeView()
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
    // and the map button — all inside one tint bar (web rounded-2xl lands on the
    // control radius tier, the widest EnoRadius offers).
    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                // The wordmark keeps its heavy weight + tight kerning — brand identity the
                // .titleL role (bold) doesn't carry on its own.
                Text("eno")
                    .enoText(.titleL, color: EnoColor.brand)
                    .fontWeight(.heavy)
                    .kerning(-1)
                Spacer()
                NavigationLink {
                    NotificationsView()
                } label: {
                    Image(systemName: "bell")
                        .enoIcon(.md, color: EnoColor.fg)
                        .frame(width: 40, height: 40)
                        .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
                        .overlay(alignment: .topTrailing) {
                            if notif.unread > 0 {
                                Circle().fill(EnoColor.danger).frame(width: 9, height: 9).offset(x: -6, y: 6)
                            }
                        }
                }
                .buttonStyle(.plain)   // NavigationLink, not a hand-rolled Button — keeps its style
                .accessibilityLabel(L10n.tr("Notifications", "Thông báo"))
                .accessibilityValue(notif.unread > 0 ? L10n.tr("\(notif.unread) unread", "\(notif.unread) chưa đọc") : "")
            }
            // The wide hero search bar.
            HStack(spacing: 10) {
                NavigationLink {
                    SearchView()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").enoIcon(.md, color: EnoColor.ink4)
                        Text(L10n.tr("Search motorbikes, apartments, moving sales...", "Tìm xe máy, căn hộ, đồ thanh lý..."))
                            .enoText(.callout, color: EnoColor.ink4).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // The two glyph actions ride in a spacing-0 cluster: EnoIconButton carries its
                // own 44pt tap target, whose built-in slack reproduces the old 10pt gaps while
                // lifting both from a sub-minimum 19pt target. Trailing inset drops 14 → 2 for
                // the same reason, so the map glyph keeps its spot on the bar's right edge.
                HStack(spacing: 0) {
                    // ✨ AI-shopping entry (web AISearchButton → /messages/ai), inside the bar.
                    EnoIconButton("sparkles", size: 19, color: EnoColor.brand,
                                  label: L10n.tr("AI shopping", "Mua sắm AI")) { aiSheet = true }
                    Rectangle().fill(EnoColor.ring).frame(width: 1, height: 24)
                    // Map view (web opens the map surface).
                    EnoIconButton("map", size: 19, color: EnoColor.ink4,
                                  label: L10n.tr("Map", "Bản đồ")) { mapSheet = true }
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, 2)
            .frame(height: 52)
            .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
        }
        .padding(.horizontal, 12)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    // ── two-row horizontally scrolling icon grid (the FINN-style web grid) ──
    private var categoryGrid: some View {
        // Spacing (owner: "some spacing between category icons"): 4pt gaps read as one
        // cramped block. Tiles are 80 wide on 12pt gaps inside the 12pt page gutter, so
        // four sit comfortably across and the FIFTH PEEKS at the edge — the gap does the
        // breathing AND the peek advertises that the row scrolls (at 92/4 the row exactly
        // filled the screen, so it looked complete and nobody scrolled it).
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHGrid(rows: [GridItem(.fixed(84), spacing: EnoSpacing.s3), GridItem(.fixed(84), spacing: EnoSpacing.s3)],
                      spacing: EnoSpacing.s3) {
                ForEach(Categories.all) { cat in
                    NavigationLink(value: cat) {
                        // Web parity (FINN-style grid, listings-explorer.tsx): a
                        // monochrome icon + bold label, NO colored tile — every
                        // category uses the one brand identity, not per-category
                        // colors (CATEGORY_COLOR_CLASSES collapses all to brand).
                        VStack(spacing: EnoSpacing.s2) {
                            Image(systemName: cat.symbol)
                                .enoIcon(.lg, color: EnoColor.sub)   // muted at rest (web text-body), like the FINN grid
                                .frame(width: 44, height: 44)
                            Text(cat.name)
                                .enoText(.caption)
                                .fontWeight(.bold)   // the bold label is the FINN-grid identity (see above)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                        .frame(width: 80)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, EnoSpacing.s3)
        }
        // 84 + 84 + the 12pt row gap — the old 176 clipped once the rows were spaced.
        .frame(height: 180)
        .enoEdgeFade()
        .padding(.bottom, EnoSpacing.s2)
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
                    Image(systemName: icon).enoIcon(.sm, color: EnoColor.brand)
                }
                Text(title)
                    .enoText(.headline)   // web Shelf header = text-base
                Spacer()
                if let seeAll {
                    NavigationLink(value: seeAll) {
                        HStack(spacing: 2) {
                            Text(L10n.tr("See all", "Xem tất cả")).enoText(.label, color: EnoColor.brand)
                            Image(systemName: "chevron.right").enoIcon(.sm, color: EnoColor.brand)
                        }
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

    // TODO(EnoUI): EnoEmptyState — title + body + action state block, awaiting the primitive
    // (same shape as SavedView.empty/errorState); the tokens below are already canon.
    private var offline: some View {
        VStack(spacing: 14) {
            Text(L10n.tr("No internet connection", "Không có kết nối mạng"))
                .enoText(.headline)
            Text(L10n.tr("Check your connection and try again.", "Kiểm tra kết nối của bạn rồi thử lại."))
                .enoText(.callout, color: EnoColor.sub)
            EnoButton(L10n.tr("Try again", "Thử lại"), size: .large, fullWidth: false) {
                Task { await feed.reload() }
            }
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
            EnoColor.tint.aspectRatio(10 / 11, contentMode: .fit)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: EnoRadius.chip).fill(EnoColor.tint).frame(width: 90, height: 16)
                RoundedRectangle(cornerRadius: EnoRadius.chip).fill(EnoColor.tint).frame(height: 12)
                RoundedRectangle(cornerRadius: EnoRadius.chip).fill(EnoColor.tint).frame(width: 60, height: 12)
            }
            .padding(10)
        }
        .background(EnoColor.card)
        .clipShape(RoundedRectangle(cornerRadius: EnoRadius.card))
        .overlay(RoundedRectangle(cornerRadius: EnoRadius.card).strokeBorder(EnoColor.ring, lineWidth: 1))
    }
}
