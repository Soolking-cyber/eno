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

// The results filter sheet — condition + price + the category's taxonomy facets
// (chip toggles / select menus / numeric ranges), mirroring the web facet filters.
// Facets are loaded from the same /api/categories meta the post wizard uses, and
// keyed for the server as attr_{key}=value / range_{column}="min-max".
struct PriceFilterSheet: View {
    @Bindable var model: FeedModel
    @Environment(\.dismiss) private var dismiss
    @State private var minText = ""
    @State private var maxText = ""
    @State private var condition = ""
    @State private var facets: [CategoriesResponse.Facet] = []
    @State private var chips: [String: String] = [:]   // facet.key -> selected value
    @State private var rangeLo: [String: String] = [:]  // range.column -> min
    @State private var rangeHi: [String: String] = [:]  // range.column -> max

    // Facets that apply to the current (sub)category — condition has its own control.
    private var applicable: [CategoriesResponse.Facet] {
        facets.filter { $0.key != "condition" && $0.applies(toSubcategory: model.subcategory) }
    }

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
                    TextField(L10n.tr("From", "Từ"), text: $minText).keyboardType(.numberPad)
                    TextField(L10n.tr("To", "Đến"), text: $maxText).keyboardType(.numberPad)
                }
                ForEach(applicable) { facet in facetSection(facet) }
                Section {
                    Button(L10n.tr("Apply", "Áp dụng")) { apply() }
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(Tokens.brand)
                    if model.hasPriceFilter {
                        Button(L10n.tr("Clear all", "Xóa tất cả"), role: .destructive) { clearAll() }
                    }
                }
            }
            .navigationTitle(L10n.tr("Filters", "Bộ lọc"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L10n.tr("Done", "Xong")) { dismiss() } } }
            .task {
                if facets.isEmpty, let slug = model.category {
                    facets = await Taxonomy.shared.category(for: slug)?.facets ?? []
                }
            }
            .onAppear { hydrate() }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func facetSection(_ f: CategoriesResponse.Facet) -> some View {
        Section(f.displayLabel) {
            switch f.kind {
            case "range":
                if let r = f.range {
                    HStack {
                        TextField(L10n.tr("Min", "Nhỏ nhất"), text: bindRange(r.column, lo: true)).keyboardType(.decimalPad)
                        if let u = r.unit { Text(u).foregroundStyle(Tokens.sub) }
                    }
                    HStack {
                        TextField(L10n.tr("Max", "Lớn nhất"), text: bindRange(r.column, lo: false)).keyboardType(.decimalPad)
                        if let u = r.unit { Text(u).foregroundStyle(Tokens.sub) }
                    }
                }
            case "select":
                Picker(f.displayLabel, selection: bindChip(f.key)) {
                    Text(L10n.tr("Any", "Tất cả")).tag("")
                    ForEach(f.options) { o in Text(o.displayName).tag(o.value) }
                }
            default: // toggle → single-select capsule chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(f.options) { o in
                            let sel = chips[f.key] == o.value
                            Button {
                                chips[f.key] = sel ? nil : o.value  // re-tap clears
                            } label: {
                                Text(o.displayName).font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(sel ? .white : Tokens.fg)
                                    .padding(.horizontal, 12).frame(height: 30)
                                    .background(sel ? Tokens.brand : Tokens.tint, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            }
        }
    }

    private func bindChip(_ key: String) -> Binding<String> {
        Binding(get: { chips[key] ?? "" }, set: { chips[key] = $0.isEmpty ? nil : $0 })
    }
    private func bindRange(_ col: String, lo: Bool) -> Binding<String> {
        Binding(
            get: { (lo ? rangeLo : rangeHi)[col] ?? "" },
            set: { v in
                let val = v.isEmpty ? nil : v
                if lo { rangeLo[col] = val } else { rangeHi[col] = val }
            }
        )
    }

    private func hydrate() {
        minText = model.priceMin.map(String.init) ?? ""
        maxText = model.priceMax.map(String.init) ?? ""
        condition = model.condition ?? ""
        for (k, v) in model.customFilters {
            if k.hasPrefix("attr_") {
                chips[String(k.dropFirst(5))] = v
            } else if k.hasPrefix("range_") {
                let col = String(k.dropFirst(6))
                let parts = v.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
                if parts.count == 2 {
                    rangeLo[col] = parts[0].isEmpty ? nil : parts[0]
                    rangeHi[col] = parts[1].isEmpty ? nil : parts[1]
                }
            }
        }
    }

    private func apply() {
        model.priceMin = Int(minText.filter(\.isNumber))
        model.priceMax = Int(maxText.filter(\.isNumber))
        model.condition = condition.isEmpty ? nil : condition
        var custom: [String: String] = [:]
        for (key, val) in chips where !val.isEmpty { custom["attr_\(key)"] = val }
        for f in facets where f.kind == "range" {
            guard let col = f.range?.column else { continue }
            let lo = rangeLo[col] ?? "", hi = rangeHi[col] ?? ""
            if !lo.isEmpty || !hi.isEmpty { custom["range_\(col)"] = "\(lo)-\(hi)" }
        }
        model.customFilters = custom
        dismiss()
    }

    private func clearAll() {
        model.priceMin = nil
        model.priceMax = nil
        model.condition = nil
        model.customFilters = [:]
        dismiss()
    }
}
