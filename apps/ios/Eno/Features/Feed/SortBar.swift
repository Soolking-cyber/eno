import SwiftUI

// The results-strip sort tabs, mirroring the web's public sort values
// (feed-query.ts buildFeedOrderBy): Recommended (the default blend) · Newest ·
// Price low→high · Price high→low · Most contacted.
struct SortBar: View {
    @Bindable var model: FeedModel

    private static let options: [(value: String, en: String, vi: String)] = [
        ("newest", "Recommended", "Đề xuất"),
        ("recent", "Newest", "Mới nhất"),
        ("price-low", "Price: low", "Giá thấp trước"),
        ("price-high", "Price: high", "Giá cao trước"),
        ("popular", "Most contacted", "Được quan tâm"),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.options, id: \.value) { opt in
                    let active = model.sort == opt.value
                    Button {
                        model.sort = opt.value
                    } label: {
                        Text(L10n.tr(opt.en, opt.vi))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(active ? Color.white : Tokens.fg)
                            .padding(.horizontal, 13)
                            .frame(height: 30)
                            .background(active ? Tokens.brand : Tokens.tint, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
    }
}
