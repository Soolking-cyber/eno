import SwiftUI
import EnoUI
import Observation

// The web mobile "quick find" cascading selector (spec: docs-derived from
// category-rail.tsx + brand-rail.tsx). Two stacked horizontal rails: a CATEGORY
// icon swiper whose active tile unfolds an inline blue-tint subcategory panel,
// and (on the 7 brandable categories) a BRAND-logo swiper whose active tile
// unfolds a MODEL panel. Every axis has an "All" default, is ranked by live
// listing count, filters the feed in place. Tokens: panel = brandTint (web
// bg-brand-50), selected = brand (accent-foreground), chip surface = card,
// radii 11pt panel / 7pt chip (repo --radius override).
@MainActor
@Observable
final class BrandRailModel {
    var brands: [BrandsResponse.Brand] = []
    var models: [ModelsResponse.ModelItem] = []
    private var scopeKey = ""

    // The 7 brandable categories (spec §4.6) — only these render the brand rail.
    static let brandable: Set<String> = [
        "electronics", "fashion-beauty", "vehicles", "rentals",
        "furniture-appliances", "baby-kids", "hobbies-sports",
    ]

    func loadBrands(category: String?, subcategory: String?) async {
        let key = "\(category ?? "")|\(subcategory ?? "")"
        guard key != scopeKey else { return }
        models = []
        guard let category, Self.brandable.contains(category) else { scopeKey = key; brands = []; return }
        let q = [
            URLQueryItem(name: "category", value: category),
            URLQueryItem(name: "subcategory", value: subcategory ?? "all"),
            URLQueryItem(name: "limit", value: "40"),
        ]
        let fetched = (try? await APIClient.shared.get("api/brands", query: q) as BrandsResponse)?.brands ?? []
        // Commit the scope ONLY after a live (non-superseded) fetch — otherwise a
        // programmatic category-set whose fetch was cancelled would strand the rail
        // empty and block the retry (owner: brands don't show under "All" until a
        // subcategory is tapped).
        guard !Task.isCancelled else { return }
        scopeKey = key
        brands = fetched
    }

    func loadModels(brand: String, category: String?, subcategory: String?) async {
        models = []
        guard let category else { return }
        let q = [
            URLQueryItem(name: "category", value: category),
            URLQueryItem(name: "subcategory", value: subcategory ?? "all"),
        ]
        models = (try? await APIClient.shared.get("api/brands/\(brand)/models", query: q) as ModelsResponse)?.models ?? []
    }
}

struct QuickFindBar: View {
    @Bindable var feed: FeedModel
    @State private var rail = BrandRailModel()
    @State private var subsByCat: [String: [CategoriesResponse.Sub]] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s4) {
            categoryRail
            if !rail.brands.isEmpty {
                brandRail
            }
        }
        // Load on appear AND on every category/subcategory change — explicit onChange
        // is more reliable than .task(id:) for a programmatic category-set (the case
        // where the category page opens on a category the user didn't tap).
        .task { await rail.loadBrands(category: feed.category, subcategory: feed.subcategory) }
        .onChange(of: feed.category) {
            Task { await rail.loadBrands(category: feed.category, subcategory: feed.subcategory) }
        }
        .onChange(of: feed.subcategory) {
            Task { await rail.loadBrands(category: feed.category, subcategory: feed.subcategory) }
        }
    }

    // ── category rail: tiles + inline subcat panel, auto-scroll active to leading ──
    private var categoryRail: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: EnoSpacing.s4) {
                    tile(name: L10n.tr("All", "Tất cả"), symbol: "square.stack.3d.up", active: feed.category == nil) {
                        feed.category = nil; feed.subcategory = nil; feed.brand = nil; feed.model = nil
                    }
                    .id("cat-all")
                    ForEach(Categories.all) { cat in
                        tile(name: cat.name, symbol: cat.symbol, active: feed.category == cat.slug) {
                            if feed.category == cat.slug { clearAll() }
                            else { clearAll(); feed.category = cat.slug }
                        }
                        .id("cat-\(cat.slug)")
                        if feed.category == cat.slug {
                            subcatPanel(for: cat)
                        }
                    }
                }
                .padding(.horizontal, EnoSpacing.s3)
                .padding(.vertical, EnoSpacing.s1)
            }
            // The tinted subcategory panel ran flush off the right edge with a chip sliced
            // in half; the fade makes the overflow read as scrollable, not broken.
            .enoEdgeFade()
            .onChange(of: feed.category) {
                guard let c = feed.category else { return }
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("cat-\(c)", anchor: .leading) }
            }
        }
    }

    // ── brand rail: logos + inline model panel ──
    private var brandRail: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: EnoSpacing.s4) {
                    ForEach(rail.brands) { b in
                        brandTile(b).id("brand-\(b.slug)")
                        if feed.brand == b.slug {
                            modelPanel()
                        }
                    }
                }
                .padding(.horizontal, EnoSpacing.s3)
                .padding(.vertical, EnoSpacing.s1)
            }
            .enoEdgeFade()
            .onChange(of: feed.brand) {
                guard let b = feed.brand else { return }
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("brand-\(b)", anchor: .leading) }
            }
        }
    }

    // ── tile (76pt, 44pt icon box, caption-bold 2-line label) ──
    // TODO(EnoUI): no icon-TILE primitive yet — EnoButton is a horizontal title+icon control
    // and EnoChip is a pill, so neither can express this 76pt stacked grid cell (44pt icon box
    // + 2-line centered label) that also has to be a filter TOGGLE, not a NavigationLink.
    private func tile(name: String, symbol: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    // Icon in the muted body tone (web text-body), NOT near-black
                    // — line glyph matching the typography; active = brand blue.
                    .enoIcon(.lg, color: active ? EnoColor.brand : EnoColor.sub)
                    .frame(width: 44, height: 44)
                Text(name)
                    .enoText(.caption, color: active ? EnoColor.brand : EnoColor.fg, weight: .bold)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: 76)
            }
            .padding(.vertical, EnoSpacing.s1)
        }
        .buttonStyle(.plain)
    }

    // TODO(EnoUI): same missing icon-tile primitive as `tile` above, plus a remote brand mark
    // (BrandLogoView) where the glyph would be — EnoUI has no logo/mark slot.
    private func brandTile(_ b: BrandsResponse.Brand) -> some View {
        let active = feed.brand == b.slug
        return Button {
            if active { feed.brand = nil; feed.model = nil }
            else {
                feed.brand = b.slug; feed.model = nil
                Task { await rail.loadModels(brand: b.slug, category: feed.category, subcategory: feed.subcategory) }
            }
        } label: {
            VStack(spacing: 6) {
                BrandLogoView(slug: b.slug, active: active)
                    .frame(width: 48, height: 44)   // 48 mark, unclipped, in a 44 box
                Text(b.name)
                    .enoText(.caption, color: active ? EnoColor.brand : EnoColor.fg, weight: .bold)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: 76)
            }
            .padding(.vertical, EnoSpacing.s1)
        }
        .buttonStyle(.plain)
    }

    // ── expansion panels (48pt divider + blue-tint 3-row column-major grid) ──
    private var gridRows: [GridItem] {
        [GridItem(.fixed(28), spacing: 2), GridItem(.fixed(28), spacing: 2), GridItem(.fixed(28), spacing: 2)]
    }

    private func subcatPanel(for cat: AppCategory) -> some View {
        let subs = (subsByCat[cat.slug] ?? [])
            .sorted { (feed.subcategoryCounts[$0.slug] ?? 0) > (feed.subcategoryCounts[$1.slug] ?? 0) }
        return HStack(spacing: EnoSpacing.s2) {
            Rectangle().fill(EnoColor.ring).frame(width: 1, height: 48)
            LazyHGrid(rows: gridRows, spacing: 6) {
                chip(label: L10n.tr("All", "Tất cả"), symbol: nil, count: nil, active: feed.subcategory == nil) {
                    feed.subcategory = nil; feed.brand = nil; feed.model = nil
                }
                ForEach(subs) { sub in
                    chip(label: sub.displayName, symbol: LucideSF.symbol(sub.icon),
                         count: feed.subcategoryCounts[sub.slug], active: feed.subcategory == sub.slug) {
                        feed.subcategory = feed.subcategory == sub.slug ? nil : sub.slug
                        feed.brand = nil; feed.model = nil
                    }
                }
            }
            .padding(6)
            .background(EnoColor.brandTint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
        }
        .task { if subsByCat[cat.slug] == nil { subsByCat[cat.slug] = await Taxonomy.shared.subs(for: cat.slug) } }
    }

    private func modelPanel() -> some View {
        HStack(spacing: EnoSpacing.s2) {
            Rectangle().fill(EnoColor.ring).frame(width: 1, height: 48)
            LazyHGrid(rows: gridRows, spacing: 6) {
                chip(label: L10n.tr("All", "Tất cả"), symbol: nil, count: nil, active: feed.model == nil) {
                    feed.model = nil
                }
                ForEach(rail.models) { m in
                    chip(label: m.model, symbol: nil, count: m.count, active: feed.model == m.model) {
                        feed.model = feed.model == m.model ? nil : m.model
                    }
                }
            }
            .padding(6)
            .background(EnoColor.brandTint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
        }
    }

    // ── chip: label role, optional xs leading icon, micro trailing count ──
    // TODO(EnoUI): NOT EnoChip. EnoChip is a ≥32pt pill whose selected state is a solid brand
    // FILL; this is the web quick-find panel chip — a 28pt grid row (GridItem(.fixed(28)))
    // sitting INSIDE a brand-tint panel, where selected = raised card surface + brand ink and
    // unselected = transparent. EnoUI has no quiet/compact chip variant, and the pill's 32pt
    // minimum would break the 3-row LazyHGrid.
    private func chip(label: String, symbol: String?, count: Int?, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: EnoSpacing.s1) {
                if let symbol {
                    Image(systemName: symbol).enoIcon(.xs, color: active ? EnoColor.brand : EnoColor.sub).frame(width: 14)
                }
                Text(label).font(EnoTextRole.label.font).lineLimit(1)
                if let count {
                    Text("\(count)").enoText(.micro, color: EnoColor.sub)
                }
            }
            .foregroundStyle(active ? EnoColor.brand : EnoColor.sub)
            .padding(.horizontal, 10)
            .padding(.vertical, EnoSpacing.s1)
            .background(active ? EnoColor.card : Color.clear, in: RoundedRectangle(cornerRadius: EnoRadius.chip))
            .enoElevation(active ? .raised : .flat)
        }
        .buttonStyle(.plain)
    }

    private func clearAll() {
        feed.subcategory = nil; feed.brand = nil; feed.model = nil
    }
}

// Monotone brand logo via the rasterizing endpoint (tinted to the current
// state color); monogram fallback on 404 (brands simple-icons doesn't know).
struct BrandLogoView: View {
    let slug: String
    let active: Bool

    var body: some View {
        let hex = active ? "0a66c2" : "525252"
        AsyncImage(url: URL(string: "https://eno.vn/api/brands/\(slug)/logo?w=96&c=\(hex)")) { phase in
            switch phase {
            case .success(let img): img.resizable().scaledToFit()
            default:
                Text(slug.prefix(2).uppercased())
                    .enoText(.headline, color: active ? EnoColor.brand : EnoColor.sub, weight: .bold)
                    .frame(width: 42, height: 42)
                    .overlay(RoundedRectangle(cornerRadius: EnoRadius.control).strokeBorder(EnoColor.ring, lineWidth: 1))
            }
        }
    }
}
