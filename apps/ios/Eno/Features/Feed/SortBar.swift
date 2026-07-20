import SwiftUI

// The results-strip sort tabs, mirroring the web's public sort values
// (feed-query.ts buildFeedOrderBy): Recommended (the default blend) · Newest ·
// Price low→high · Price high→low · Most contacted.
struct SortBar: View {
    @Bindable var model: FeedModel

    // Web explorer-toolbar tabs: UNDERLINE strip (not pills). Relevance · Newest ·
    // Price (one tab carrying a direction arrow) · Most contacted.
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
                // Price — one tab that toggles low⇄high and shows the direction.
                Button {
                    model.sort = model.sort == "price-low" ? "price-high" : "price-low"
                } label: {
                    HStack(spacing: 3) {
                        Text(L10n.tr("Price", "Giá"))
                        Image(systemName: priceArrow).font(.system(size: 11, weight: .bold))
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(priceActive ? Tokens.brand : Tokens.sub)
                    .padding(.bottom, 6)
                    .overlay(alignment: .bottom) { if priceActive { Rectangle().fill(Tokens.brand).frame(height: 2) } }
                }
                .buttonStyle(.plain)
                tab(L10n.tr("Most contacted", "Được quan tâm"), active: model.sort == "popular") { model.sort = "popular" }
            }
            .padding(.horizontal, 12)
        }
    }

    private func tab(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(active ? Tokens.brand : Tokens.sub)
                .padding(.bottom, 6)
                .overlay(alignment: .bottom) { if active { Rectangle().fill(Tokens.brand).frame(height: 2) } }
        }
        .buttonStyle(.plain)
    }
}
