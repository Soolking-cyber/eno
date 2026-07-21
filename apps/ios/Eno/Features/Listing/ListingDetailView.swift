import SwiftUI
import AVKit

// Native PDP v2, mirroring the web page's price-first hierarchy: gallery pager
// (video clip is its own page when present) → price block + market gauge →
// title/meta → condition chips → description → seller card → more-in-category
// rail. Renders instantly from the tapped card's payload, then hydrates from
// GET /api/listings/[id] (which also carries the priceBand). Chat/offers stay
// on the web surface until the native auth lane lands.
struct ListingDetailView: View {
    let card: ListingCard
    @State private var detail: ListingDetail?
    @State private var band: PriceBand?
    @State private var unavailable = false
    @State private var more: [ListingCard] = []
    @State private var recentlyViewed: [ListingCard] = []
    @State private var reviews: ReviewsPreview?
    @State private var sameSeller: [ListingCard] = []
    @State private var showWeb = false
    @State private var viewer: ViewerState?
    @State private var favs = FavoritesStore.shared
    @State private var sellerSheet = false
    @State private var showTrust = false
    @State private var signInSheet = false
    @State private var chatConvo: ChatRoute?
    @State private var contactBusy = false
    @State private var reportTarget: ReportTarget?
    @State private var showProtections = false
    // Offer composer (web parity: contact-composer). Discount slider 0…50%; the
    // default opens at a small discount (web: 1% for ≥1B đ items, else 5%).
    @State private var discount: Double = 5
    @State private var discountSet = false
    @State private var offerBusy = false

    private struct ChatRoute: Identifiable, Hashable {
        let id: String
    }

    private enum ReportTarget: Identifiable {
        case listing, seller
        var id: Int { hashValue }
    }

    private struct ViewerState: Identifiable {
        let id: Int
    }

    private var images: [String] { detail?.images ?? card.images }
    private var title: String { detail?.displayTitle ?? card.displayTitle }
    private var price: Int { detail?.price ?? card.price }
    private var videoURL: URL? { (detail?.video ?? card.video).flatMap { URL(string: $0) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Web parity (PdpShopLink "shop on top"): the seller surface sits
                // ABOVE the gallery at the top of the page.
                if let d = detail {
                    sellerCard(d.seller)
                        .padding(.horizontal, 12)
                        .padding(.top, 6)
                        .padding(.bottom, 8)
                }
                gallery
                VStack(alignment: .leading, spacing: 12) {
                    priceBlock
                    if let band { MarketGauge(price: price, band: band) }
                    Text(title)
                        .scaledFont(18, weight: .medium)   // web text-lg font-medium leading-snug
                        .foregroundStyle(Tokens.fg)
                        .lineSpacing(2)
                    specBadges
                    metaRow
                    protectionsRow
                    safetyStrip
                    if let d = detail {
                        statsRow(d)
                        Divider().overlay(Tokens.ring)
                        // Description (web page.tsx order-8: h-section 18px heading + body).
                        Text(L10n.tr("Description", "Mô tả")).scaledFont(18, weight: .bold).foregroundStyle(Tokens.fg)
                        // Light-markdown render (web listing-content.tsx): bullets,
                        // numbered lists, headings, inline **bold**.
                        ListingDescriptionView(text: d.description)
                        detailsTable(d)
                        reviewsPreview
                    } else if unavailable {
                        VStack(spacing: 6) {
                            Text("🚫").scaledFont(34)
                            Text(L10n.tr("This listing is no longer available", "Tin này không còn nữa"))
                                .scaledFont(16, weight: .bold).foregroundStyle(Tokens.fg)
                            Text(L10n.tr("It may have been sold or removed.", "Có thể đã bán hoặc bị gỡ."))
                                .scaledFont(14).foregroundStyle(Tokens.sub)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 24)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                    }
                    offerCard
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 16)
                sameSellerRail
                moreRail
                recentlyViewedRail
            }
        }
        .background(Tokens.canvas)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    FavoritesStore.shared.toggle(card.id)
                } label: {
                    Image(systemName: favs.isFavorite(card.id) ? "heart.fill" : "heart")
                        .foregroundStyle(favs.isFavorite(card.id) ? Tokens.brand : Tokens.fg)
                }
                .accessibilityLabel(favs.isFavorite(card.id) ? L10n.tr("Saved", "Đã lưu") : L10n.tr("Save", "Lưu"))
            }
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: URL(string: "https://eno.vn/listings/\(card.id)")!) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel(L10n.tr("Share", "Chia sẻ"))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) { reportTarget = .listing } label: {
                        Label(L10n.tr("Report listing", "Báo cáo tin"), systemImage: "flag")
                    }
                    if detail != nil {
                        Button(role: .destructive) { reportTarget = .seller } label: {
                            Label(L10n.tr("Report seller", "Báo cáo người bán"), systemImage: "flag")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel(L10n.tr("More options", "Thêm tùy chọn"))
            }
        }
        .navigationDestination(for: AppCategory.self) { cat in
            CategoryFeedView(category: cat)
        }
        .navigationDestination(item: $chatConvo) { route in
            ThreadView(convoId: route.id)
        }
        .sheet(isPresented: $signInSheet) { WebSheet(path: "/signin") }
        .sheet(isPresented: $showTrust) { NavigationStack { TrustExplainerView() } }
        .task { await load() }
        .sheet(isPresented: $showWeb) {
            WebSheet(path: "/listings/\(card.id)")
        }
        .sheet(isPresented: $sellerSheet) {
            if let sellerId = detail?.seller.id {
                SellerStorefrontView(sellerId: sellerId)
            }
        }
        .sheet(item: $reportTarget) { t in
            switch t {
            case .listing: ReportSheet(listingId: card.id)
            case .seller: ReportSheet(sellerId: detail?.seller.id)
            }
        }
        .sheet(isPresented: $showProtections) { protectionsSheet }
        .fullScreenCover(item: $viewer) { state in
            GalleryViewer(images: images, page: state.id)
        }
    }

    private func load() async {
        RecentStore.recordViewed(card.id)
        // Fire-and-forget view counter (web TrackView): best-effort, deduped
        // server-side; never blocks the page or surfaces errors.
        Task { try? await APIClient.shared.send("POST", "api/listings/\(card.id)/view") }
        if detail == nil {
            do {
                let env: ListingDetailEnvelope = try await APIClient.shared.get("api/listings/\(card.id)")
                detail = env.listing
                band = env.priceBand
                reviews = env.reviews
                sameSeller = (env.sameSellerListings ?? []).filter { $0.id != card.id }
            } catch {
                // 404 = sold/hidden/removed → show the "no longer available"
                // note instead of a perpetual spinner (P0 #3).
                if case APIError.http(let s) = error, s == 404 { unavailable = true }
            }
        }
        if more.isEmpty, let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [
            URLQueryItem(name: "category", value: card.category.slug),
            URLQueryItem(name: "limit", value: "9"),
        ]) {
            more = page.listings.filter { $0.id != card.id }
        }
        // Recently-viewed trail (device-local ids, excludes this listing) — feeds the
        // rail below "More like this" (mirrors HomeModel.loadRecentlyViewed).
        let recentIds = RecentStore.viewedIds().filter { $0 != card.id }
        if !recentIds.isEmpty,
           let page: FeedPage = try? await APIClient.shared.get("api/listings", query: [
               URLQueryItem(name: "ids", value: recentIds.joined(separator: ",")),
           ]) {
            let byId = Dictionary(uniqueKeysWithValues: page.listings.map { ($0.id, $0) })
            recentlyViewed = recentIds.compactMap { byId[$0] }
        }
    }

    // ── gallery: video page first when the listing has a clip ──
    private var gallery: some View {
        TabView {
            if let videoURL {
                VideoPage(url: videoURL)
            }
            ForEach(Array(images.enumerated()), id: \.offset) { idx, raw in
                AsyncImage(url: ImageURL.optimized(raw, width: 1080)) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: Tokens.tint
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { viewer = ViewerState(id: idx) }
            }
        }
        .tabViewStyle(.page)
        .aspectRatio(4 / 3, contentMode: .fit)   // web gallery slides are aspect-[4/3]
        .clipped()
        .background(Tokens.tint)
    }

    private var priceBlock: some View {
        let prev = detail?.prevPrice ?? card.prevPrice
        let drop: Int? = {
            guard let prev, prev > price, price > 0 else { return nil }
            return Int((Double(prev - price) / Double(prev) * 100).rounded())
        }()
        // Drop-badge countdown (web DropCountdown): "· còn N ngày" while the badge
        // window is live. dropExpiresAt is detail-only, so this appears once hydrated.
        let daysLeft: Int? = {
            guard let s = detail?.dropExpiresAt, let exp = Format.date(s) else { return nil }
            let d = Int((exp.timeIntervalSinceNow / 86_400).rounded(.up))
            return d > 0 ? d : nil
        }()
        let negotiable = detail?.negotiable ?? card.negotiable
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.vnd(price))
                    .scaledFont(30, weight: .bold)   // web text-3xl
                    .foregroundStyle(Tokens.brand)
                // Web shows NO ≈USD in the price block — only a struck previous price.
                if let prev, prev > price {
                    Text(Format.vnd(prev))
                        .scaledFont(16)
                        .strikethrough()
                        .foregroundStyle(Tokens.ink4)
                }
                // Price-drop % badge — matches the card's red drop chip (page.tsx:407).
                if let drop {
                    Text("-\(drop)%")
                        .scaledFont(11, weight: .bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Tokens.danger, in: Capsule())
                    // "· còn N ngày" countdown (web DropCountdown) — beside the drop pill.
                    if let daysLeft {
                        Text(L10n.tr("· \(daysLeft) \(daysLeft == 1 ? "day" : "days") left", "· còn \(daysLeft) ngày"))
                            .scaledFont(11, weight: .semibold)
                            .foregroundStyle(Tokens.danger)
                    }
                }
                if (detail?.urgent ?? card.urgent) {
                    // Web: a Zap lightning icon, not a text pill.
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(Tokens.danger)
                }
            }
            // Fixed-price badge — web page.tsx:416: a Tag icon + 'Fixed price' when
            // the listing is not negotiable (offers are the default, so this is rare).
            if !negotiable {
                HStack(spacing: 4) {
                    Image(systemName: "tag").scaledFont(11)
                    Text(L10n.tr("Fixed price", "Giá cố định")).scaledFont(11, weight: .semibold)
                }
                .foregroundStyle(Tokens.sub)
            }
        }
    }

    private var metaRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "mappin.and.ellipse").scaledFont(16).foregroundStyle(Tokens.ink4)
            Text(detail?.displayLocation ?? card.displayLocation).scaledFont(14)
            Text("·").scaledFont(14)
            Text(L10n.tr("Posted ", "Đăng ") + Format.ago(detail?.postedAt ?? card.postedAt)).scaledFont(14)
        }
        .foregroundStyle(Tokens.sub)
    }

    // Buyer-protections row (web protections-row.tsx) — tappable, opens the sheet.
    private var protectionsRow: some View {
        Button { showProtections = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.shield").font(.system(size: 18)).foregroundStyle(Tokens.brand)
                VStack(alignment: .leading, spacing: 1) {
                    Text(L10n.tr("ENO protects you", "ENO bảo vệ bạn")).scaledFont(13, weight: .bold).foregroundStyle(Tokens.fg)
                    Text(L10n.tr("Disputes handled in 72h · listings screened", "Tranh chấp xử lý trong 72 giờ · tin đã kiểm duyệt"))
                        .scaledFont(11).foregroundStyle(Tokens.sub).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").scaledFont(12).foregroundStyle(Tokens.sub)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 11))
            .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Tokens.ring, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // Category-aware safety strip (web safety-strip.tsx) — amber warning line.
    private var safetyStrip: some View {
        let amber = Color(red: 0.57, green: 0.25, blue: 0.05)
        let slug = detail?.category.slug ?? card.category.slug
        let line: String = {
            switch slug {
            case "vehicles":
                return L10n.tr("Check the papers match the chassis and engine number before paying — and never pay a deposit through a link.",
                               "Kiểm tra giấy tờ trùng số khung, số máy trước khi trả tiền — và đừng bao giờ đặt cọc qua link.")
            case "property", "rentals":
                return L10n.tr("View the place in person and verify ownership before any deposit.",
                               "Xem tận nơi và xác minh chủ sở hữu trước khi đặt cọc.")
            default:
                return L10n.tr("Meet in a public place and inspect the item before paying. eno.vn never asks for a deposit via a link.",
                               "Gặp ở nơi công cộng và kiểm tra món hàng trước khi trả tiền. eno.vn không bao giờ yêu cầu đặt cọc qua link.")
            }
        }()
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.shield").font(.system(size: 16)).foregroundStyle(amber)
            Text(line).scaledFont(12).foregroundStyle(Tokens.fg).lineSpacing(2)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(amber.opacity(0.1), in: RoundedRectangle(cornerRadius: 11))
    }

    private var protectionsSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(protectionItems, id: \.0) { item in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: item.2).font(.system(size: 18)).foregroundStyle(Tokens.brand).frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.0).scaledFont(15, weight: .semibold).foregroundStyle(Tokens.fg)
                                Text(item.1).scaledFont(13).foregroundStyle(Tokens.sub)
                            }
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle(L10n.tr("How ENO protects you", "ENO bảo vệ bạn thế nào"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L10n.tr("Done", "Xong")) { showProtections = false } } }
        }
        .presentationDetents([.medium, .large])
    }

    private var protectionItems: [(String, String, String)] {
        [
            (L10n.tr("Screened listings", "Tin đã kiểm duyệt"),
             L10n.tr("Every listing passes automated checks before it goes live.", "Mọi tin đều qua kiểm tra tự động trước khi đăng."), "checkmark.seal"),
            (L10n.tr("Evidence-based Trust score", "Điểm uy tín theo bằng chứng"),
             L10n.tr("Sellers earn a score from a real track record, not badges.", "Người bán có điểm từ lịch sử thực tế, không phải huy hiệu."), "shield.lefthalf.filled"),
            (L10n.tr("Dispute center", "Trung tâm tranh chấp"),
             L10n.tr("Report a problem and we handle it within 72 hours.", "Báo cáo sự cố và chúng tôi xử lý trong 72 giờ."), "exclamationmark.bubble"),
            (L10n.tr("Admin-reviewed reports", "Báo cáo có quản trị viên xét"),
             L10n.tr("Confirmed reports lower a seller's trust; false ones are penalized.", "Báo cáo đúng làm giảm uy tín; báo cáo sai bị phạt."), "person.badge.shield.checkmark"),
            (L10n.tr("Never pay via a link", "Không trả tiền qua link"),
             L10n.tr("eno.vn never asks for a deposit through a link — meet in person.", "eno.vn không bao giờ yêu cầu đặt cọc qua link — hãy gặp trực tiếp."), "hand.raised"),
        ]
    }

    // Web meta badge row (page.tsx:432-447): brand badge FIRST, then condition +
    // numeric specs as inline badges (spec label muted in ink-4, value in fg).
    // Wraps like the web flex row; self-hides when there's nothing to show.
    // (label?, value) pairs — nil label = single-value chip (brand, condition).
    private var specPairs: [(label: String?, value: String)] {
        var out: [(label: String?, value: String)] = []
        if let slug = card.brandSlug, !slug.isEmpty {
            out.append((nil, slug.replacingOccurrences(of: "-", with: " ").capitalized))
        }
        if let c = detail?.condition { out.append((nil, conditionLabel(c))) }
        if let y = detail?.year { out.append((L10n.tr("Year", "Năm"), String(y))) }
        if let km = detail?.mileageKm { out.append((L10n.tr("Mileage", "Số km"), "\(km.formatted()) km")) }
        if let e = detail?.engineL { out.append((L10n.tr("Engine", "Động cơ"), "\(e) L")) }
        return out
    }

    @ViewBuilder
    private var specBadges: some View {
        let pairs = specPairs
        if !pairs.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(Array(pairs.enumerated()), id: \.offset) { _, spec in
                    specChip {
                        HStack(spacing: 4) {
                            if let label = spec.label { Text(label).foregroundStyle(Tokens.ink4) }
                            Text(spec.value).foregroundStyle(Tokens.fg)
                        }
                    }
                }
            }
        }
    }

    private func specChip<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .scaledFont(12, weight: .semibold)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Tokens.tint, in: Capsule())
    }

    private func conditionLabel(_ c: String) -> String {
        switch c {
        case "new": return L10n.tr("New", "Mới")
        case "like-new": return L10n.tr("Like new", "Như mới")
        case "good": return L10n.tr("Good", "Tốt")
        case "fair": return L10n.tr("Fair", "Khá")
        default: return c
        }
    }

    // Details table (item 30, web parity): numeric specs (Year / Mileage / Engine,
    // with units) first, then the free-form attributes map (camelCase keys spaced
    // + capitalized, lowercase values capitalized). Self-hides when empty.
    private func detailRows(_ d: ListingDetail) -> [(String, String)] {
        var rows: [(String, String)] = []
        if let y = d.year { rows.append((L10n.tr("Year", "Năm"), String(y))) }
        if let km = d.mileageKm { rows.append((L10n.tr("Mileage", "Số km"), "\(km.formatted()) km")) }
        if let e = d.engineL { rows.append((L10n.tr("Engine", "Động cơ"), "\(e) L")) }
        for (k, v) in (d.attributes ?? [:]).sorted(by: { $0.key < $1.key }) {
            rows.append((attrKey(k), v.prefix(1).uppercased() + v.dropFirst()))
        }
        return rows
    }

    @ViewBuilder
    private func detailsTable(_ d: ListingDetail) -> some View {
        let rows = detailRows(d)
        if !rows.isEmpty {
            Divider().overlay(Tokens.ring)
            VStack(alignment: .leading, spacing: 0) {
                Text(L10n.tr("Details", "Chi tiết"))
                    .scaledFont(18, weight: .bold)   // web h-section
                    .foregroundStyle(Tokens.fg)
                    .padding(.bottom, 4)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .top, spacing: 16) {
                        Text(row.0).scaledFont(14).foregroundStyle(Tokens.sub)
                        Spacer()
                        Text(row.1).scaledFont(14, weight: .medium)
                            .foregroundStyle(Tokens.fg).multilineTextAlignment(.trailing)
                    }
                    .padding(.vertical, 10)   // web py-2.5
                }
            }
        }
    }

    // camelCase → spaced + capitalized ("screenSize" → "Screen Size").
    private func attrKey(_ k: String) -> String {
        var spaced = ""
        for ch in k {
            if ch.isUppercase { spaced += " " }
            spaced.append(ch)
        }
        return spaced.split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    // Web social proof: shown ONLY when savedCount≥3 OR views≥20, and only
    // saved + views (no 'contacted' count).
    @ViewBuilder
    private func statsRow(_ d: ListingDetail) -> some View {
        let saved = max(0, d.savedCount + favs.delta(card.id))
        if saved >= 3 || d.views >= 20 {
            HStack(spacing: 14) {
                if d.views >= 20 { stat(icon: "eye", value: d.views, label: L10n.tr("views", "lượt xem")) }
                if saved >= 3 { stat(icon: "heart", value: saved, label: L10n.tr("saved", "đã lưu")) }
                Spacer()
            }
        }
    }

    private func stat(icon: String, value: Int, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).scaledFont(14)
            Text("\(value) \(label)").scaledFont(12)
        }
        .foregroundStyle(Tokens.sub)
    }

    private func sellerCard(_ seller: ListingDetail.DetailSeller) -> some View {
        Button {
            sellerSheet = true
        } label: {
            sellerCardBody(seller)
        }
        .buttonStyle(.plain)
    }

    private func sellerCardBody(_ seller: ListingDetail.DetailSeller) -> some View {
        HStack(spacing: 12) {
            Text(String(seller.name.prefix(1)).uppercased())
                .scaledFont(16, weight: .bold)
                .foregroundStyle(.white)
                .frame(width: 48, height: 48)   // web Avatar size lg
                .background(Color(hexString: seller.avatarColor) ?? Tokens.brand, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(seller.name)
                        .scaledFont(14, weight: .bold)   // web text-sm font-bold
                        .foregroundStyle(Tokens.fg)
                    TrustMini(score: seller.trustScore) { showTrust = true }
                    if seller.isBusiness {
                        HStack(spacing: 2) {
                            Image(systemName: "building.2").scaledFont(10)
                            Text(L10n.tr("Business", "Doanh nghiệp")).scaledFont(11, weight: .semibold)
                        }
                        .foregroundStyle(Tokens.sub)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Tokens.tint, in: Capsule())
                    }
                }
                HStack(spacing: 4) {
                    if let rating = seller.rating, seller.reviewCount > 0 {
                        Image(systemName: "star.fill").scaledFont(10).foregroundStyle(.yellow)
                        Text("\(rating, specifier: "%.1f") (\(seller.reviewCount))")
                            .scaledFont(12).foregroundStyle(Tokens.sub)
                        Text("·").foregroundStyle(Tokens.sub)
                    }
                    if let year = Format.date(seller.memberSince).map({ Calendar.current.component(.year, from: $0) }) {
                        Text(L10n.tr("Joined \(String(year))", "Tham gia \(String(year))"))
                            .scaledFont(12).foregroundStyle(Tokens.sub)
                    }
                }
            }
            Spacer()
            // Web PdpShopLink 'Shop ›' visit-storefront affordance.
            HStack(spacing: 2) {
                Text(L10n.tr("Shop", "Gian hàng")).scaledFont(12, weight: .semibold)
                Image(systemName: "chevron.right").scaledFont(12, weight: .semibold)
            }
            .foregroundStyle(Tokens.brand)
        }
    }

    @ViewBuilder
    private var moreRail: some View {
        if !more.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(L10n.tr("More like this", "Tin tương tự"))
                        .scaledFont(18, weight: .bold)
                        .foregroundStyle(Tokens.fg)
                    Spacer()
                    if let cat = Categories.bySlug(card.category.slug) {
                        NavigationLink(value: cat) {
                            HStack(spacing: 2) {
                                Text(L10n.tr("See all", "Xem tất cả")).scaledFont(13, weight: .semibold)
                                Image(systemName: "chevron.right").scaledFont(10, weight: .bold)
                            }
                            .foregroundStyle(Tokens.brand)
                        }
                    }
                }
                .padding(.horizontal, 12)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(more) { item in
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
            .padding(.bottom, 16)
        }
    }

    // "More from this seller" shelf (web SameSellerShelf) — above "More like this",
    // hidden when the seller has < 2 other active listings.
    @ViewBuilder
    private var sameSellerRail: some View {
        if sameSeller.count >= 2 {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(L10n.tr("More from this seller", "Tin khác từ người bán này"))
                        .scaledFont(17, weight: .bold)
                        .foregroundStyle(Tokens.fg)
                    Spacer()
                    Button { sellerSheet = true } label: {
                        HStack(spacing: 2) {
                            Text(L10n.tr("See all", "Xem tất cả")).scaledFont(14, weight: .semibold)
                            Image(systemName: "chevron.right").scaledFont(10, weight: .bold)
                        }
                        .foregroundStyle(Tokens.brand)
                    }
                }
                .padding(.horizontal, 12)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(sameSeller) { item in
                            NavigationLink(value: item) {
                                ListingCardView(listing: item).frame(width: 168)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                }
            }
            .padding(.bottom, 16)
        }
    }

    // Recently-viewed trail (web recently-viewed-rail.tsx) — the buyer's own opened
    // listings, device-local, below "More like this". Excludes this listing (load()).
    @ViewBuilder
    private var recentlyViewedRail: some View {
        if !recentlyViewed.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.tr("Recently viewed", "Đã xem gần đây"))
                    .scaledFont(18, weight: .bold)
                    .foregroundStyle(Tokens.fg)
                    .padding(.horizontal, 12)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(recentlyViewed) { item in
                            NavigationLink(value: item) {
                                ListingCardView(listing: item).frame(width: 168)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                }
            }
            .padding(.bottom, 16)
        }
    }

    // Buyer reviews preview (web reviews-preview.tsx): avg + up to 2 verified-first.
    @ViewBuilder
    private var reviewsPreview: some View {
        if let r = reviews, r.total > 0, !r.reviews.isEmpty {
            Divider().overlay(Tokens.ring)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text(L10n.tr("Buyer reviews", "Đánh giá về người bán")).scaledFont(16, weight: .bold).foregroundStyle(Tokens.fg)
                    Text("(\(r.total))").scaledFont(14).foregroundStyle(Tokens.sub)
                    Spacer()
                    Image(systemName: "star.fill").scaledFont(12).foregroundStyle(.yellow)
                    Text(String(format: "%.1f", r.avg)).scaledFont(14, weight: .semibold).foregroundStyle(Tokens.fg)
                }
                ForEach(r.reviews.prefix(2)) { rev in
                    HStack(alignment: .top, spacing: 10) {
                        Text(initials(rev.author)).scaledFont(12, weight: .bold).foregroundStyle(.white)
                            .frame(width: 32, height: 32).background(Tokens.brand, in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(rev.author).scaledFont(14, weight: .semibold).foregroundStyle(Tokens.fg)
                                if rev.verified {
                                    Text(L10n.tr("Verified buyer", "Đã mua")).scaledFont(10, weight: .bold)
                                        .foregroundStyle(Tokens.brand).padding(.horizontal, 6).padding(.vertical, 1)
                                        .background(Tokens.brandTint, in: Capsule())
                                }
                            }
                            Text(rev.text).scaledFont(13).foregroundStyle(Tokens.sub).lineLimit(3)
                        }
                        Spacer()
                    }
                }
                Button { sellerSheet = true } label: {
                    Text(L10n.tr("See all", "Xem tất cả")).scaledFont(14, weight: .semibold).foregroundStyle(Tokens.brand)
                }
            }
        }
    }

    private func initials(_ name: String) -> String {
        let words = name.split(separator: " ")
        let a = words.first?.first.map(String.init) ?? ""
        let b = words.count > 1 ? (words.last?.first.map(String.init) ?? "") : ""
        return (a + b).uppercased()
    }

    // Offer composer (web parity: contact-composer.tsx) — negotiable listings get a
    // discount slider + a 70/30 "Send offer · {price}" / "Chat" split. Offers are the
    // default here; a fixed-price listing shows only the sticky "Chat now" bar.
    @ViewBuilder
    private var offerCard: some View {
        // Gate on the loaded DETAIL, never the cached card: a stale card.negotiable
        // (seller later switched to fixed-price) would briefly expose "Send offer" and
        // an offer on a fixed-price listing 409s AND docks the buyer's trust. So the
        // composer only appears once the network confirms negotiable (dual-reviewer
        // finding, 2026-07-20).
        if detail?.negotiable == true && price > 0 {
            let offerPrice = Int((Double(price) * (1 - discount / 100)).rounded())
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.tr("Your offer", "Giá đề nghị"))
                    .scaledFont(12, weight: .semibold).foregroundStyle(Tokens.sub)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(Format.vnd(offerPrice)).scaledFont(24, weight: .bold).foregroundStyle(Tokens.brand)
                    Text("-\(Int(discount))%").scaledFont(12, weight: .semibold).foregroundStyle(Tokens.sub)
                }
                Slider(value: $discount, in: 0...50, step: 1).tint(Tokens.brand)
                    .accessibilityLabel(L10n.tr("Discount", "Mức giảm"))
                HStack {
                    Text(L10n.tr("Asking", "Giá rao") + ": " + Format.vnd(price))
                    Spacer()
                    Text("-50%")
                }
                .scaledFont(11).foregroundStyle(Tokens.ink4)
                HStack(spacing: 8) {
                    Button { startOffer(offerPrice) } label: {
                        Group {
                            if offerBusy {
                                ProgressView().tint(.white)
                            } else {
                                HStack(spacing: 6) {
                                    Image(systemName: "paperplane.fill").scaledFont(14)
                                    Text(L10n.tr("Send offer", "Gửi đề nghị") + " · " + Format.vnd(offerPrice))
                                        .lineLimit(1).minimumScaleFactor(0.75)
                                }
                            }
                        }
                        .scaledFont(14, weight: .semibold).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
                    }
                    .disabled(offerBusy)
                    Button { startChat() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "message.fill").scaledFont(14)
                            Text(L10n.tr("Chat", "Chat"))
                        }
                        .scaledFont(14, weight: .bold).foregroundStyle(Tokens.brand)
                        .frame(height: 44).padding(.horizontal, 16)
                        .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
                        .overlay(RoundedRectangle(cornerRadius: Tokens.radiusControl).strokeBorder(Tokens.ring, lineWidth: 1))
                    }
                }
            }
            .padding(12)
            .background(Tokens.tint, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
            // Open the slider at the web default the first time it appears.
            .onAppear { if !discountSet { discount = price >= 1_000_000_000 ? 1 : 5; discountSet = true } }
        } else if detail != nil {
            // Fixed-price / non-negotiable listings: an inline Chat-now button
            // (replaces the removed sticky bottom bar — owner asked to drop the
            // floating CTA that sat on top of the tab bar).
            Button { startChat() } label: {
                Group {
                    if contactBusy { ProgressView().tint(.white) }
                    else {
                        HStack(spacing: 6) {
                            Image(systemName: "message.fill").scaledFont(14)
                            Text(L10n.tr("Chat now", "Chat ngay"))
                        }
                    }
                }
                .scaledFont(14, weight: .semibold).foregroundStyle(.white)
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
            .disabled(contactBusy)
        }
    }

    // Send a structured first offer (kind='offer' card) — the same POST the web
    // composer resolves through. Guests get the sign-in sheet; refusals fall to web.
    private func startOffer(_ amount: Int) {
        // Belt-and-suspenders: never send an offer unless the loaded detail says the
        // listing is negotiable (the server 409s + docks trust otherwise).
        guard detail?.negotiable == true else { return }
        guard AuthModel.shared.isSignedIn else { signInSheet = true; return }
        guard !offerBusy, !contactBusy else { return }
        offerBusy = true
        Task {
            defer { offerBusy = false }
            do {
                let r: CreateConvoResponse = try await APIClient.shared.post(
                    "api/conversations", body: ["listingId": card.id, "offerAmount": amount])
                chatConvo = ChatRoute(id: r.id)
            } catch {
                showWeb = true
            }
        }
    }

    // Native chat entry: find-or-create the thread (the same idempotent POST the
    // web's contact composer resolves through — no auto-message; the thread's
    // composer is right there) and push it. Guests get the sign-in sheet; API
    // refusals (own listing, caps) fall back to the web page, which explains them.
    private func startChat() {
        guard AuthModel.shared.isSignedIn else { signInSheet = true; return }
        guard !contactBusy else { return }
        contactBusy = true
        Task {
            defer { contactBusy = false }
            do {
                let r: CreateConvoResponse = try await APIClient.shared.post("api/conversations", body: ["listingId": card.id])
                chatConvo = ChatRoute(id: r.id)
            } catch {
                showWeb = true
            }
        }
    }
}

// One gallery page playing the listing clip (raw Supabase URL) with native
// controls; audio session stays ambient so it never ducks the user's music.
private struct VideoPage: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .onAppear {
                if player == nil { player = AVPlayer(url: url) }
            }
            .onDisappear { player?.pause() }
            .overlay {
                if player == nil { Tokens.tint }
            }
    }
}

// The web's MarketPrice gauge, compact: the p25–p75 band as a track with the
// listing's price as a marker; caption states the median. Green when below the
// band (a good deal), brand inside, gray above.
struct MarketGauge: View {
    let price: Int
    let band: PriceBand

    // Padded gauge scale (web market-price.tsx): pad the ends so the marker sits
    // inside the track even for an outlier ask; the P25–P75 sub-segment is shaded.
    private var lo: Double { min(band.p25, Double(price)) * 0.92 }
    private var hi: Double { max(band.p75, Double(price)) * 1.08 }
    private func at(_ v: Double) -> Double {
        let span = max(hi - lo, 1)
        return min(max((v - lo) / span, 0), 1)
    }
    private var accent: Color {
        if Double(price) < band.p25 { return .green }
        if Double(price) > band.p75 { return Tokens.sub }
        return Tokens.brand
    }
    // Web position label (market-price.tsx): below p25 = a good deal, above p75 =
    // higher than typical, otherwise typical.
    private var positionLabel: (String, String) {
        if Double(price) < band.p25 { return ("Good price", "Giá tốt") }
        if Double(price) > band.p75 { return ("Above typical", "Cao hơn thường") }
        return ("Typical price", "Giá phổ biến")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header row: 'Market price' label LEFT + position verdict RIGHT.
            HStack {
                Text(L10n.tr("Market price", "Giá thị trường"))
                    .scaledFont(12, weight: .semibold)
                    .foregroundStyle(Tokens.sub)
                Spacer()
                Text(L10n.tr(positionLabel.0, positionLabel.1))
                    .scaledFont(11, weight: .semibold)
                    .foregroundStyle(accent)
            }
            // p25 – p75 range: one 14px bold line ABOVE the track (dash in ink-4).
            HStack(spacing: 4) {
                Text(Format.vnd(Int(band.p25)))
                Text("–").fontWeight(.regular).foregroundStyle(Tokens.ink4)
                Text(Format.vnd(Int(band.p75)))
            }
            .scaledFont(14, weight: .bold)
            .foregroundStyle(Tokens.fg)
            // Track (8px) + bordered marker (14px, card-ring + soft shadow).
            GeometryReader { geo in
                let w = geo.size.width
                let bandLeft = at(band.p25)
                let bandWidth = max(0.02, at(band.p75) - at(band.p25))
                let markerLeft = at(Double(price))
                ZStack(alignment: .leading) {
                    Capsule().fill(Tokens.tint).frame(height: 8)
                    // Shaded typical band (P25–P75) — web bg-accent-foreground/25.
                    Capsule().fill(Tokens.brand.opacity(0.25))
                        .frame(width: bandWidth * w, height: 8)
                        .offset(x: bandLeft * w)
                    Circle()
                        .fill(accent)
                        .frame(width: 14, height: 14)
                        .overlay(Circle().strokeBorder(Tokens.card, lineWidth: 2))
                        .shadow(color: .black.opacity(0.15), radius: 1.5, y: 1)
                        // Centered on the price point (web -translate-x-1/2).
                        .offset(x: markerLeft * w - 7)
                }
            }
            .frame(height: 14)
            // Sample-count caption (web shows no median; it shows the basis).
            Text(L10n.tr("Based on \(band.n) similar listings", "Dựa trên \(band.n) tin tương tự"))
                .scaledFont(11)
                .foregroundStyle(Tokens.ink4)
        }
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
