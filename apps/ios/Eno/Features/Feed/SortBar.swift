import SwiftUI
import EnoUI

// The results-strip sort tabs, mirroring the web's public sort values
// (feed-query.ts buildFeedOrderBy): Recommended (the default blend) · Newest ·
// Price low→high · Price high→low · Most contacted.
struct SortBar: View {
    @Bindable var model: FeedModel

    // Web explorer-toolbar tabs: UNDERLINE strip (not pills), in the web's order —
    // Relevance · Newest · Most contacted · Price (one tab carrying a direction arrow).
    private static let simple: [(value: String, en: String, vi: String)] = [
        ("newest", "Relevance", "Liên quan"),
        ("recent", "Newest", "Mới nhất"),
    ]

    private var priceActive: Bool { model.sort == "price-low" || model.sort == "price-high" }
    private var priceArrow: String {
        model.sort == "price-low" ? "arrow.up" : model.sort == "price-high" ? "arrow.down" : "arrow.up.arrow.down"
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                ForEach(Self.simple, id: \.value) { opt in
                    tab(L10n.tr(opt.en, opt.vi), active: model.sort == opt.value) { model.sort = opt.value }
                }
                // ⚠️ MOST CONTACTED COMES BEFORE PRICE, because that is the web's order
                // (Relevance · Newest · Most contacted · Price). The app had Price third, so the
                // same four tabs read in a different sequence on the two surfaces — visible the
                // moment they are put side by side (owner, 2026-09-06).
                tab(L10n.tr("Most contacted", "Được quan tâm"), active: model.sort == "popular") { model.sort = "popular" }
                // Price — one tab that toggles low⇄high and shows the direction.
                // TODO(EnoUI): EnoSegmentedControl — single-select strip. Not convertible yet:
                // EnoSegmentedControl wraps the native segmented Picker, which can't express a
                // scrollable UNDERLINE strip whose Price tab toggles direction on re-tap.
                Button {
                    model.sort = model.sort == "price-low" ? "price-high" : "price-low"
                } label: {
                    HStack(spacing: 3) {
                        Text(L10n.tr("Price", "Giá"))
                        Image(systemName: priceArrow).enoIcon(.xs, color: priceActive ? EnoColor.brand : EnoColor.sub)
                    }
                    .enoText(.label, color: priceActive ? EnoColor.brand : EnoColor.sub)
                    .padding(.bottom, 6)
                    .overlay(alignment: .bottom) { if priceActive { Rectangle().fill(EnoColor.brand).frame(height: 2) } }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, EnoSpacing.s3)
        }
        // "Most contacted" used to be guillotined mid-word by the adjacent Filter button,
        // which looked like a bug rather than a scrollable strip.
        .enoEdgeFade()
    }

    // TODO(EnoUI): EnoSegmentedControl — an underline tab, deliberately NOT a pill/EnoChip
    // (mirrors the web explorer toolbar). EnoUI has no tab-strip primitive yet.
    private func tab(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .enoText(.label, color: active ? EnoColor.brand : EnoColor.sub)
                .padding(.bottom, 6)
                .overlay(alignment: .bottom) { if active { Rectangle().fill(EnoColor.brand).frame(height: 2) } }
        }
        .buttonStyle(.plain)
    }
}
