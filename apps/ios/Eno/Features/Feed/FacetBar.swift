import SwiftUI
import EnoUI

/// THE WEB'S FACET BAR — Any type · Price · Area — above the feed on every browse screen.
///
/// ⛔ THE APP HAD NO EQUIVALENT AT ALL. eno.vn shows these three straight away, on the home as
/// much as inside a category ("home-is-search"), and the iOS home went from the category rail
/// into the grid with nothing to narrow by. Owner, 2026-09-06: *"read mobile web version and
/// match ios app to it properly"*.
///
/// ⚠️ IT IS NOT `QuickFindBar`. That one is the category → subcategory → model DRILL-DOWN, and
/// putting it on the landing drew a second category row underneath the tile rail. Two different
/// controls that both look like "chips at the top of a feed"; only this one is the web's facet bar.
struct FacetBar: View {
    @Bindable var feed: FeedModel
    @State private var showPrice = false

    /// The API's intents, in the web's order and wording (`facet-bar.tsx` typeOptions).
    private static let types: [(value: String, en: String, vi: String)] = [
        ("all", "Any type", "Mọi loại"),
        ("sell", "For sale", "Cần bán"),
        ("rent", "For rent", "Cho thuê"),
        ("wanted", "Wanted", "Cần mua"),
    ]

    /// ⚠️ PROVINCES, NOT DISTRICTS. `province` matches the listing's `city`, which is the only area
    /// level the current rows carry — a ward filter would return nothing until listings are
    /// re-tagged (the same note the web's query carries).
    private static let provinces = ["Ho Chi Minh City", "Ha Noi", "Da Nang", "Nha Trang", "Hoi An"]

    var body: some View {
        HStack(spacing: EnoSpacing.s4) {
            Menu {
                ForEach(Self.types, id: \.value) { t in
                    Button(L10n.tr(t.en, t.vi)) { feed.listingType = t.value == "all" ? nil : t.value }
                }
            } label: {
                facet(currentTypeLabel, active: feed.listingType != nil, glyph: "sort")
            }

            // The three facets must read as ONE row of plain labels; an EnoButton would give the
            // middle one a filled pill the other two do not have.
            Button { showPrice = true } label: {  // eno-lint-allow: raw-button — a facet label, matching its two neighbours
                facet(L10n.tr("Price", "Giá"), active: feed.hasPriceFilter, glyph: "chevron-down")
            }
            .buttonStyle(.plain)  // eno-lint-allow: plain-button-style — a facet is a label, not a filled control

            Menu {
                Button(L10n.tr("Anywhere", "Mọi nơi")) { feed.province = nil }
                ForEach(Self.provinces, id: \.self) { p in
                    Button(p) { feed.province = p }
                }
            } label: {
                facet(feed.province ?? L10n.tr("Area", "Khu vực"), active: feed.province != nil, glyph: "map-pin")
            }
            Spacer()
        }
        .padding(.horizontal, EnoSpacing.s3)
        .padding(.vertical, EnoSpacing.s2)
        .sheet(isPresented: $showPrice) { PriceFilterSheet(model: feed) }
    }

    private var currentTypeLabel: String {
        guard let t = feed.listingType, let row = Self.types.first(where: { $0.value == t }) else {
            return L10n.tr("Any type", "Mọi loại")
        }
        return L10n.tr(row.en, row.vi)
    }

    /// One facet: label + its glyph, brand-coloured once it is actually filtering — the web's
    /// active-facet treatment, so a narrowed feed says so without opening anything.
    private func facet(_ title: String, active: Bool, glyph: String) -> some View {
        HStack(spacing: 4) {
            Text(title)
            EnoIcon(glyph, .xs, color: active ? EnoColor.brand : EnoColor.sub)
        }
        .enoText(.label, color: active ? EnoColor.brand : EnoColor.fg)
        .lineLimit(1)
    }
}
