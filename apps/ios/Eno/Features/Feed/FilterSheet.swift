import SwiftUI

// The results-surface filter entry + the price-range sheet (VND, mirroring the
// web's priceMin/priceMax). More facets (area, condition) join here later.
struct FilterChip: View {
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "slider.horizontal.3").font(.system(size: 12, weight: .semibold))
                Text(L10n.tr("Filter", "Lọc")).font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(active ? Color.white : Tokens.fg)
            .padding(.horizontal, 13)
            .frame(height: 30)
            .background(active ? Tokens.brand : Tokens.tint, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct PriceFilterSheet: View {
    @Bindable var model: FeedModel
    @Environment(\.dismiss) private var dismiss
    @State private var minText = ""
    @State private var maxText = ""
    @State private var condition = ""

    var body: some View {
        NavigationStack {
            Form {
                Section(L10n.tr("Condition", "Tình trạng")) {
                    Picker(L10n.tr("Condition", "Tình trạng"), selection: $condition) {
                        Text(L10n.tr("Any", "Tất cả")).tag("")
                        Text(L10n.tr("New", "Mới")).tag("new")
                        Text(L10n.tr("Used", "Đã dùng")).tag("used")
                    }
                    .pickerStyle(.segmented)
                }
                Section(L10n.tr("Price (VND)", "Giá (đ)")) {
                    TextField(L10n.tr("From", "Từ"), text: $minText)
                        .keyboardType(.numberPad)
                    TextField(L10n.tr("To", "Đến"), text: $maxText)
                        .keyboardType(.numberPad)
                }
                Section {
                    Button(L10n.tr("Apply", "Áp dụng")) {
                        model.priceMin = Int(minText.filter(\.isNumber))
                        model.priceMax = Int(maxText.filter(\.isNumber))
                        model.condition = condition.isEmpty ? nil : condition
                        dismiss()
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Tokens.brand)
                    if model.hasPriceFilter {
                        Button(L10n.tr("Clear filter", "Xóa bộ lọc"), role: .destructive) {
                            model.priceMin = nil
                            model.priceMax = nil
                            model.condition = nil
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(L10n.tr("Filter", "Bộ lọc"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr("Done", "Xong")) { dismiss() }
                }
            }
            .onAppear {
                minText = model.priceMin.map(String.init) ?? ""
                maxText = model.priceMax.map(String.init) ?? ""
                condition = model.condition ?? ""
            }
        }
        .presentationDetents([.height(320)])
    }
}
