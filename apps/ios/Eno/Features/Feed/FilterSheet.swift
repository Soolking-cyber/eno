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

    var body: some View {
        NavigationStack {
            Form {
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
                        dismiss()
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Tokens.brand)
                    if model.hasPriceFilter {
                        Button(L10n.tr("Clear filter", "Xóa bộ lọc"), role: .destructive) {
                            model.priceMin = nil
                            model.priceMax = nil
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
            }
        }
        .presentationDetents([.height(320)])
    }
}
