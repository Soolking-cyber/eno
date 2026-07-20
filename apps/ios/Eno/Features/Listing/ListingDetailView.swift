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
    @State private var showWeb = false
    @State private var viewer: ViewerState?
    @State private var favs = FavoritesStore.shared
    @State private var sellerSheet = false
    @State private var showTrust = false
    @State private var signInSheet = false
    @State private var chatConvo: ChatRoute?
    @State private var contactBusy = false
    @State private var reportTarget: ReportTarget?

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
                gallery
                VStack(alignment: .leading, spacing: 12) {
                    priceBlock
                    if let band { MarketGauge(price: price, band: band) }
                    Text(title)
                        .scaledFont(20, weight: .semibold)
                        .foregroundStyle(Tokens.fg)
                    metaRow
                    conditionChips
                    if let d = detail {
                        statsRow(d)
                        Divider().overlay(Tokens.ring)
                        Text(d.description)
                            .scaledFont(15)
                            .foregroundStyle(Tokens.fg)
                            .lineSpacing(3)
                        detailsTable(d)
                        Divider().overlay(Tokens.ring)
                        sellerCard(d.seller)
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
                }
                .padding(16)
                moreRail
            }
        }
        .background(Tokens.canvas)
        .safeAreaInset(edge: .bottom) { ctaBar }
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
        .fullScreenCover(item: $viewer) { state in
            GalleryViewer(images: images, page: state.id)
        }
    }

    private func load() async {
        RecentStore.recordViewed(card.id)
        if detail == nil {
            do {
                let env: ListingDetailEnvelope = try await APIClient.shared.get("api/listings/\(card.id)")
                detail = env.listing
                band = env.priceBand
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
        .aspectRatio(1, contentMode: .fit)
        .clipped()
        .background(Tokens.tint)
    }

    private var priceBlock: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(Format.vnd(price))
                .scaledFont(26, weight: .bold)
                .foregroundStyle(Tokens.brand)
            if let prev = detail?.prevPrice ?? card.prevPrice, prev > price {
                Text(Format.vnd(prev))
                    .scaledFont(14, weight: .medium)
                    .strikethrough()
                    .foregroundStyle(Tokens.sub)
            } else if let approx = Fx.shared.approxUSD(price) {
                Text(approx)
                    .scaledFont(14)
                    .foregroundStyle(Tokens.sub)
            }
            if (detail?.urgent ?? card.urgent) {
                Text(L10n.tr("Urgent", "Bán gấp"))
                    .scaledFont(11, weight: .bold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(Tokens.danger, in: Capsule())
            }
        }
    }

    private var metaRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "mappin.and.ellipse").scaledFont(12)
            Text(detail?.displayLocation ?? card.displayLocation).scaledFont(13)
            Text("·").scaledFont(13)
            Text(Format.ago(detail?.postedAt ?? card.postedAt)).scaledFont(13)
        }
        .foregroundStyle(Tokens.sub)
    }

    // Condition / year / mileage facts as quiet chips (vehicles get year+km).
    @ViewBuilder
    private var conditionChips: some View {
        let facts: [String] = [
            detail?.condition.map { conditionLabel($0) },
            detail?.year.map { String($0) },
            detail?.mileageKm.map { "\($0.formatted()) km" },
        ].compactMap { $0 }
        if !facts.isEmpty {
            HStack(spacing: 6) {
                ForEach(facts, id: \.self) { fact in
                    Text(fact)
                        .scaledFont(12, weight: .medium)
                        .foregroundStyle(Tokens.fg)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Tokens.tint, in: Capsule())
                }
            }
        }
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
                Text(L10n.tr("Details", "Thông số"))
                    .scaledFont(16, weight: .bold)
                    .foregroundStyle(Tokens.fg)
                    .padding(.bottom, 4)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .top, spacing: 16) {
                        Text(row.0).scaledFont(14).foregroundStyle(Tokens.sub)
                        Spacer()
                        Text(row.1).scaledFont(14, weight: .medium)
                            .foregroundStyle(Tokens.fg).multilineTextAlignment(.trailing)
                    }
                    .padding(.vertical, 6)
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

    private func statsRow(_ d: ListingDetail) -> some View {
        HStack(spacing: 14) {
            stat(icon: "eye", value: d.views, label: L10n.tr("views", "lượt xem"))
            stat(icon: "heart", value: max(0, d.savedCount + favs.delta(card.id)), label: L10n.tr("saved", "đã lưu"))
            stat(icon: "message", value: d.contactCount, label: L10n.tr("contacted", "đã liên hệ"))
            Spacer()
        }
    }

    private func stat(icon: String, value: Int, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).scaledFont(11)
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
                .scaledFont(18, weight: .bold)
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Color(hexString: seller.avatarColor) ?? Tokens.brand, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(seller.name)
                        .scaledFont(15, weight: .semibold)
                        .foregroundStyle(Tokens.fg)
                    TrustMini(score: seller.trustScore) { showTrust = true }
                }
                HStack(spacing: 4) {
                    if let rating = seller.rating, seller.reviewCount > 0 {
                        Image(systemName: "star.fill").scaledFont(10).foregroundStyle(.yellow)
                        Text("\(rating, specifier: "%.1f") (\(seller.reviewCount))")
                            .scaledFont(12)
                            .foregroundStyle(Tokens.sub)
                        Text("·").foregroundStyle(Tokens.sub)
                    }
                    if seller.isBusiness {
                        Text(L10n.tr("Business", "Doanh nghiệp"))
                            .scaledFont(11, weight: .semibold)
                            .foregroundStyle(Tokens.brand)
                    }
                    if let year = Format.date(seller.memberSince).map({ Calendar.current.component(.year, from: $0) }) {
                        Text(L10n.tr("Member since \(String(year))", "Thành viên từ \(String(year))"))
                            .scaledFont(12)
                            .foregroundStyle(Tokens.sub)
                    }
                }
            }
            Spacer()
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

    private var ctaBar: some View {
        Button {
            startChat()
        } label: {
            Group {
                if contactBusy {
                    ProgressView().tint(.white)
                } else {
                    Text(L10n.tr("Chat with seller", "Nhắn tin cho người bán"))
                }
            }
            .scaledFont(16, weight: .semibold)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
        }
        .disabled(contactBusy)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .background(.bar)
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

    private var position: Double {
        let span = max(band.p75 - band.p25, 1)
        return min(max((Double(price) - band.p25) / span, 0), 1)
    }
    private var accent: Color {
        if Double(price) < band.p25 { return .green }
        if Double(price) > band.p75 { return Tokens.sub }
        return Tokens.brand
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Tokens.tint).frame(height: 6)
                    Circle()
                        .fill(accent)
                        .frame(width: 12, height: 12)
                        .offset(x: position * (geo.size.width - 12))
                }
            }
            .frame(height: 12)
            HStack {
                Text(Format.vnd(Int(band.p25)))
                Spacer()
                Text(L10n.tr("Market median \(Format.vnd(Int(band.median)))", "Giá thị trường \(Format.vnd(Int(band.median)))"))
                    .fontWeight(.semibold)
                Spacer()
                Text(Format.vnd(Int(band.p75)))
            }
            .scaledFont(11)
            .foregroundStyle(Tokens.sub)
        }
        .padding(10)
        .background(Tokens.tint.opacity(0.5), in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
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
