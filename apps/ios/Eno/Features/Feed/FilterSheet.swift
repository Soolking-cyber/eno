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
    // Numeric inputs stage locally and commit on dismiss (typing shouldn't refetch each
    // keystroke). Chips / select / condition / verified apply LIVE to the model so the
    // footer count updates as you tap — mirroring the web mobile filter drawer.
    @State private var minText = ""
    @State private var maxText = ""
    @State private var facets: [CategoriesResponse.Facet] = []
    @State private var rangeLo: [String: String] = [:]  // range.column -> min
    @State private var rangeHi: [String: String] = [:]  // range.column -> max

    // Facets that apply to the current (sub)category — condition has its own control.
    private var applicable: [CategoriesResponse.Facet] {
        facets.filter { $0.key != "condition" && $0.applies(toSubcategory: model.subcategory) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(L10n.tr("Verified", "Xác thực")) {
                    Toggle(L10n.tr("Verified listings only", "Chỉ tin đã xác thực"), isOn: bindVerified)
                }
                Section(L10n.tr("Condition", "Tình trạng")) {
                    Picker(L10n.tr("Condition", "Tình trạng"), selection: bindCondition) {
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
            }
            .navigationTitle(L10n.tr("Filters", "Bộ lọc"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.hasPriceFilter {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(L10n.tr("Clear all", "Xóa tất cả"), role: .destructive) { clearAll() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { Button(L10n.tr("Done", "Xong")) { dismiss() } }
            }
            // Pinned brand CTA with the LIVE match count (web drawer footer). Chips /
            // condition / verified already applied live, so the count is live; the button
            // just closes and any typed price/range commits on dismiss (.onDisappear).
            .safeAreaInset(edge: .bottom) {
                Button { dismiss() } label: {
                    Text(applyLabel)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(Tokens.brand, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .onDisappear { commit() }
            .task {
                if facets.isEmpty, let slug = model.category {
                    facets = await Taxonomy.shared.category(for: slug)?.facets ?? []
                }
            }
            .onAppear { hydrate() }
        }
        .presentationDetents([.medium, .large])
    }

    // "Apply Filters (N)" — N is the LIVE match count (chips/condition/verified apply live;
    // typed price/range are not yet in it, matching the web price popover's own commit).
    private var applyLabel: String {
        let n = model.totalCount ?? model.items.count
        return L10n.tr("Apply Filters (\(n))", "Áp dụng lọc (\(n))")
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
                Picker(f.displayLabel, selection: bindAttr(f.key)) {
                    Text(L10n.tr("Any", "Tất cả")).tag("")
                    ForEach(f.options) { o in Text(o.displayName).tag(o.value) }
                }
            default: // toggle → single-select capsule chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(f.options) { o in
                            let sel = model.customFilters["attr_\(f.key)"] == o.value
                            Button {
                                toggleAttr(f.key, o.value)  // re-tap clears; applies live
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

    // attr_* chip/select facets bind LIVE to the model (each change refetches).
    private func bindAttr(_ key: String) -> Binding<String> {
        Binding(
            get: { model.customFilters["attr_\(key)"] ?? "" },
            set: { model.customFilters["attr_\(key)"] = $0.isEmpty ? nil : $0 }
        )
    }
    private func toggleAttr(_ key: String, _ value: String) {
        let k = "attr_\(key)"
        model.customFilters[k] = model.customFilters[k] == value ? nil : value
    }
    private var bindCondition: Binding<String> {
        Binding(get: { model.condition ?? "" }, set: { model.condition = $0.isEmpty ? nil : $0 })
    }
    private var bindVerified: Binding<Bool> {
        Binding(get: { model.verifiedOnly }, set: { model.verifiedOnly = $0 })
    }
    // Numeric ranges stay STAGED (commit on dismiss) — typing shouldn't refetch per key.
    private func bindRange(_ col: String, lo: Bool) -> Binding<String> {
        Binding(
            get: { (lo ? rangeLo : rangeHi)[col] ?? "" },
            set: { v in
                let val = v.isEmpty ? nil : v
                if lo { rangeLo[col] = val } else { rangeHi[col] = val }
            }
        )
    }

    // Only the STAGED numeric inputs hydrate; condition/verified/chips read the model live.
    private func hydrate() {
        minText = model.priceMin.map(String.init) ?? ""
        maxText = model.priceMax.map(String.init) ?? ""
        for (k, v) in model.customFilters where k.hasPrefix("range_") {
            let col = String(k.dropFirst(6))
            let parts = v.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            if parts.count == 2 {
                rangeLo[col] = parts[0].isEmpty ? nil : parts[0]
                rangeHi[col] = parts[1].isEmpty ? nil : parts[1]
            }
        }
    }

    // Commit the STAGED numeric inputs (price + ranges) into the model; chips/select/
    // condition/verified already applied live. PRESERVES the live attr_* chips and only
    // rewrites range_* keys. Idempotent — the model's didSet guards drop no-op writes.
    private func commit() {
        model.priceMin = Int(minText.filter(\.isNumber))
        model.priceMax = Int(maxText.filter(\.isNumber))
        var custom = model.customFilters
        for f in facets where f.kind == "range" {
            guard let col = f.range?.column else { continue }
            let lo = rangeLo[col] ?? "", hi = rangeHi[col] ?? ""
            if lo.isEmpty && hi.isEmpty { custom["range_\(col)"] = nil }
            else { custom["range_\(col)"] = "\(lo)-\(hi)" }
        }
        model.customFilters = custom
    }

    private func clearAll() {
        model.priceMin = nil
        model.priceMax = nil
        model.condition = nil
        model.customFilters = [:]
        model.verifiedOnly = true
        minText = ""; maxText = ""
        rangeLo = [:]; rangeHi = [:]
    }
}
